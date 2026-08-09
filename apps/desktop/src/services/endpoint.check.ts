/**
 * Self-check for the address parsing behind the server picker.
 *
 * Run with `pnpm --filter @nexora/desktop check`. Only the pure functions are
 * exercised here: everything else in endpoint.ts is localStorage and fetch.
 */
import assert from 'node:assert/strict';
import { normalizeServerUrl, toWebSocketUrl } from './endpoint';

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

console.log('endpoint self-check passed');
