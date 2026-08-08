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
} from '@nexora/auth';
import { type User } from '@nexora/database';
import { AuthDatabase, type AuthDb } from './auth.db';
import { EVENTS, EventBus } from '@nexora/events';
import { envOr } from '@nexora/config';
import { createLogger, type LogLevel } from '@nexora/logger';
import type { AuthResponse, AuthTokens, PublicUser } from '@nexora/shared-types';
import type { ChangePasswordDto, LoginDto, RegisterDto, UpdateAccountDto } from './dto';

const logger = createLogger('auth-service', envOr('LOG_LEVEL', 'info') as LogLevel);

/** Days a refresh token stays valid; mirrors JWT_REFRESH_TTL for the DB row. */
const REFRESH_DAYS = Number(envOr('JWT_REFRESH_TTL', '30d').replace(/\D/g, '')) || 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly events: EventBus,
    @Inject(AuthDatabase) private readonly db: AuthDb,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const policyError = validatePasswordStrength(dto.password);
    if (policyError) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: policyError });

    const email = dto.email.toLowerCase().trim();
    const username = dto.username.trim();

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

    // Reuse detection: a token this account already spent (or a forgery carrying
    // a real jti) means the token leaked. The holder is unknown, so every live
    // token for the account dies and both parties have to log in again.
    if (stored && (stored.revokedAt !== null || stored.tokenHash !== hashToken(refreshToken))) {
      await this.revokeFamily(stored.userId, 'reuse');
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

    return this.issueTokens(user);
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
    await this.revokeFamily(userId, 'password-change');

    // Every session died, including this one - hand back a fresh pair so the
    // caller who just proved they know the password stays signed in.
    const tokens = await this.issueTokens(updated);
    return { ...tokens, user: toPublicUser(updated) };
  }

  async updateAccount(userId: string, dto: UpdateAccountDto): Promise<PublicUser> {
    const username = dto.username?.trim();
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
      },
    });
    return toPublicUser(updated);
  }

  /** Signs out every session of an account. Used when a refresh token leaks. */
  private async revokeFamily(userId: string, reason: string): Promise<void> {
    const { count } = await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Audit trail: a reuse warning is the signal that a token was stolen.
    logger.warn('Refresh tokens revoked', { userId, reason, revoked: count });
  }

  /** Same session minting the password path uses; OAuth sign-in needs it too. */
  async issueTokensFor(user: User): Promise<AuthTokens> {
    return this.issueTokens(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessToken = signAccessToken(user);
    const { token: refreshToken, jti } = signRefreshToken(user.id);

    await this.db.refreshToken.create({
      data: {
        id: jti,
        userId: user.id,
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
    createdAt: user.createdAt.toISOString(),
  };
}
