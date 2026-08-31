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

// There were three exports here - LOOPBACK, hostnameOf and
// unreachableFromCaller - whose whole job was to catch a deployment about to
// hand a client a media-server address only the server itself could reach.
// Nothing advertises an address any more, so there is nothing left to check.

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

export {
  iceServers,
  onIceProblem,
  resetIceWarnings,
  stunServers,
  type IceServerConfig,
} from './ice';
