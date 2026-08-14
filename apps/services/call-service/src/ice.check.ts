/**
 * That a client is always given a way to discover its own address, that a
 * deployment which configures no relay stays quiet, and `parseIceServers`.
 *
 * The two things worth pinning:
 *
 * - STUN is never absent. It is the one step of ICE with no fallback: a peer
 *   that cannot learn its public address has nothing to offer, and the call
 *   does not happen. An empty ICE list would be that failure, arriving from
 *   the code meant to prevent it.
 * - Cloudflare's shape. It has answered `iceServers` as a bare object and as a
 *   list, and `urls` is a string or a list of them per the WebRTC dictionary.
 *
 * Run with: pnpm --filter @nexora/call-service check
 */
import assert from 'node:assert/strict';
import { iceServers, parseIceServers, resetTurnCache, stunServers } from './ice';

function stunIsAlwaysThere(): void {
  delete process.env.STUN_URLS;
  const servers = stunServers();
  assert.equal(servers.length, 1, 'the default is one entry with several URLs');
  assert.ok(
    (servers[0]?.urls.length ?? 0) >= 2,
    'more than one operator, because STUN has no fallback',
  );
  assert.ok(
    servers[0]?.urls.every((url) => url.startsWith('stun:')),
    'STUN only - a relay never arrives by this route',
  );
}

function anOperatorCanNameTheirOwn(): void {
  process.env.STUN_URLS = ' stun:stun.example.com:3478 , stun:backup.example.com:3478 ';
  assert.deepEqual(stunServers(), [
    { urls: ['stun:stun.example.com:3478', 'stun:backup.example.com:3478'] },
  ]);

  // Blank means blank, not "fall back to the default": an operator who empties
  // it has said something, and a call that then fails to connect is a clearer
  // signal than one silently talking to Google.
  process.env.STUN_URLS = '  ,  ';
  assert.deepEqual(stunServers(), []);
  delete process.env.STUN_URLS;
}

function theDocumentedListShape(): void {
  const parsed = parseIceServers({
    iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
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

  assert.deepEqual(parsed, [
    { urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' },
  ]);
}

function nothingUsableIsAnEmptyList(): void {
  assert.deepEqual(parseIceServers(null), []);
  assert.deepEqual(parseIceServers({}), []);
  assert.deepEqual(parseIceServers({ iceServers: [] }), []);
  // An entry with no URL is not a relay, whatever else it carries.
  assert.deepEqual(parseIceServers({ iceServers: [{ username: 'u', credential: 'c' }] }), []);
  assert.deepEqual(parseIceServers({ iceServers: [{ urls: [] }] }), []);
}

async function unconfiguredAsksNobodyAndStillWorks(): Promise<void> {
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
    const servers = await iceServers();
    assert.equal(called, false, 'no relay configured means no request at all');
    assert.ok(servers.length > 0, 'and still a usable answer: STUN needs no configuration');
    assert.ok(
      servers.every((server) => server.urls.every((url) => url.startsWith('stun:'))),
      'nothing is relayed on a deployment that configured no relay',
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** A relay that cannot be minted must not take the calls that did work without it. */
async function aFailedMintIsNotAFailedCall(): Promise<void> {
  resetTurnCache();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
  process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = 'token';

  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response('nope', { status: 401 }))) as typeof fetch;

  try {
    const servers = await iceServers();
    assert.ok(servers.length > 0, 'STUN survives a failed mint');
    assert.ok(
      servers.every((server) => server.urls.every((url) => url.startsWith('stun:'))),
      'and no half-minted relay is handed out',
    );
  } finally {
    globalThis.fetch = realFetch;
    resetTurnCache();
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  }
}

async function main(): Promise<void> {
  stunIsAlwaysThere();
  anOperatorCanNameTheirOwn();
  theDocumentedListShape();
  theOlderSingleObjectShape();
  nothingUsableIsAnEmptyList();
  await unconfiguredAsksNobodyAndStillWorks();
  await aFailedMintIsNotAFailedCall();
  console.log('ice.check.ts: ok');
}

void main();
