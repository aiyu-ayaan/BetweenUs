/**
 * Channel-key distribution, checked against a stand-in key directory that
 * enforces the same publish rules the chat service does.
 *
 * The bug this pins down: the owner creates a server, keys #general for the one
 * member that exists (themselves), invites somebody and closes the app. The
 * invitee holds no key, nobody is online to wrap one for them, and every
 * message they try to send comes back "No channel key on this device yet".
 *
 * Run with: pnpm --filter @nexora/desktop check
 */
import assert from 'node:assert/strict';
import type { ChannelKeyEntry, DeviceKey, PublishChannelKeysRequest } from '@nexora/shared-types';
import { configureApi } from './api';
import {
  UNDECRYPTABLE,
  decryptForChannel,
  encryptForChannel,
  initIdentity,
  resetE2ee,
  syncChannelKeys,
} from './e2ee';

const CHANNEL = 'channel-general';

/**
 * Members of the channel, whether or not they have signed in anywhere yet.
 *
 * Mutable, because losing a member is half of what is checked here: the server
 * decides who a key may be wrapped for by asking who is a member *now*.
 */
let MEMBERS = ['alice', 'bob'];

type StoredKey = ChannelKeyEntry & { epoch: number };

/** Public keys, wrapped keys, and who is making the call. */
const devices = new Map<string, string>();
let stored: StoredKey[] = [];
let caller = 'alice';
/** Every epoch that was published, in order, so a re-key loop is visible. */
let published: number[] = [];

function latestEpoch(): number {
  return stored.reduce((max, row) => Math.max(max, row.epoch), 0);
}

function knownDevices(): DeviceKey[] {
  return MEMBERS.filter((userId) => devices.has(userId)).map((userId) => ({
    userId,
    publicKey: devices.get(userId) ?? '',
  }));
}

