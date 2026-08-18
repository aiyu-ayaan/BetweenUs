import { randomUUID, createHash } from 'node:crypto';
import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { envOr, isProduction, requireEnv } from '@nexora/config';
import type { JwtAccessPayload, JwtRefreshPayload, PublicUser } from '@nexora/shared-types';

/**
 * The one algorithm this deployment signs with, named on the way in as well as
 * on the way out.
 *
 * `jwt.verify` without `algorithms` accepts whatever the token's own header
 * asks for, which is a token telling the verifier how to check it. Pinning it
 * costs a line and removes the whole family of confusion attacks that starts
 * there.
 */
const ALGORITHM = 'HS256' as const;
const VERIFY: VerifyOptions = { algorithms: [ALGORITHM] };

/**
 * Values that mean "nobody has set this yet".
 *
 * `.env.example` ships `replace-me`, which is the point of it - and a
 * deployment that copied the file and never generated a secret would sign real
 * sessions with a string that is in this repository. Anyone could mint an
 * access token for any account. That is not a warning, it is a boot failure.
 */
const PLACEHOLDER_SECRETS = new Set([
  'replace-me',
  'replace-me-too',
  'change-me',
  'changeme',
  'secret',
  'password',
  'nexora',
]);

/** Below this a secret is short enough to be worth attacking offline. */
const MIN_SECRET_LENGTH = 32;

/**
 * Reads a signing secret and refuses the ones that would make every signature
 * worthless.
 *
 * The length floor is production-only: a development stack running on
 * `pnpm dev` has no session worth forging, and a rule that stops people working
 * is a rule that gets an override flag and then gets used in production anyway.
 * The placeholder list is enforced everywhere, because a value out of a file in
 * this repo is never what anybody meant.
 *
 * Memoised, since this runs on the path of every request that carries a token.
 */
const checked = new Map<string, string>();

function signingSecret(name: string): string {
  const cached = checked.get(name);
  if (cached !== undefined) return cached;

  const value = requireEnv(name);
  if (PLACEHOLDER_SECRETS.has(value.toLowerCase())) {
    throw new Error(
      `${name} is still set to a placeholder. Generate one: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
    );
  }
  if (isProduction() && value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }

  checked.set(name, value);
  return value;
}

/** Forgets what was validated, so a test can change the environment. */
export function resetSecretCache(): void {
  checked.clear();
}

export function accessSecret(): string {
  const secret = signingSecret('JWT_SECRET');
  // Two secrets that are the same secret are one secret, and the type check
  // inside the payload becomes the only thing keeping a refresh token from
  // being spent as an access token.
  if (secret === signingSecret('JWT_REFRESH_SECRET')) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must differ');
  }
  return secret;
}

export function refreshSecret(): string {
  return signingSecret('JWT_REFRESH_SECRET');
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
  return jwt.sign(payload, accessSecret(), { expiresIn: accessTtl(), algorithm: ALGORITHM } as SignOptions);
}

/** Returns the token plus its `jti`, which the caller persists to allow revocation. */
export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = randomUUID();
  const payload: JwtRefreshPayload = { sub: userId, jti, type: 'refresh' };
  const token = jwt.sign(payload, refreshSecret(), {
    expiresIn: refreshTtl(),
    algorithm: ALGORITHM,
  } as SignOptions);
  return { token, jti };
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  const decoded = jwt.verify(token, accessSecret(), VERIFY) as JwtAccessPayload;
  if (decoded.type !== 'access') throw new Error('Not an access token');
  return decoded;
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  const decoded = jwt.verify(token, refreshSecret(), VERIFY) as JwtRefreshPayload;
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
