/**
 * Which deployment this client talks to.
 *
 * One address is all a client needs. REST, `/ws/chat`, `/ws/presence`,
 * `/ws/call`, `/ws/remote` and the stored files are all behind the same
 * gateway, and media does not have an address at all - it goes directly to the
 * other participants. So a deployment is one URL, not a list of them.
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
  rememberServer(url ?? defaultServerUrl());
}

// --- Where this client has been ---------------------------------------------

const RECENT_KEY = 'nexora.recentServers';

/**
 * How many addresses are worth keeping.
 *
 * Long enough for the machines somebody actually has - a home server, a work
 * one, a laptop on the LAN, a staging box - and short enough that the list is
 * still something you can point at rather than search.
 */
export const MAX_RECENT_SERVERS = 6;

/**
 * Addresses this client has connected to, most recent first.
 *
 * Only one address was ever remembered, which made every other deployment a
 * thing to be typed from memory - and a self-hosted address is exactly the kind
 * of string nobody has memorised. Nothing secret is in here: an address is
 * public by the time anybody can connect to it.
 */
export function recentServers(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** Puts an address at the top of the list, without duplicating it. */
export function rememberServer(url: string): void {
  const next = withRecent(recentServers(), trimTrailingSlash(url));
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A profile with no storage keeps working; it just has no history.
  }
}

/** Drops one, for an address that has gone away or was a typo worth burying. */
export function forgetServer(url: string): void {
  const next = recentServers().filter((item) => item !== trimTrailingSlash(url));
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // As above.
  }
}

/**
 * The list with `url` at the front. Pure, because the ordering is the part with
 * a bug in it: an address connected to twice must move rather than appear
 * twice, and the list must not grow without bound.
 */
export function withRecent(existing: readonly string[], url: string): string[] {
  return [url, ...existing.filter((item) => item !== url)].slice(0, MAX_RECENT_SERVERS);
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

// --- Whether this client and that deployment still agree ---------------------

const VERSION_PATH = '/api/v1/auth/version';

/**
 * What a client should say about a deployment it does not match.
 *
 * Null for the ordinary case, which is both ends on the same contract, and for
 * a deployment too old to answer at all - one that has never heard of the route
 * is one from before this existed, and shouting about it would make every
 * existing install look broken.
 */
export type VersionVerdict = 'client-too-old' | 'server-too-old' | null;

export function versionVerdict(server: number | null, client: number): VersionVerdict {
  if (server === null) return null;
  if (server > client) return 'client-too-old';
  if (server < client) return 'server-too-old';
  return null;
}

/**
 * Asks a deployment what it speaks. Null when it will not say - an older
 * deployment, or one that is simply unreachable, and neither is a thing to
 * refuse to start over.
 */
export async function fetchServerContract(base: string = serverUrl()): Promise<number | null> {
  try {
    const response = await fetch(`${base}${VERSION_PATH}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const contract = (body as { contract?: unknown } | null)?.contract;
    return typeof contract === 'number' ? contract : null;
  } catch {
    return null;
  }
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
