import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import {
  accessTokenLifetimeSeconds,
  hashPassword,
  hashToken,
  signAccessToken,
  signRefreshToken,
  validatePasswordStrength,
  verifyPassword,
  verifyRefreshToken,
} from '@betweenus/auth';
import { type User } from '@betweenus/database';
import { AuthDatabase, type AuthDb } from './auth.db';
import { EVENTS, EventBus } from '@betweenus/events';
import { envOr } from '@betweenus/config';
import { createLogger, type LogLevel } from '@betweenus/logger';
import type {
  AuthResponse,
  AuthTokens,
  ForgotPasswordResponse,
  PublicUser,
  UsernameAvailability,
} from '@betweenus/shared-types';
import { MailService, NO_MAIL_MESSAGE } from '../mail/mail.service';
import { UsernameDirectory, normalizeUsername } from './username-directory';
import { publicBaseUrl } from '../admin/oauth-providers';
import type { ChangePasswordDto, LoginDto, RegisterDto, UpdateAccountDto } from './dto';

const logger = createLogger('auth-service', envOr('LOG_LEVEL', 'info') as LogLevel);

/**
 * Days a refresh token stays valid; mirrors JWT_REFRESH_TTL for the DB row.
 *
 * It slides: every refresh rotates the token and the successor gets the full
 * window again, so this is how long an app may go *unopened* before its owner
 * has to type a password. Ninety days rather than thirty because that is the
 * question it actually answers - a phone left in a drawer over a summer - and
 * nothing is weakened by it. The token is still revoked the moment it is spent,
 * a sign-out still ends it server-side, and theft detection still revokes the
 * whole family.
 */
const REFRESH_DAYS = Number(envOr('JWT_REFRESH_TTL', '90d').replace(/\D/g, '')) || 90;

/**
 * How long a token that has just been rotated still answers with the pair that
 * rotation produced, instead of being read as theft.
 *
 * Rotation is not atomic across the network: the server can revoke a token,
 * mint its successor, and have the response lost - a reload mid-refresh, a
 * window closed, a dropped connection, two tabs asking at once. The client then
 * presents the only token it still has, which is the one already spent, and
 * without this window that is indistinguishable from a stolen token: every
 * session on every device is revoked and the person is signed out for good.
 * Read live rather than captured, so a test can turn it off.
 *
 * Inside the window the reply is the *same* pair, not a new one. A replay
 * therefore creates nothing: an attacker holding the stolen token learns
 * nothing it did not already have, and the theft detection outside the window
 * is untouched.
 */
function replayGraceMs(): number {
  return Number(envOr('REFRESH_REPLAY_GRACE_MS', '30000')) || 0;
}

/**
 * How long a reset token lives.
 *
 * Short, because the whole of its security is that it is a bearer credential
 * sitting in an inbox - or, for the administrator-granted door, handed to
 * whoever typed a username. Thirty minutes is long enough to read an email and
 * short enough that a window left open is not a way in tomorrow.
 */
