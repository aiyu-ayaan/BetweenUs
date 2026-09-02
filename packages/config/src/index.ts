/**
 * Typed environment access. Loads `.env` from the repo root once, then reads
 * variables with explicit required/optional semantics so a missing secret fails
 * at boot instead of at the first request.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Secrets read from a file rather than from the environment.
 *
 * `.env` is where a secret goes when there is nowhere better, and it has the two
 * problems every deployment eventually meets: it is one file holding every
 * secret, and its contents are in the environment of every process the service
 * spawns and in the output of `docker inspect`. `NAME_FILE=/run/secrets/name`
 * points at a file instead, which is what Docker and Podman secrets, Kubernetes
 * projected volumes, systemd credentials and a Vault Agent template all produce.
 * Rotation becomes replacing a file and restarting, with no `.env` edit and no
 * secret in a shell history.
 *
 * `NAME` wins if both are set, so an existing deployment is unaffected and an
 * override for one boot is still a matter of exporting a variable.
 *
 * Read once per path. This sits under `requireEnv`, which is on the path of
 * every request carrying a token, and a file read per verification is not.
 */
const fileValues = new Map<string, string>();

function envFromFile(name: string): string | undefined {
  const path = process.env[`${name}_FILE`];
  if (path === undefined || path === '') return undefined;

  const cached = fileValues.get(path);
  if (cached !== undefined) return cached;

  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (cause) {
    // Loudly. A secret file that cannot be read looks exactly like a secret that
    // was never set, and the second one has a much less obvious fix.
    throw new Error(`${name}_FILE points at ${path}, which could not be read`, { cause });
  }

  // Trimmed, because `echo secret > file` and every editor leave a newline, and
  // a signing key that differs from the one next door by a trailing byte fails
  // as an invalid signature rather than as a configuration mistake.
  const value = contents.trim();
  if (value === '') {
    throw new Error(`${name}_FILE points at ${path}, which is empty`);
  }

  fileValues.set(path, value);
  return value;
}

/** Forgets what was read from disk, so a rotation test can change the file. */
export function resetEnvFileCache(): void {
  fileValues.clear();
}

export function env(name: string): string | undefined {
  loadEnv();
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  return envFromFile(name);
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name} (or ${name}_FILE)`);
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
