/**
 * Which deployment this client talks to.
 *
 * One address is all a client needs. REST, `/ws/chat`, `/ws/presence` and the
 * stored files are all behind the same gateway, and the LiveKit address arrives
 * inside the call token rather than being configured here - so a deployment is
 * one URL, not a list of them.
 *
 * That address comes from `VITE_API_URL` at build time, and the login screen
 * can point this window at a different one at any time (the choice is kept in
 * localStorage, per profile). Nothing else in the client is allowed to know a
 * host: everything goes through `serverUrl`, `wsUrl` or `absoluteUrl`.
 */

const KEY = 'nexora.serverUrl';

/** Trailing slashes make `${base}${path}` produce `//api`, which Nginx 404s. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Accepts what a person types - `nexora.example.com`, `http://192.168.1.4:8080`,
 * a pasted URL with a path and a trailing slash - and returns the base every
 * request is built on. Throws when it is not an address at all.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Enter a server address');

  // No scheme means https: a self-hosted instance on the public internet is the
  // common case, and http has to be asked for deliberately.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('That is not a valid address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The address must start with http:// or https://');
  }

  // A path is kept - a deployment may live under /nexora behind someone's
  // existing reverse proxy - but a query or a fragment is not part of a base.
  return trimTrailingSlash(`${url.origin}${url.pathname}`);
}

/** `https://host` -> `wss://host`, which is the same gateway over a socket. */
export function toWebSocketUrl(base: string): string {
  return base.replace(/^http/i, (match) => (match === 'HTTP' ? 'WS' : 'ws'));
}

/**
 * Where this build points when nobody has chosen otherwise.
 *
 * Anything loaded over http(s) was served *by* a gateway, so that origin is the
 * answer: under `pnpm dev` the Vite dev server proxies /api and /ws straight to
 * the services (see vite.config.ts), and the web client in `apps/web` is a
 * static bundle behind the real Nginx. Both would be wrong to send elsewhere.
 *
 * Only a packaged renderer, which loads from `file://`, has no origin to go on -
 * and `VITE_API_URL` is the default it ships with. Pointing any window at a
 * different deployment is what the login screen's server picker is for.
 */
export function defaultServerUrl(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  if (/^https?:/i.test(origin)) return origin;
  const configured = import.meta.env?.VITE_API_URL?.trim();
  if (configured) return trimTrailingSlash(configured);
  return 'http://localhost:8080';
}

let cached: string | null = null;

/** The gateway base for every request this window makes. Never ends in `/`. */
export function serverUrl(): string {
  if (cached !== null) return cached;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  cached = stored ? trimTrailingSlash(stored) : defaultServerUrl();
  return cached;
}

/** True while this window is on the address the build shipped with. */
export function isDefaultServer(): boolean {
  return serverUrl() === defaultServerUrl();
}

/** Stores a chosen address; `null` goes back to the one the build shipped. */
export function setServerUrl(url: string | null): void {
  if (url === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, trimTrailingSlash(url));
  cached = null;
}

/** Base for the two WebSockets. Same host, same path, ws scheme. */
export function wsUrl(): string {
  return toWebSocketUrl(serverUrl());
}

/**
 * Resolves a URL the server handed back - an avatar, a server icon - against
 * the current deployment. They come back rooted at `/api/v1/uploads/...`, which
 * a packaged renderer would otherwise resolve against `file://`.
 */
export function absoluteUrl(url: string): string {
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  return `${serverUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Checks an address before this window commits to it, so a typo is a message
 * under the field rather than an app that no longer starts.
 *
 * The provider list is the probe because it is the one route that is public,
 * always present, and answers with something recognisably Nexora.
 */
const PROBE_PATH = '/api/v1/auth/oauth/providers';

/**
 * The base a request actually landed on, given the URL the probe ended at.
 *
 * `http://host` that redirects to `https://host`, or `www.host` that redirects
 * to the apex, is a *different origin*: Chromium drops the Authorization header
 * across an origin change, so every authenticated call arrives anonymous and
 * the server answers "Missing bearer token". Storing where the probe ended
 * means nothing is ever redirected again.
 */
export function baseFromProbeUrl(probeUrl: string, fallback: string): string {
  if (!probeUrl.endsWith(PROBE_PATH)) return trimTrailingSlash(fallback);
  return trimTrailingSlash(probeUrl.slice(0, -PROBE_PATH.length));
}

/** Returns the address to store, which is where the probe ended up. */
export async function probeServer(base: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${base}${PROBE_PATH}`, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new Error('Could not reach that address');
  }

  if (!response.ok) throw new Error(`That address answered ${response.status}`);

  const body: unknown = await response.json().catch(() => null);
  if (!Array.isArray(body)) throw new Error('That address is not a Nexora server');

  return baseFromProbeUrl(response.url, base);
}
