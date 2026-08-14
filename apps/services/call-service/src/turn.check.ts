/**
 * `parseIceServers`, and that an unconfigured deployment stays quiet.
 *
 * The shape is the part worth pinning: Cloudflare has answered `iceServers` as
 * a bare object and as a list, `urls` is a string or a list of them per the
 * WebRTC dictionary, and getting any of it wrong is a call that will not connect
 * from outside the SFU's own network - the exact failure this code exists to
 * remove, arriving through the code meant to fix it.
 *
 * Run with: pnpm --filter @nexora/call-service check
 */
import assert from 'node:assert/strict';
import { parseIceServers, iceServers, resetTurnCache } from './turn';

function theDocumentedListShape(): void {
  const parsed = parseIceServers({
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'user',
        credential: 'secret',
      },
    ],
  });

  assert.equal(parsed.length, 2, 'both entries survive');
  assert.deepEqual(parsed[0], {
    urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'],
  });
  assert.equal(parsed[1]?.username, 'user', 'credentials are carried, or the relay refuses');
  assert.equal(parsed[1]?.credential, 'secret');
}

function theOlderSingleObjectShape(): void {
  const parsed = parseIceServers({
    iceServers: { urls: 'turn:turn.cloudflare.com:3478', username: 'u', credential: 'c' },
  });

  assert.deepEqual(parsed, [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' }]);
}

function nothingUsableIsAnEmptyList(): void {
  assert.deepEqual(parseIceServers(null), []);
  assert.deepEqual(parseIceServers({}), []);
  assert.deepEqual(parseIceServers({ iceServers: [] }), []);
  // An entry with no URL is not a relay, whatever else it carries.
  assert.deepEqual(parseIceServers({ iceServers: [{ username: 'u', credential: 'c' }] }), []);
  assert.deepEqual(parseIceServers({ iceServers: [{ urls: [] }] }), []);
}

async function unconfiguredAsksNobody(): Promise<void> {
  resetTurnCache();
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;

  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    called = true;
    return Promise.reject(new Error('should not have been called'));
  }) as typeof fetch;

  try {
    assert.deepEqual(await iceServers(), [], 'no key configured is an empty list, not an error');
    assert.equal(called, false, 'and no request at all');
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** A relay that cannot be minted must not take the calls that did work with it. */
async function aFailedMintIsNotAFailedCall(): Promise<void> {
  resetTurnCache();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
  process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = 'token';

  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response('nope', { status: 401 }))) as typeof fetch;

  try {
    assert.deepEqual(await iceServers(), []);
  } finally {
    globalThis.fetch = realFetch;
    resetTurnCache();
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  }
}

async function main(): Promise<void> {
  theDocumentedListShape();
  theOlderSingleObjectShape();
  nothingUsableIsAnEmptyList();
  await unconfiguredAsksNobody();
  await aFailedMintIsNotAFailedCall();
  console.log('turn.check.ts: ok');
}

void main();
