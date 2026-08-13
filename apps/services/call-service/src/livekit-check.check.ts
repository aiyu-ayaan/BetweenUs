/**
 * Self-check for the addresses the key check tries.
 *
 * Run with `pnpm --filter @nexora/call-service check`. Only the address list is
 * exercised - the rest of livekit-check.ts is one fetch and a logger - but that
 * list is the whole reason a mismatched secret is visible under `pnpm dev`
 * instead of only inside Docker, so it is the part worth pinning.
 */
import assert from 'node:assert/strict';
import { internalUrls } from './livekit-check';

// The first call is what loads the repo `.env`; deleting afterwards makes the
// cases below independent of whatever that file happens to hold.
internalUrls();

function withEnv(vars: Record<string, string | undefined>): string[] {
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return internalUrls();
}

// An explicit address is the operator's answer and is used alone. Compose sets
// it, which is why a container never pays for the loopback attempt below.
assert.deepEqual(
  withEnv({ LIVEKIT_INTERNAL_URL: 'http://livekit:7880/', LIVEKIT_URL: '/livekit' }),
  ['http://livekit:7880'],
);

// A client address that is absolute is also reachable from here; ws -> http,
// because /rtc/validate is a plain GET.
assert.deepEqual(
  withEnv({ LIVEKIT_INTERNAL_URL: undefined, LIVEKIT_URL: 'ws://192.168.1.4:7880' }),
  ['http://192.168.1.4:7880'],
);
assert.deepEqual(withEnv({ LIVEKIT_URL: 'wss://sfu.example.com/' }), ['https://sfu.example.com']);
assert.deepEqual(withEnv({ LIVEKIT_URL: 'WSS://SFU.EXAMPLE.COM' }), ['HTTPS://SFU.EXAMPLE.COM']);

// The path form says nothing about where the SFU is, so both deployments are
// tried: the container name resolves inside compose, the published port on a
// host running `pnpm dev`. Missing the second was why development never saw a
// key mismatch - the check reported "could not reach" and joins went ahead.
assert.deepEqual(withEnv({ LIVEKIT_URL: '/livekit' }), [
  'http://livekit:7880',
  'http://127.0.0.1:7880',
]);
assert.deepEqual(withEnv({ LIVEKIT_URL: undefined }), [
  'http://livekit:7880',
  'http://127.0.0.1:7880',
]);

console.log('livekit-check: ok');