/** Mirrors E2eeService.publishKeys, including the two rules that guard it. */
function publish(dto: PublishChannelKeysRequest): Response {
  const current = latestEpoch();

  if (dto.epoch > current) {
    if (dto.epoch !== current + 1) return forbidden('EPOCH_OUT_OF_ORDER');
  } else if (!stored.some((row) => row.epoch === dto.epoch && row.recipientUserId === caller)) {
    return forbidden('EPOCH_NOT_HELD');
  }

  for (const entry of dto.entries) {
    if (!MEMBERS.includes(entry.recipientUserId)) return forbidden('RECIPIENT_NOT_MEMBER');
    const duplicate = stored.some(
      (row) => row.epoch === dto.epoch && row.recipientUserId === entry.recipientUserId,
    );
    if (duplicate) continue;
    stored.push({ ...entry, epoch: dto.epoch, senderUserId: caller });
  }

  published.push(dto.epoch);
  return json({ epoch: dto.epoch, stored: dto.entries.length });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function forbidden(code: string): Response {
  return new Response(JSON.stringify({ error: { code, message: code } }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubDirectory(): void {
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;

    if (url.pathname === '/api/v1/e2ee/devices' && method === 'POST') {
      const publicKey = (body as { publicKey: string }).publicKey;
      devices.set(caller, publicKey);
      return Promise.resolve(json({ userId: caller, publicKey }));
    }
    if (url.pathname === '/api/v1/e2ee/devices') return Promise.resolve(json(knownDevices()));

    // No backup in play here: the identities live in the stubbed secure store.
    if (url.pathname === '/api/v1/e2ee/backup') {
      return Promise.resolve(json(method === 'GET' ? { backup: null } : { ok: true }));
    }

    if (url.pathname.startsWith('/api/v1/e2ee/keys/')) {
      const epoch = latestEpoch();
      const covered = new Set(
        stored.filter((row) => row.epoch === epoch).map((row) => row.recipientUserId),
      );
      return Promise.resolve(
        json({
          channelId: CHANNEL,
          epoch,
          keys: stored.filter((row) => row.recipientUserId === caller),
          missingRecipients:
            epoch === 0 ? [] : knownDevices().filter((device) => !covered.has(device.userId)),
          // The same derivation the service does: is this key wrapped for
          // anybody who is not a member any more?
          rekeyNeeded: stored.some(
            (row) => row.epoch === epoch && !MEMBERS.includes(row.recipientUserId),
          ),
        }),
      );
    }

    if (url.pathname === '/api/v1/e2ee/keys' && method === 'POST') {
      return Promise.resolve(publish(body as PublishChannelKeysRequest));
    }

    throw new Error(`unexpected call: ${method} ${url.pathname}`);
  }) as typeof fetch;
}

/** `secureGet`/`secureSet` fall back to localStorage, which Node has not got. */
function stubBrowserGlobals(): void {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    window: { location: { origin: 'http://localhost:8080' } },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
}

/** Signs a different account in on a device of its own. */
async function signIn(userId: string): Promise<void> {
  resetE2ee();
  caller = userId;
  await initIdentity(userId);
}

async function main(): Promise<void> {
  stubBrowserGlobals();
  stubDirectory();
  configureApi(
    () => 'test-token',
    async () => 'test-token',
  );

  // Alice creates the server and keys #general while she is its only member.
  await signIn('alice');
  const beforeBob = await encryptForChannel(CHANNEL, 'before bob arrived');
  assert.deepEqual(published, [1], 'alice should have minted exactly the first epoch');
  assert.equal(stored.length, 1, 'the first key is wrapped for alice alone');

  // Bob is invited and opens the channel with alice long since offline.
  await signIn('bob');
  const fromBob = await encryptForChannel(CHANNEL, 'hi');
  assert.deepEqual(published, [1, 2], 'bob should have minted the next epoch, once');
  assert.deepEqual(
    stored
      .filter((row) => row.epoch === 2)
      .map((row) => row.recipientUserId)
      .sort(),
    ['alice', 'bob'],
    'the new epoch must be wrapped for every member, not just its author',
  );

  // Opening the channel again must not walk the epoch forward every time.
  resetE2ee();
  await initIdentity('bob');
  await encryptForChannel(CHANNEL, 'again');
  assert.deepEqual(published, [1, 2], 'a device that holds the key must not re-key');

  // What alice wrote before bob was a member stays closed to him.
  assert.equal(
    await decryptForChannel(CHANNEL, beforeBob),
    UNDECRYPTABLE,
    'history from before the join must not become readable',
  );

  // And alice, back online, reads bob without either of them doing anything.
  await signIn('alice');
  assert.equal(await decryptForChannel(CHANNEL, fromBob), 'hi');
  assert.equal(await decryptForChannel(CHANNEL, beforeBob), 'before bob arrived');

  // Bob is dropped from the channel. His key still opens everything sent up to
  // now - a key on somebody's machine cannot be taken back - but the channel
  // has to stop using it, and only a holder can arrange that.
  MEMBERS = ['alice'];
  await syncChannelKeys(CHANNEL);
  assert.deepEqual(published, [1, 2, 3], 'a stale holder must produce exactly one re-key');
  assert.deepEqual(
    stored
      .filter((row) => row.epoch === 3)
      .map((row) => row.recipientUserId)
      .sort(),
    ['alice'],
    'the new epoch is wrapped for the members who remain, and nobody else',
  );

  const afterBob = await encryptForChannel(CHANNEL, 'after bob left');
  assert.ok(
    JSON.parse(afterBob).epoch === 3,
    'the next message must be sealed under the new epoch',
  );

  // Nothing to re-key now, so opening the channel again is quiet.
  await syncChannelKeys(CHANNEL);
  assert.deepEqual(published, [1, 2, 3], 'a channel with no stale holder must not re-key');

  // And bob gets nothing newer. A device that signs in again after being
  // removed cannot even reach the directory in the real service - the keys
  // endpoint checks channel access first - so what is asserted here is the part
  // that survives either way: the message written after he left does not open
  // with anything he has.
  await signIn('bob');
  assert.equal(
    await decryptForChannel(CHANNEL, afterBob),
    UNDECRYPTABLE,
    'what was sent after he left must not open',
  );

  console.log('e2ee.check.ts: ok');
}

void main();
