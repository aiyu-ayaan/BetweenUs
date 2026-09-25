/**
 * Where each backend service listens in host dev mode, for everything that has
 * to reach them without being one of them: the two Vite proxies, the dev
 * gateway and `dev:duo`.
 *
 * The services take their port from `<NAME>_PORT` in the repo `.env`. The
 * callers used to take theirs from `<NAME>_URL` in the *process* environment,
 * defaulting to the stock ports - and turbo drops variables it does not know
 * about, so under `pnpm dev` that meant the stock ports, always. Moving a
 * service off a port something else on the machine already holds (3001 is a
 * popular one) then left every proxy pointed at the old address. Reading the
 * same `.env` the services read keeps the two halves agreeing.
 *
 * Order: `<NAME>_URL` in the environment, then `<NAME>_PORT` in the
 * environment, then `<NAME>_PORT` in `.env`, then the stock port.
 *
 * `.env` is parsed, never sourced: it is data, and a line that happens to read
 * as a shell command must not run as one.
 */
import { existsSync, readFileSync } from 'node:fs';

const ENV_FILE = new URL('../.env', import.meta.url);

/** The services, by the name their variables share, and their stock ports. */
const SERVICES = {
  AUTH_SERVICE: { port: 3001, health: 'auth-service' },
  SERVER_SERVICE: { port: 3003, health: 'server-service' },
  CHAT_SERVICE: { port: 3004, health: 'chat-service' },
  PRESENCE_SERVICE: { port: 3005, health: 'presence-service' },
  NOTIFICATION_SERVICE: { port: 3006, health: 'notification-service' },
  CALL_SERVICE: { port: 3007, health: 'call-service' },
  REMOTE_GATEWAY: { port: 3008, health: 'remote-gateway' },
};

/** `KEY=value` lines, with optional matching quotes. Comments and junk are skipped. */
export function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function fileEnv() {
  try {
    return existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}

/** The address of every service, keyed like `AUTH_SERVICE`. */
export function serviceUrls(env = process.env, file = fileEnv()) {
  const urls = {};
  for (const [name, { port }] of Object.entries(SERVICES)) {
    const chosen = env[`${name}_PORT`] || file[`${name}_PORT`] || String(port);
    urls[name] = env[`${name}_URL`] || `http://127.0.0.1:${chosen}`;
  }
  return urls;
}

/**
 * Asks each service's `/health` who it is, and says so when the answer is
 * wrong or missing. A port held by some other program answers requests too -
 * with its own 404s, which reach the sign-up form as "Request failed" and
 * point nowhere near the real problem.
 */
export async function reportServices(urls = serviceUrls(), warn = console.warn) {
  const problems = [];
  await Promise.all(
    Object.entries(SERVICES).map(async ([name, { health }]) => {
      const url = urls[name];
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
        const body = await response.json().catch(() => null);
        if (body?.service !== health) {
          problems.push(
            `${health} expected on ${url}, but something else answers there. ` +
              `Free the port, or set ${name}_PORT in .env to one that is free.`,
          );
        }
      } catch {
        // Nothing listening yet is normal while `pnpm dev` is still starting.
      }
    }),
  );
  for (const problem of problems) warn(`  ! ${problem}`);
  return problems;
}
