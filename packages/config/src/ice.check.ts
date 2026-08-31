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
 * Run with: pnpm --filter @betweenus/config check
 */
import assert from 'node:assert/strict';
import { iceServers, onIceProblem, parseIceServers, resetTurnCache, stunServers } from './ice';

/**
 * Both ways of configuring a relay, unset.
 *
 * A developer's own `.env` is loaded by this package, so a check that asserts
 * "no relay is configured" has to say so rather than assume it - one machine
 * with a coturn in its `.env` would otherwise fail a suite that passes
 * everywhere else.
 */
function unconfigureEveryRelay(): void {
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  delete process.env.TURN_URLS;
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_CREDENTIAL;
}

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
  unconfigureEveryRelay();

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

/**
 * Running without a relay is recorded, once.
 *
 * The whole reason this line exists: with no relay, a call between two networks
 * that cannot reach each other directly joins, shows both people and then
 * carries nothing. From the outside that is indistinguishable from a broken
 * client, and an operator with no line in their log has nothing to go on. Once
 * per process rather than once per join, so it is findable rather than buried
 * under a thousand copies of itself.
 */
async function aMissingRelayIsSaidOutLoudExactlyOnce(): Promise<void> {
  resetTurnCache();
  unconfigureEveryRelay();

  const said: string[] = [];
  onIceProblem((message) => said.push(message));

  try {
    await iceServers();
    assert.equal(said.length, 1, 'a deployment with no relay is told so');
    assert.match(
      said[0] ?? '',
      /not an error/,
      'and told it is the default, not a misconfiguration to panic about',
    );

    await iceServers();
    await iceServers();
    assert.equal(said.length, 1, 'and not once per call, which would bury it');
  } finally {
    onIceProblem(() => undefined);
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

/** What a deployment running its own coturn gets, and that it asks nobody. */
async function anOwnRelayIsHandedOutWithItsCredentials(): Promise<void> {
  resetTurnCache();
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  process.env.TURN_URLS = ' turns:turn.example.com:443?transport=tcp , turn:turn.example.com:3478 ';
  process.env.TURN_USERNAME = 'betweenus';
  process.env.TURN_CREDENTIAL = 'secret';

  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (() => {
    called = true;
    return Promise.reject(new Error('a relay of one\'s own is not minted from anywhere'));
  }) as typeof fetch;

  try {
    const servers = await iceServers();
    assert.equal(called, false, 'static credentials are read, never fetched');

    const relay = servers.find((server) => server.urls.some((url) => url.startsWith('turn')));
    assert.ok(relay, 'the relay reaches the client');
    assert.deepEqual(
      relay?.urls,
      ['turns:turn.example.com:443?transport=tcp', 'turn:turn.example.com:3478'],
      'comma-separated, trimmed, in the order the operator wrote them',
    );
    assert.equal(relay?.username, 'betweenus');
    assert.equal(relay?.credential, 'secret');

    assert.ok(
      servers[0]?.urls.every((url) => url.startsWith('stun:')),
      'and STUN still comes first: a relay is the fallback, not the path',
    );
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.TURN_URLS;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    resetTurnCache();
  }
}

/**
 * A deployment already minting from Cloudflare keeps doing exactly that.
 *
 * The precedence is what makes this change additive: an operator who has set
 * both must not silently move onto the other one on an upgrade.
 */
async function cloudflareWinsWhenBothAreConfigured(): Promise<void> {
  resetTurnCache();
  process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
  process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = 'token';
  process.env.TURN_URLS = 'turns:own.example.com:443?transport=tcp';
  process.env.TURN_USERNAME = 'betweenus';
  process.env.TURN_CREDENTIAL = 'secret';

  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          iceServers: {
            urls: 'turn:turn.cloudflare.com:3478',
            username: 'minted',
            credential: 'minted-secret',
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    )) as typeof fetch;

  try {
    const servers = await iceServers();
    const relays = servers.filter((server) => server.urls.some((url) => url.startsWith('turn')));
    assert.equal(relays.length, 1, 'one relay, not both');
    assert.equal(relays[0]?.username, 'minted', 'and it is the minted one');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
    delete process.env.TURN_URLS;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    resetTurnCache();
  }
}

/**
 * A relay with no credentials is worse than no relay at all.
 *
 * `new RTCPeerConnection({ iceServers: [{ urls: 'turn:...' }] })` throws, so
 * handing one out does not degrade the calls that needed a relay - it takes
 * down every call in the deployment, including the ones that were connecting
 * on STUN alone.
 */
async function aHalfConfiguredRelayIsDroppedAndSaidOutLoud(): Promise<void> {
  resetTurnCache();
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  process.env.TURN_URLS = 'turns:turn.example.com:443?transport=tcp';
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_CREDENTIAL;

  const said: string[] = [];
  onIceProblem((message) => said.push(message));

  try {
    const servers = await iceServers();
    assert.ok(
      servers.every((server) => server.urls.every((url) => url.startsWith('stun:'))),
      'no relay entry leaves without the credentials a client would throw over',
    );
    assert.ok(servers.length > 0, 'and the calls that never needed one still work');
    assert.ok(
      said.some((message) => /TURN_USERNAME or TURN_CREDENTIAL/.test(message)),
      'the operator is told which half is missing',
    );

    const before = said.length;
    await iceServers();
    assert.equal(said.length, before, 'once per process, like every other fact about the config');
  } finally {
    onIceProblem(() => undefined);
    delete process.env.TURN_URLS;
    resetTurnCache();
  }
}

/** STUN named in the relay variable is not a relay, and is not counted as one. */
async function stunInTheRelayVariableIsNotARelay(): Promise<void> {
  resetTurnCache();
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  process.env.TURN_URLS = 'stun:stun.example.com:3478';
  process.env.TURN_USERNAME = 'betweenus';
  process.env.TURN_CREDENTIAL = 'secret';

  const said: string[] = [];
  onIceProblem((message) => said.push(message));

  try {
    const servers = await iceServers();
    assert.ok(
      servers.every((server) => server.credential === undefined),
      'nothing is handed out carrying a credential for a server that wants none',
    );
    assert.ok(
      said.some((message) => /STUN servers belong in STUN_URLS/.test(message)),
      'and the operator is told where it should have gone',
    );
  } finally {
    onIceProblem(() => undefined);
    delete process.env.TURN_URLS;
    delete process.env.TURN_USERNAME;
    delete process.env.TURN_CREDENTIAL;
    resetTurnCache();
  }
}

async function main(): Promise<void> {
  stunIsAlwaysThere();
  anOperatorCanNameTheirOwn();
  theDocumentedListShape();
  theOlderSingleObjectShape();
  nothingUsableIsAnEmptyList();
  await unconfiguredAsksNobodyAndStillWorks();
  await aMissingRelayIsSaidOutLoudExactlyOnce();
  await aFailedMintIsNotAFailedCall();
  await anOwnRelayIsHandedOutWithItsCredentials();
  await cloudflareWinsWhenBothAreConfigured();
  await aHalfConfiguredRelayIsDroppedAndSaidOutLoud();
  await stunInTheRelayVariableIsNotARelay();
  console.log('ice self-check passed');
}

void main();
