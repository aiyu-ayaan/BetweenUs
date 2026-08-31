/**
 * That a client is always given a way to discover its own address, that a
 * deployment which configures no relay stays quiet about it exactly once, and
 * that a configured relay reaches the client with its credentials.
 *
 * The things worth pinning:
 *
 * - STUN is never absent. It is the one step of ICE with no fallback: a peer
 *   that cannot learn its public address has nothing to offer, and the call
 *   does not happen. An empty ICE list would be that failure, arriving from
 *   the code meant to prevent it.
 * - A configured relay is handed out. This is the whole point of the module,
 *   and the regression that motivated removing the hosted minting path was
 *   precisely this not happening while the configuration said it should.
 * - Nothing here touches the network. A relay read from the environment cannot
 *   fail to resolve, and a check that lets a `fetch` through would not notice
 *   if that stopped being true.
 *
 * Run with: pnpm --filter @betweenus/config check
 */
import assert from 'node:assert/strict';
import { iceServers, onIceProblem, resetIceWarnings, stunServers } from './ice';

/**
 * The relay, unset.
 *
 * A developer's own `.env` is loaded by this package, so a check that asserts
 * "no relay is configured" has to say so rather than assume it - one machine
 * with a coturn in its `.env` would otherwise fail a suite that passes
 * everywhere else.
 */
function unconfigureTheRelay(): void {
  delete process.env.TURN_URLS;
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_CREDENTIAL;
}

/**
 * Nothing in this module may reach the network.
 *
 * Runs for the whole suite rather than per case: the reason the hosted path was
 * removed is that a network call in here can fail while the configuration looks
 * complete, and the way to keep that from coming back is for any `fetch` at all
 * to be a failed check rather than a slow one.
 */
function forbidTheNetwork(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error('ice must not reach the network: a relay is read from the environment');
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
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

async function unconfiguredStillWorks(): Promise<void> {
  resetIceWarnings();
  unconfigureTheRelay();

  const servers = await iceServers();
  assert.ok(servers.length > 0, 'a usable answer: STUN needs no configuration');
  assert.ok(
    servers.every((server) => server.urls.every((url) => url.startsWith('stun:'))),
    'nothing is relayed on a deployment that configured no relay',
  );
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
  resetIceWarnings();
  unconfigureTheRelay();

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

/**
 * What a deployment running its own coturn gets.
 *
 * The regression this pins: a deployment whose configuration names a working
 * relay must hand that relay to clients. It stopped doing so once, silently,
 * because the answer was being fetched from somewhere that had started saying
 * `404` - and every call between two hostile NATs sat at "connecting" while the
 * relay it needed was named in the very same `.env`.
 */
async function theConfiguredRelayReachesTheClient(): Promise<void> {
  resetIceWarnings();
  process.env.TURN_URLS = ' turns:turn.example.com:443?transport=tcp , turn:turn.example.com:3478 ';
  process.env.TURN_USERNAME = 'betweenus';
  process.env.TURN_CREDENTIAL = 'secret';

  try {
    const servers = await iceServers();

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
    unconfigureTheRelay();
    resetIceWarnings();
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
  resetIceWarnings();
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
    unconfigureTheRelay();
    resetIceWarnings();
  }
}

/** STUN named in the relay variable is not a relay, and is not counted as one. */
async function stunInTheRelayVariableIsNotARelay(): Promise<void> {
  resetIceWarnings();
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
    unconfigureTheRelay();
    resetIceWarnings();
  }
}

async function main(): Promise<void> {
  const restoreNetwork = forbidTheNetwork();
  try {
    stunIsAlwaysThere();
    anOperatorCanNameTheirOwn();
    await unconfiguredStillWorks();
    await aMissingRelayIsSaidOutLoudExactlyOnce();
    await theConfiguredRelayReachesTheClient();
    await aHalfConfiguredRelayIsDroppedAndSaidOutLoud();
    await stunInTheRelayVariableIsNotARelay();
  } finally {
    restoreNetwork();
  }
  console.log('ice self-check passed');
}

void main();
