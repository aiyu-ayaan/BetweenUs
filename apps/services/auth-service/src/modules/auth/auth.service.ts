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
import { EVENTS, EventBus, type EventPayloads } from '@betweenus/events';
import { envOr } from '@betweenus/config';
import { createLogger, type LogLevel } from '@betweenus/logger';
import { sharedRedis } from '@betweenus/nest-common';
import type {
  AuthResponse,
  AuthTokens,
  ForgotPasswordResponse,
  LastSeenVisibility,
  PublicUser,
  StatusPrivacy,
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

/** What is kept for one rotated token, in Redis and in the in-process map alike. */
interface RotationEntry {
  tokens: AuthTokens;
  /** Milliseconds since the epoch, compared against the window as it is now. */
  at: number;
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
      await this.revokeFamily(stored.familyId, stored.userId, 'forgery');
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
      const replayed = await this.rotationOf(stored.id);
      if (replayed) return replayed;

      await this.revokeFamily(stored.familyId, stored.userId, 'reuse');
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
    await this.remember(stored.id, tokens);
    return tokens;
  }

  /**
   * What the token with this id was rotated into, for as long as a client that
   * missed the answer might ask again.
   *
   * In Redis, so a replay that lands on a *different* auth-service instance is
   * answered rather than read as theft. Per process, that case signed the
   * account out - every device of it - for the crime of a dropped response, and
   * it was the reason a second instance could not be run behind the gateway.
   *
   * The key's TTL is the cleanup and the *read* is the decision. Both, and not
   * either alone: a TTL with no timestamp means an entry written while the
   * window was thirty seconds is still answered after the window is turned off,
   * which is the auth-service check failing on the line that shortens it to
   * zero - and in a deployment, a configuration change that quietly does not
   * take effect for another thirty seconds. A timestamp with no TTL means keys
   * that are never collected. So the entry carries when it was written, the read
   * compares that against the window as it is *now*, and Redis sweeps up behind.
   */
  private rotationKey(jti: string): string {
    return `auth:rotated:${jti}`;
  }

  /**
   * The local half, kept deliberately.
   *
   * It is not a cache. It is what this falls back to when Redis does not answer,
   * and the reason to keep it is that the failure it prevents is the one being
   * fixed: without it, a Redis outage would turn every interrupted rotation into
   * a full sign-out, which is strictly worse than the per-process behaviour this
   * replaces. With it, an unreachable Redis degrades to exactly what the service
   * did before - one instance answers its own replays - and nothing regresses.
   *
   * It is read first for the same reason, plus one: the common case is a client
   * retrying within a second or two through the same connection, and that is
   * already the instance holding the answer.
   */
  private readonly rotated = new Map<string, RotationEntry>();

  /** The pair this token was rotated into, if the window is still open. */
  private async rotationOf(jti: string): Promise<AuthTokens | null> {
    const grace = replayGraceMs();
    if (grace <= 0) return null;

    const local = this.rotated.get(jti);
    if (local && Date.now() - local.at < grace) return local.tokens;

    try {
      const raw = await sharedRedis().get(this.rotationKey(jti));
      // No key is the ordinary answer, not an error: either the window closed or
      // this token was never rotated, and both are a replay to be refused.
      if (!raw) return null;
      const entry = JSON.parse(raw) as RotationEntry;
      return Date.now() - entry.at < grace ? entry.tokens : null;
    } catch (error) {
      // Fall back to what the local map said, which is "no". A Redis that cannot
      // be reached must not be a reason to hand a session to a replayed token,
      // and it is also not a reason to fail the request outright - the caller
      // below will treat this as theft, which is the pre-existing behaviour.
      logger.warn('Could not read a rotation grace entry', {
        jti,
        error: String(error),
      });
      return null;
    }
  }

  private async remember(jti: string, tokens: AuthTokens): Promise<void> {
    const grace = replayGraceMs();
    const cutoff = Date.now() - grace;
    for (const [id, entry] of this.rotated) {
      if (entry.at < cutoff) this.rotated.delete(id);
    }
    this.rotated.set(jti, { tokens, at: Date.now() });

    // Zero means the window is off - a test turning it off, or a deployment that
    // wants replays read as theft immediately. `PX 0` is an error rather than an
    // instant expiry, so there is nothing to write.
    if (grace <= 0) return;

    const entry: RotationEntry = { tokens, at: Date.now() };
    try {
      await sharedRedis().set(this.rotationKey(jti), JSON.stringify(entry), 'PX', grace);
    } catch (error) {
      // The local map already has it, so this instance still answers its own
      // replays. What is lost is the cross-instance half, which is what this
      // whole change is - so it is a warning and not a failed refresh.
      logger.warn('Could not store a rotation grace entry', {
        jti,
        error: String(error),
      });
    }
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
    // The open sockets as well, which is the case this feature is really for:
    // changing a password because somebody else is in the account. Their chat
    // socket was authenticated before this line and goes; the pair minted below
    // is dated after it and stays, so the person doing it keeps their session.
    //
    // Their own *existing* sockets go too - there is no way for a gateway to
    // tell one of an account's sockets from another - so the client reconnects
    // with the new token. A moment's reconnect on the device that just changed
    // its own password is the price of the intruder's socket closing at all.
    await this.revokeSockets(userId, 'password-changed');

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
        // And the same for the wide one behind it: null clears it back to the
        // flat accent band, an absent key leaves it alone.
        ...(dto.coverUrl !== undefined ? { coverUrl: dto.coverUrl } : {}),
        // Trimmed, and an empty string is a value: it means "draw no line
        // under my name", which is different from never having touched it.
        ...(dto.about !== undefined ? { about: dto.about.trim() } : {}),
        // The wire spells it lower case and the column spells it upper; one
        // conversion each way, both in this file, so nothing else has to know
        // there are two spellings.
        ...(dto.lastSeenVisibility !== undefined
          ? { lastSeenVisibility: fromVisibility(dto.lastSeenVisibility) }
          : {}),
        // Same rule: null is "switch the personal disappearing window off",
        // which is a value, and an absent key is "do not touch it".
        ...(dto.messageTtlSeconds !== undefined
          ? { messageTtlSeconds: dto.messageTtlSeconds }
          : {}),
        // Same two spellings, same one conversion each way.
        ...(dto.statusPrivacy !== undefined
          ? { statusPrivacy: fromStatusPrivacy(dto.statusPrivacy) }
          : {}),
        // Written whole. "These people" is one decision, and half of it saved
        // is a different audience from the one somebody chose.
        ...(dto.statusPrivacyList !== undefined
          ? { statusPrivacyList: [...new Set(dto.statusPrivacyList)] }
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
        coverUrl: updated.coverUrl,
        about: updated.about,
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
  private async revokeFamily(familyId: string, userId: string, reason: string): Promise<void> {
    const { count } = await this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Audit trail: a reuse warning is the signal that a token was stolen.
    logger.warn('Refresh token family revoked', { familyId, reason, revoked: count });

    // A family is one chain on one device, but the token was stolen and nobody
    // knows which end is holding it - so the sockets go too, both ends of the
    // contested chain, the same way the refresh tokens do.
    //
    // `userId` is passed rather than looked up: both callers are holding the row
    // this family was found through, and a second query to re-read a column they
    // already have is a query for nothing.
    await this.revokeSockets(userId, 'token-reuse');
  }

  /** Signs out every device of an account. The password changing is the case. */
  private async revokeEverySession(userId: string, reason: string): Promise<void> {
    const { count } = await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn('Refresh tokens revoked', { userId, reason, revoked: count });
  }

  /**
   * Tells the gateways to drop this account's open sockets.
   *
   * Revoking refresh tokens stops a session being *renewed*, which is fifteen
   * minutes late for an access token and forever for a socket - a handshake is
   * authenticated once and then trusted until it disconnects. This is the other
   * half, and it is a published event rather than a call because the sockets are
   * spread across four services and however many instances of each.
   *
   * The line is drawn at the current second, so anything minted from now on
   * survives it. That is what lets `changePassword` use the same call as
   * `disable`: the person changing their own password is handed a new pair in
   * the same response, and it is newer than the line.
   *
   * Failure is logged and swallowed. A revocation that cannot reach Redis must
   * not turn "your account is disabled" into a 500 that leaves the account
   * enabled - the refresh tokens are already dead in Postgres, which is the
   * durable half, and the socket is the fifteen-minute half.
   */
  private async revokeSockets(
    userId: string,
    reason: EventPayloads[typeof EVENTS.SESSION_REVOKED]['reason'],
  ): Promise<void> {
    try {
      await this.events.publish(EVENTS.SESSION_REVOKED, {
        userId,
        notBefore: Math.floor(Date.now() / 1000),
        reason,
      });
    } catch (error) {
      logger.warn('Could not publish a session revocation', { userId, reason, error: String(error) });
    }
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

/**
 * The column's spelling of a last-seen setting, in the one the wire uses.
 *
 * An unknown value is read as the widest it could be narrowed from, which is
 * also what the column defaults to: guessing narrower would silently hide
 * people who never asked to be hidden, and this only ever sees a value written
 * by a build that had the enum.
 */
export function toVisibility(value: string): LastSeenVisibility {
  switch (value) {
    case 'FRIENDS':
      return 'friends';
    case 'NOBODY':
      return 'nobody';
    default:
      return 'everyone';
  }
}

/**
 * Who a moment is sealed for, out of the column and into the wire spelling.
 *
 * Anything unrecognised reads as `friends`, which is the narrowest of the three
 * that is always meaningful: the other two are nothing without a list, and a
 * setting nobody can read back must not be the one that shares widest.
 */
export function toStatusPrivacy(value: string): StatusPrivacy {
  switch (value) {
    case 'FRIENDS_EXCEPT':
      return 'friends-except';
    case 'ONLY_SHARE_WITH':
      return 'only-share-with';
    default:
      return 'friends';
  }
}

/** And back, for a write. */
function fromStatusPrivacy(
  value: StatusPrivacy,
): 'FRIENDS' | 'FRIENDS_EXCEPT' | 'ONLY_SHARE_WITH' {
  switch (value) {
    case 'friends-except':
      return 'FRIENDS_EXCEPT';
    case 'only-share-with':
      return 'ONLY_SHARE_WITH';
    case 'friends':
      return 'FRIENDS';
  }
}

/** And back, for a write. */
function fromVisibility(value: LastSeenVisibility): 'EVERYONE' | 'FRIENDS' | 'NOBODY' {
  switch (value) {
    case 'friends':
      return 'FRIENDS';
    case 'nobody':
      return 'NOBODY';
    case 'everyone':
      return 'EVERYONE';
  }
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    about: user.about,
    lastSeenVisibility: toVisibility(user.lastSeenVisibility),
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    messageTtlSeconds: user.messageTtlSeconds,
    statusPrivacy: toStatusPrivacy(user.statusPrivacy),
    statusPrivacyList: user.statusPrivacyList,
    createdAt: user.createdAt.toISOString(),
  };
}
