import {
  ConflictException,
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
import { prisma, type User } from '@nexora/database';
import { EVENTS, EventBus } from '@nexora/events';
import { envOr } from '@nexora/config';
import type { AuthResponse, AuthTokens, PublicUser } from '@nexora/shared-types';
import type { LoginDto, RegisterDto } from './dto';

/** Days a refresh token stays valid; mirrors JWT_REFRESH_TTL for the DB row. */
const REFRESH_DAYS = Number(envOr('JWT_REFRESH_TTL', '30d').replace(/\D/g, '')) || 30;

@Injectable()
export class AuthService {
  constructor(private readonly events: EventBus) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const policyError = validatePasswordStrength(dto.password);
    if (policyError) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: policyError });

    const email = dto.email.toLowerCase().trim();
    const username = dto.username.trim();

    const existing = await prisma.user.findFirst({
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

    const user = await prisma.user.create({
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
    const user = await prisma.user.findUnique({ where: { email: dto.email.toLowerCase().trim() } });

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

    const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (
      !stored ||
      stored.revokedAt !== null ||
      stored.expiresAt.getTime() < Date.now() ||
      stored.tokenHash !== hashToken(refreshToken)
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Unknown account' });
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = verifyRefreshToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { id: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Logging out with a dead token is not an error worth surfacing.
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNKNOWN_USER', message: 'Account no longer exists' });
    }
    return toPublicUser(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const accessToken = signAccessToken(user);
    const { token: refreshToken, jti } = signRefreshToken(user.id);

    await prisma.refreshToken.create({
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

/** bcrypt hash of a value nobody can log in with; used to equalise login timing. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.4Y8Q3M4RwuHhWzR0GkD8hR4T6Bl0Wcy';

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}
