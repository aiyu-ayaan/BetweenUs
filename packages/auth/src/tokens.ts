import { randomUUID, createHash } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { envOr, requireEnv } from '@nexora/config';
import type { JwtAccessPayload, JwtRefreshPayload, PublicUser } from '@nexora/shared-types';

export function accessSecret(): string {
  return requireEnv('JWT_SECRET');
}

export function refreshSecret(): string {
  return requireEnv('JWT_REFRESH_SECRET');
}

export function accessTtl(): string {
  return envOr('JWT_ACCESS_TTL', '15m');
}

export function refreshTtl(): string {
  return envOr('JWT_REFRESH_TTL', '30d');
}

export function signAccessToken(user: Pick<PublicUser, 'id' | 'email' | 'username'>): string {
  const payload: JwtAccessPayload = {
    sub: user.id,
    email: user.email,
    username: user.username,
    type: 'access',
  };
  return jwt.sign(payload, accessSecret(), { expiresIn: accessTtl() } as SignOptions);
}

/** Returns the token plus its `jti`, which the caller persists to allow revocation. */
export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = randomUUID();
  const payload: JwtRefreshPayload = { sub: userId, jti, type: 'refresh' };
  const token = jwt.sign(payload, refreshSecret(), { expiresIn: refreshTtl() } as SignOptions);
  return { token, jti };
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  const decoded = jwt.verify(token, accessSecret()) as JwtAccessPayload;
  if (decoded.type !== 'access') throw new Error('Not an access token');
  return decoded;
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  const decoded = jwt.verify(token, refreshSecret()) as JwtRefreshPayload;
  if (decoded.type !== 'refresh') throw new Error('Not a refresh token');
  return decoded;
}

/** Refresh tokens are stored hashed: a database leak must not yield usable tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Seconds until an access token expires, for the client to schedule refresh. */
export function accessTokenLifetimeSeconds(): number {
  const ttl = accessTtl();
  const match = /^(\d+)([smhd])?$/.exec(ttl);
  if (!match) return 900;
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
  return amount * multiplier;
}

/** Reads a bearer token from an Authorization header value. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return null;
  return value;
}
