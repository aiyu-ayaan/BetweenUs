import { randomUUID, createHash } from 'node:crypto';
import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import { env, envOr, isProduction, requireEnv } from '@betweenus/config';
import type { JwtAccessPayload, JwtRefreshPayload, PublicUser } from '@betweenus/shared-types';

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
  'betweenus',
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
  validateSecret(name, value);
  checked.set(name, value);
  return value;
}

/**
 * The secret this deployment signed with until the last rotation.
 *
 * Rotating a signing secret without one signs out everybody holding a token,
 * which for `JWT_REFRESH_SECRET` and a 90-day refresh means every account on
 * every device - so in practice the secret never gets rotated, which is the
 * failure this exists to prevent. `JWT_SECRET_PREVIOUS` is accepted on the way
 * in and never used to sign, so a rotation is: move the old value to
 * `_PREVIOUS`, put the new one in `JWT_SECRET`, restart. Tokens signed with the
 * old one keep verifying until it is removed, which should be one access-token
 * lifetime later for `JWT_SECRET` and whenever the last refresh has expired or
 * been spent for `JWT_REFRESH_SECRET`.
 *
 * Held to the same floor as the live one. A previous secret verifies real
 * sessions, so a placeholder here forges them just as well as a placeholder
 * there.
 */
function previousSigningSecret(name: string): string | undefined {
  const key = `${name}_PREVIOUS`;
  const cached = checked.get(key);
  if (cached !== undefined) return cached;

  const value = env(key);
  if (value === undefined) return undefined;
  validateSecret(key, value);
  checked.set(key, value);
  return value;
}

function validateSecret(name: string, value: string): void {
  if (PLACEHOLDER_SECRETS.has(value.toLowerCase())) {
    throw new Error(
      `${name} is still set to a placeholder. Generate one: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`,
    );
  }
  if (isProduction() && value.length < MIN_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }
}

/**
 * Verify against the live secret, then against the one before it.
 *
 * The original error is what gets thrown when both fail, not the second
 * attempt's: an expired token fails both ways, and "jwt expired" is the useful
 * half of that pair.
 */
function verifyWithRotation(token: string, name: string, current: string): unknown {
  try {
    return jwt.verify(token, current, VERIFY);
  } catch (error) {
    const previous = previousSigningSecret(name);
    if (previous === undefined) throw error;
    try {
      return jwt.verify(token, previous, VERIFY);
    } catch {
      throw error;
    }
  }
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
  return envOr('JWT_REFRESH_TTL', '90d');
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
  const decoded = verifyWithRotation(token, 'JWT_SECRET', accessSecret()) as JwtAccessPayload;
  if (decoded.type !== 'access') throw new Error('Not an access token');
  return decoded;
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  const decoded = verifyWithRotation(token, 'JWT_REFRESH_SECRET', refreshSecret()) as JwtRefreshPayload;
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
