/**
 * Self-check for the address parsing behind the server picker.
 *
 * Run with `pnpm --filter @nexora/desktop check`. Only the pure functions are
 * exercised here: everything else in endpoint.ts is localStorage and fetch.
 */
import assert from 'node:assert/strict';
import {
  MAX_RECENT_SERVERS,
  baseFromProbeUrl,
  defaultServerUrl,
  normalizeServerUrl,
  toWebSocketUrl,
  versionVerdict,
  withRecent,
} from './endpoint';

// Served over http(s) - a dev server, or the web client behind Nginx - means the
// origin is the gateway. A packaged renderer loads from file:// and falls back
// to what the build shipped with.
const asWindow = (href: string): void => {
  (globalThis as { window?: unknown }).window = { location: { origin: new URL(href).origin } };
};
asWindow('https://nexora.example.com/');
assert.equal(defaultServerUrl(), 'https://nexora.example.com');
asWindow('http://localhost:5173/');
assert.equal(defaultServerUrl(), 'http://localhost:5173');
(globalThis as { window?: unknown }).window = { location: { origin: 'null' } };
assert.equal(defaultServerUrl(), 'http://localhost:8080');
delete (globalThis as { window?: unknown }).window;
assert.equal(defaultServerUrl(), 'http://localhost:8080');


// What a person types, and what it has to become.
assert.equal(normalizeServerUrl('nexora.example.com'), 'https://nexora.example.com');
assert.equal(normalizeServerUrl('  nexora.example.com/  '), 'https://nexora.example.com');
assert.equal(normalizeServerUrl('http://192.168.1.4:8080'), 'http://192.168.1.4:8080');
assert.equal(normalizeServerUrl('https://example.com:8443///'), 'https://example.com:8443');
// A deployment under a path keeps it; a query or fragment is not part of a base.
assert.equal(normalizeServerUrl('https://example.com/nexora'), 'https://example.com/nexora');
assert.equal(normalizeServerUrl('https://example.com/nexora/?a=1#b'), 'https://example.com/nexora');

for (const bad of ['', '   ', 'ftp://example.com', 'https://']) {
  assert.throws(() => normalizeServerUrl(bad), Error, `should refuse ${JSON.stringify(bad)}`);
}

assert.equal(toWebSocketUrl('https://nexora.example.com'), 'wss://nexora.example.com');
assert.equal(toWebSocketUrl('http://127.0.0.1:8080'), 'ws://127.0.0.1:8080');
// Only the scheme changes - a host with "http" in its name is left alone.
assert.equal(toWebSocketUrl('https://http-relay.example.com'), 'wss://http-relay.example.com');

// Where the probe ended is what gets stored: a redirect to another origin would
// otherwise strip the Authorization header off every authenticated request.
const probe = '/api/v1/auth/oauth/providers';
assert.equal(
  baseFromProbeUrl(`https://nexora.example.com${probe}`, 'http://nexora.example.com'),
  'https://nexora.example.com',
);
assert.equal(
  baseFromProbeUrl(`https://example.com/nexora${probe}`, 'https://example.com/nexora'),
  'https://example.com/nexora',
);
// Redirected somewhere that is not the probe path: keep what was asked for.
assert.equal(baseFromProbeUrl('https://example.com/login', 'https://example.com/'), 'https://example.com');

console.log('endpoint self-check passed');

// --- The recent list --------------------------------------------------------

const A = 'https://a.example.com';
const B = 'https://b.example.com';

assert.deepEqual(withRecent([], A), [A]);
// Newest first, and connecting to one already in the list moves it rather than
// adding a second copy of it.
assert.deepEqual(withRecent([A], B), [B, A]);
assert.deepEqual(withRecent([B, A], A), [A, B]);
assert.deepEqual(withRecent([A, B], A), [A, B]);

// It does not grow without bound: the oldest falls off the end.
const many = Array.from({ length: MAX_RECENT_SERVERS }, (_, at) => `https://${at}.example.com`);
const grown = withRecent(many, 'https://new.example.com');
assert.equal(grown.length, MAX_RECENT_SERVERS);
assert.equal(grown[0], 'https://new.example.com');
assert.equal(grown.includes(many[MAX_RECENT_SERVERS - 1]!), false);

// --- Contract mismatch ------------------------------------------------------

assert.equal(versionVerdict(1, 1), null);
assert.equal(versionVerdict(2, 1), 'client-too-old');
assert.equal(versionVerdict(1, 2), 'server-too-old');
// A deployment from before this route existed says nothing, and a client that
// shouted about that would make every existing install look broken.
assert.equal(versionVerdict(null, 1), null);