const RESET_TTL_MINUTES = Number(envOr('PASSWORD_RESET_TTL_MINUTES', '30')) || 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly events: EventBus,
    private readonly mail: MailService,
    private readonly usernames: UsernameDirectory,
    @Inject(AuthDatabase) private readonly db: AuthDb,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const policyError = validatePasswordStrength(dto.password);
    if (policyError) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: policyError });

    const email = dto.email.toLowerCase().trim();
    // Lower-cased, not merely trimmed: signing in by name already lowercases
    // what was typed, so a mixed-case row was a row nobody could log in to.
    const username = normalizeUsername(dto.username);

    const existing = await this.db.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { email: true },
    });
    if (existing) {
      // Same message for either collision - do not leak which field is taken.
      throw new ConflictException({
        code: 'ACCOUNT_EXISTS',
        message: 'Email or username is already registered',
      });
    }

    const user = await this.db.user.create({
      data: {
        email,
        username,
        displayName: username,
        passwordHash: await hashPassword(dto.password),
      },
    });

    this.usernames.remember(user.username);
    await this.events.publish(EVENTS.USER_CREATED, {
      userId: user.id,
      username: user.username,
      email: user.email,
    });

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    // The field is called `email` for compatibility but accepts either; an
    // address always contains an @, a username never may.
    const identifier = dto.email.toLowerCase().trim();
    const user = await this.db.user.findUnique({
      where: identifier.includes('@') ? { email: identifier } : { username: identifier },
    });

    // Always run a comparison so a missing account and a wrong password cost the same.
    const passwordOk = user
      ? await verifyPassword(dto.password, user.passwordHash)
      : await verifyPassword(dto.password, DUMMY_HASH);

    if (!user || !passwordOk) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    assertEnabled(user);

    const tokens = await this.issueTokens(user);
    return { ...tokens, user: toPublicUser(user) };
  }

  /** Rotates the refresh token: the presented token is revoked as it is consumed. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    const stored = await this.db.refreshToken.findUnique({ where: { id: payload.jti } });

    // A forgery carrying a real jti is theft with no innocent explanation, so it
    // is fatal whatever else is true of the row.
    if (stored && stored.tokenHash !== hashToken(refreshToken)) {
      await this.revokeFamily(stored.familyId, 'forgery');
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Refresh token was already used; all sessions have been signed out',
      });
    }

    // Reuse detection: a token this account already spent means the token
    // leaked. The holder is unknown, so every live token for the account dies
    // and both parties have to log in again - unless this is the rotation that
    // just happened and whose answer never arrived, which is what the grace
    // window above exists for.
    if (stored && stored.revokedAt !== null) {
      const replayed = this.rotated.get(stored.id);
      if (replayed && Date.now() - replayed.at < replayGraceMs()) return replayed.tokens;

      await this.revokeFamily(stored.familyId, 'reuse');
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSED',
        message: 'Refresh token was already used; all sessions have been signed out',
      });
    }

    if (!stored || stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    const user = await this.db.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Unknown account' });
    }

    // A disabled account keeps its refresh token but cannot spend it.
    assertEnabled(user);

    await this.db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(user, stored.familyId);
    this.remember(stored.id, tokens);
    return tokens;
  }

  /**
   * What the token with this id was rotated into, for as long as a client that
   * missed the answer might ask again.
   *
   * ponytail: per process, so a replay that lands on a *different*
   * auth-service instance is still read as theft and signs the account out.
   * Move this to Redis - which the service does not otherwise need - if more
   * than one instance ever runs behind the gateway.
   */
  private readonly rotated = new Map<string, { tokens: AuthTokens; at: number }>();

  private remember(jti: string, tokens: AuthTokens): void {
    const cutoff = Date.now() - replayGraceMs();
    for (const [id, entry] of this.rotated) {
      if (entry.at < cutoff) this.rotated.delete(id);
    }
    this.rotated.set(jti, { tokens, at: Date.now() });
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = verifyRefreshToken(refreshToken);
      await this.db.refreshToken.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Logging out with a dead token is not an error worth surfacing.
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNKNOWN_USER', message: 'Account no longer exists' });
    }
    return toPublicUser(user);
  }

  /**
   * Changing the password clears `mustChangePassword` and signs every other
   * session out - including the one the generated password created.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<AuthResponse> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNKNOWN_USER', message: 'Account no longer exists' });
    }

    if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Current password is incorrect',
      });
    }

    const policyError = validatePasswordStrength(dto.newPassword);
    if (policyError) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: policyError });

    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(dto.newPassword),
        mustChangePassword: false,
      },
    });
    await this.revokeEverySession(userId, 'password-change');

    // Every session died, including this one - hand back a fresh pair so the
    // caller who just proved they know the password stays signed in.
    const tokens = await this.issueTokens(updated);
    return { ...tokens, user: toPublicUser(updated) };
  }

  /** Whether a name can be registered. Cheap by construction - see the directory. */
  usernameAvailable(username: string): Promise<UsernameAvailability> {
    const normalized = normalizeUsername(username);
    return this.usernames
      .available(normalized)
      .then((answer) => ({ username: normalized, ...answer }));
  }

  /**
   * What a forgotten password can be done about, on this deployment, for this
   * account.
   *
   * Three answers, and only one of them is about the account:
   *
   * - `reset`: an administrator has already put the account into reset mode, so
   *   this call mints the single-use token and the client goes straight to a
   *   new-password form. This is the door a deployment with no mail server
   *   uses, and it is deliberately the first thing checked - an operator who
   *   went and enabled it means it.
   * - `emailed`: a link went out, or the account does not exist. The two are
   *   the same answer on purpose. Anything that told them apart would turn this
   *   form into a way to enumerate who has an account here.
   * - `unavailable`: nothing is configured to send mail, which is a fact about
   *   the deployment and not about the account, so saying it leaks nothing.
   */
  async forgotPassword(identifier: string): Promise<ForgotPasswordResponse> {
    const trimmed = identifier.toLowerCase().trim();
    const user = await this.db.user.findUnique({
      where: trimmed.includes('@') ? { email: trimmed } : { username: trimmed },
    });

    // A disabled account gets the same nothing an unknown one does: it is
    // barred from signing in, and a new password would not change that.
    const eligible = user && user.disabledAt === null ? user : null;

    if (eligible?.passwordResetUntil && eligible.passwordResetUntil.getTime() > Date.now()) {
      const { token } = await this.mintReset(eligible.id, 'admin');
      return { outcome: 'reset', resetToken: token };
    }

    if (!(await this.mail.configured())) {
      return { outcome: 'unavailable', message: NO_MAIL_MESSAGE };
    }

    if (eligible) {
      const { token } = await this.mintReset(eligible.id, 'email');
      const link = `${publicBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
      // The result is not inspected and not surfaced. A bounce is between the
      // operator and their mail server; the person at the form gets the same
      // sentence either way, which is the same reason the unknown-account case
      // does not differ.
      await this.mail.send({
        to: eligible.email,
        subject: 'Reset your BetweenUs password',
        text: [
          `Hello ${eligible.displayName},`,
          '',
          'Somebody asked to reset the password for your BetweenUs account.',
          'If that was not you, ignore this message - nothing has changed yet.',
          '',
          `Open this link to choose a new password: ${link}`,
          '',
          `Or paste this code into the app: ${token}`,
          '',
          `The link stops working in ${RESET_TTL_MINUTES} minutes and can be used once.`,
        ].join('\n'),
      });
    }

    return { outcome: 'emailed' };
  }

  /**
   * Spends a reset token and sets the password.
   *
   * Every session goes with it, the same as an ordinary password change: the
   * person who needed this door is very often the person whose account was
   * taken, and leaving the other side signed in would make the reset
   * decorative. The administrator-granted window is closed too, so one grant is
   * one reset rather than a standing invitation.
   */
  async resetPassword(token: string, newPassword: string): Promise<AuthResponse> {
    const policyError = validatePasswordStrength(newPassword);
    if (policyError) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: policyError });

    const row = await this.db.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt !== null || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({
        code: 'INVALID_RESET_TOKEN',
        message: 'This reset link has expired or has already been used',
      });
    }

    const user = await this.db.user.findUnique({ where: { id: row.userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNKNOWN_USER', message: 'Account no longer exists' });
    }
    assertEnabled(user);

    // Marked spent before the password moves. If the update fails afterwards
    // the token is burnt and the person asks again, which is the cheap failure;
    // the other order leaves a live token behind a password that already
    // changed, which is the expensive one.
    await this.db.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });

    const updated = await this.db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        passwordResetUntil: null,
      },
    });
    await this.revokeEverySession(user.id, 'password-reset');
    logger.warn('Password reset spent', { userId: user.id, source: row.source });

    const tokens = await this.issueTokens(updated);
    return { ...tokens, user: toPublicUser(updated) };
  }

  /**
   * A fresh single-use token, with only its hash left behind.
   *
   * Any token this account already had is burnt first: two live links is two
   * chances for the one that leaked, and the person asking again is asking
   * because the first did not reach them.
   */
  private async mintReset(userId: string, source: 'admin' | 'email'): Promise<{ token: string }> {
    await this.db.passwordReset.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    await this.db.passwordReset.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        source,
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
      },
    });
    return { token };
  }

  async updateAccount(userId: string, dto: UpdateAccountDto): Promise<PublicUser> {
    const username = dto.username ? normalizeUsername(dto.username) : undefined;
    if (username) {
      const taken = await this.db.user.findUnique({ where: { username } });
      if (taken && taken.id !== userId) {
        throw new ConflictException({
          code: 'ACCOUNT_EXISTS',
          message: 'That username is already taken',
        });
      }
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data: {
        ...(username ? { username } : {}),
        ...(dto.displayName?.trim() ? { displayName: dto.displayName.trim() } : {}),
        // null is a real value here - it clears the picture back to the
        // initial - so only an absent key means "leave it alone".
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        // Same rule: null is "switch the personal disappearing window off",
        // which is a value, and an absent key is "do not touch it".
        ...(dto.messageTtlSeconds !== undefined
          ? { messageTtlSeconds: dto.messageTtlSeconds }
          : {}),
      },
    });

    if (username) this.usernames.remember(username);

    // Everyone who can see this account has the old picture and the old name on
    // screen right now. Published unconditionally rather than diffed: a write
    // that changed nothing is a broadcast nobody notices, where a diff that
    // gets one field wrong is a stale avatar until the next reload.
    await this.events.publish(EVENTS.USER_UPDATED, {
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
      },
    });
    return toPublicUser(updated);
  }

  /**
   * Signs out one sign-in - the chain of tokens descended from it - and
   * nothing else. Used when a refresh token leaks.
   *
   * Scoped to the family rather than the account because a person is signed in
   * on more than one device, and the two chains have nothing to do with each
   * other: a token replayed on a phone says nothing about the laptop. Revoking
   * by `userId` here is what made a second device impossible to stay signed in
   * on - every interrupted rotation anywhere signed every device out.
   *
   * A stolen token is still contained: the thief and the victim share one
   * family, so both halves of the contested chain die together.
   */
  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    const { count } = await this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Audit trail: a reuse warning is the signal that a token was stolen.
    logger.warn('Refresh token family revoked', { familyId, reason, revoked: count });
  }

  /** Signs out every device of an account. The password changing is the case. */
  private async revokeEverySession(userId: string, reason: string): Promise<void> {
    const { count } = await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn('Refresh tokens revoked', { userId, reason, revoked: count });
  }

  /** Same session minting the password path uses; OAuth sign-in needs it too. */
  async issueTokensFor(user: User): Promise<AuthTokens> {
    return this.issueTokens(user);
  }

  /**
   * A new token, in [familyId]'s chain or starting one of its own.
   *
   * A sign-in starts a family; a rotation stays in the one it came from. That
   * is the whole of what makes two devices independent.
   */
  private async issueTokens(user: User, familyId?: string): Promise<AuthTokens> {
    const accessToken = signAccessToken(user);
    const { token: refreshToken, jti } = signRefreshToken(user.id);

    await this.db.refreshToken.create({
      data: {
        id: jti,
        userId: user.id,
        familyId: familyId ?? jti,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken, expiresIn: accessTokenLifetimeSeconds() };
  }
}

/** A disabled account is refused everywhere a session could be created. */
function assertEnabled(user: User): void {
  if (user.disabledAt === null) return;
  throw new UnauthorizedException({
    code: 'ACCOUNT_DISABLED',
    message: 'This account has been disabled',
  });
}

/** bcrypt hash of a value nobody can log in with; used to equalise login timing. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.4Y8Q3M4RwuHhWzR0GkD8hR4T6Bl0Wcy';

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    messageTtlSeconds: user.messageTtlSeconds,
    createdAt: user.createdAt.toISOString(),
  };
}
