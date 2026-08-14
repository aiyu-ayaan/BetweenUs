/**
 * Typed environment access. Loads `.env` from the repo root once, then reads
 * variables with explicit required/optional semantics so a missing secret fails
 * at boot instead of at the first request.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

/** Walks up from cwd to find the repo-root `.env`. Safe to call repeatedly. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv();
}

export function env(name: string): string | undefined {
  loadEnv();
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}

export function envNumber(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

export function envBool(name: string, fallback = false): boolean {
  const raw = env(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function isProduction(): boolean {
  return envOr('NODE_ENV', 'development') === 'production';
}

/** `127.x.x.x`, `::1` or `localhost`. */
const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|::1|\[::1\]|localhost)$/i;

/**
 * The hostname in a configured address, or `''` when it has none.
 *
 * A path (`/livekit`) has no host by design - the client resolves it against
 * the address it is already talking to - so it is the one answer that is right
 * everywhere, and `''` is how it says so.
 */
function hostnameOf(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('/')) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme).hostname;
  } catch {
    return '';
  }
}

/**
 * An address this deployment is about to hand a client, which that client cannot
 * possibly reach.
 *
 * A loopback address means "this machine", and a service handing one out is
 * telling every client to dial *itself*. On the machine running the stack that
 * is correct and works, which is what makes it such a good trap: the operator
 * tests locally, sees a call connect, and the first phone or second desktop gets
 * `ERR_CONNECTION_REFUSED` and a client-side "Failed to fetch" with nothing in
 * it that names the cause.
 *
 * `requestHost` is the caller's own `Host` header - the address it typed, which
 * Nginx forwards - so a browser on the server itself is still allowed a loopback
 * answer. No header to compare means nothing is refused.
 */
export function unreachableFromCaller(advertised: string, requestHost: string | undefined): boolean {
  const target = hostnameOf(advertised);
  if (!target || !LOOPBACK.test(target)) return false;
  const caller = hostnameOf(requestHost ?? '');
  return caller !== '' && !LOOPBACK.test(caller);
}

/** Config every service needs. Service-specific values stay in the service. */
export interface BaseServiceConfig {
  nodeEnv: string;
  port: number;
  logLevel: string;
  corsOrigin: string;
  databaseUrl: string;
  redisUrl: string;
}

export function baseConfig(portVar: string, defaultPort: number): BaseServiceConfig {
  return {
    nodeEnv: envOr('NODE_ENV', 'development'),
    port: envNumber(portVar, defaultPort),
    logLevel: envOr('LOG_LEVEL', 'info'),
    corsOrigin: envOr('CORS_ORIGIN', '*'),
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: envOr('REDIS_URL', 'redis://localhost:6379'),
  };
}
