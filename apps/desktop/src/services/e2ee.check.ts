/**
 * Channel-key distribution, checked against a stand-in key directory that
 * enforces the same publish rules the chat service does.
 *
 * The bug this pins down: the owner creates a server, keys #general for the one
 * member that exists (themselves), invites somebody and closes the app. The
 * invitee holds no key, nobody is online to wrap one for them, and every
 * message they try to send comes back "No channel key on this device yet".
 *
 * Run with: pnpm --filter @betweenus/desktop check
 */
import assert from 'node:assert/strict';
import type { ChannelKeyEntry, DeviceKey, PublishChannelKeysRequest } from '@betweenus/shared-types';
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

type StoredKey = ChannelKeyEntry & { epoch: number; createdAt: number };

/**
 * Public keys, wrapped keys, and who is making the call.
 *
 * Keyed by `userId:deviceId` since the directory became a list per user: one
 * person signed in on a laptop and a phone is two rows, two public keys and two
 * wraps of every channel key.
 */
const devices = new Map<string, { userId: string; deviceId: string; publicKey: string }>();
/**
 * Devices whose owner has revoked them, and when.
 *
 * The clock is a counter rather than a date: what matters is only whether a
 * revocation came after the epoch was minted, and two real timestamps a
 * millisecond apart would make that a flaky assertion rather than a clear one.
 */
const revoked = new Map<string, number>();
let tick = 0;
let stored: StoredKey[] = [];
let caller = 'alice';
/** Every epoch that was published, in order, so a re-key loop is visible. */
let published: number[] = [];

function latestEpoch(): number {
  return stored.reduce((max, row) => Math.max(max, row.epoch), 0);
}

function knownDevices(): DeviceKey[] {
  return [...devices.values()]
    .filter(
      (device) =>
        MEMBERS.includes(device.userId) && !revoked.has(`${device.userId}:${device.deviceId}`),
    )
    .map((device) => ({
      userId: device.userId,
      deviceId: device.deviceId,
      publicKey: device.publicKey,
      label: null,
      revokedAt: null,
      lastSeenAt: '2026-08-18T00:00:00.000Z',
      createdAt: '2026-08-18T00:00:00.000Z',
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
    if (revoked.has(`${entry.recipientUserId}:${entry.recipientDeviceId}`)) {
      return forbidden('DEVICE_REVOKED');
    }
    const duplicate = stored.some(
      (row) =>
        row.epoch === dto.epoch &&
        row.recipientUserId === entry.recipientUserId &&
        row.recipientDeviceId === entry.recipientDeviceId,
    );
    if (duplicate) continue;
    stored.push({
      ...entry,
      epoch: dto.epoch,
      senderUserId: caller,
      senderDeviceId: dto.senderDeviceId,
      createdAt: (tick += 1),
    });
  }

  published.push(dto.epoch);
  return json({ epoch: dto.epoch, stored: dto.entries.length });
}

/** Is the current epoch on a machine that should not have it? */
function staleNow(epoch: number): boolean {
  const rows = stored.filter((row) => row.epoch === epoch);
  if (rows.length === 0) return false;
  if (rows.some((row) => !MEMBERS.includes(row.recipientUserId))) return true;

  const mintedAt = Math.min(...rows.map((row) => row.createdAt));
  return [...revoked.entries()].some(
    ([key, at]) => MEMBERS.includes(key.split(':')[0] ?? '') && at > mintedAt,
  );
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
      const { publicKey, deviceId } = body as { publicKey: string; deviceId: string };
      // A revoked id stays revoked: a machine that could un-revoke itself makes
      // revocation a suggestion, and the machine in question runs this code.
      if (revoked.has(`${caller}:${deviceId}`)) return Promise.resolve(forbidden('DEVICE_REVOKED'));
      devices.set(`${caller}:${deviceId}`, { userId: caller, deviceId, publicKey });
      return Promise.resolve(json({ userId: caller, deviceId, publicKey }));
    }
    if (url.pathname === '/api/v1/e2ee/devices') return Promise.resolve(json(knownDevices()));

    // No backup in play here: the identities live in the stubbed secure store.
    if (url.pathname === '/api/v1/e2ee/backup') {
      return Promise.resolve(json(method === 'GET' ? { backup: null } : { ok: true }));
    }

    if (url.pathname.startsWith('/api/v1/e2ee/keys/')) {
      const epoch = latestEpoch();
      const covered = new Set(
        stored
          .filter((row) => row.epoch === epoch)
          .map((row) => `${row.recipientUserId}:${row.recipientDeviceId}`),
      );
      return Promise.resolve(
        json({
          channelId: CHANNEL,
          epoch,
          keys: stored.filter((row) => row.recipientUserId === caller),
          missingRecipients:
            epoch === 0
              ? []
              : knownDevices().filter(
                  (device) => !covered.has(`${device.userId}:${device.deviceId}`),
                ),
          // The same derivation the service does, and the same two reasons: a
          // holder who is no longer a member, or a machine revoked since this
          // epoch was minted. The second cannot be found by looking for its
          // wraps - revoking deletes them - so it is found by the clock.
          rekeyNeeded: staleNow(epoch),
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

/**
 * Signs an account in on one machine.
 *
 * `deviceId` is read out of localStorage by the client, so putting a value
 * there is how this stand-in says "a different laptop". Clearing the identity
 * store alongside it is what makes it a different laptop rather than the same
 * one with a new name: a machine that kept the private half would open every
 * wrap addressed to the other one and prove nothing.
 */
async function signIn(userId: string, device = 'device-1'): Promise<void> {
  resetE2ee();
  caller = userId;
  localStorage.setItem('betweenus.deviceId', `${userId}-${device}`);
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

  // --- A second machine, and taking one away -------------------------------

  // Alice signs in on a phone. It is a different device id and a different key
  // pair, so it holds nothing yet: the phone must be wrapped for rather than
  // assumed covered because "alice" already had a key. That assumption is what
  // the per-account directory made, and it is why a second machine used to
  // read nothing until the channel happened to re-key.
  MEMBERS = ['alice'];
  await signIn('alice', 'phone');
  await syncChannelKeys(CHANNEL);

  const phoneWraps = stored.filter(
    (row) => row.epoch === latestEpoch() && row.recipientDeviceId === 'alice-phone',
  );
  assert.equal(phoneWraps.length, 1, 'a new machine must be wrapped for, once');
  assert.equal(
    await decryptForChannel(CHANNEL, afterBob),
    'after bob left',
    'the second machine reads what the first one could',
  );

  // The laptop still works. Two machines, two wraps, one key.
  await signIn('alice', 'device-1');
  assert.equal(await decryptForChannel(CHANNEL, afterBob), 'after bob left');

  const beforeRevoke = published.length;
  await syncChannelKeys(CHANNEL);
  assert.equal(
    published.length,
    beforeRevoke,
    'every device is covered, so nothing needs re-keying',
  );

  // Alice loses the phone and revokes it. Its wraps go with it, and the channel
  // has to move past the key it was holding - the same rule as a member who
  // left, for the same reason: what it already decrypted is on a machine
  // nobody trusts any more.
  revoked.set('alice:alice-phone', (tick += 1));
  // Revoking deletes the wraps addressed to it, which is most of what revoking
  // is - and is exactly why the staleness of the epoch cannot be derived from
  // them afterwards.
  stored = stored.filter((row) => row.recipientDeviceId !== 'alice-phone');

  await syncChannelKeys(CHANNEL);
  assert.equal(published.length, beforeRevoke + 1, 'a revoked device forces exactly one re-key');

  const newest = latestEpoch();
  assert.deepEqual(
    stored
      .filter((row) => row.epoch === newest)
      .map((row) => row.recipientDeviceId)
      .sort(),
    ['alice-device-1'],
    'the new epoch is wrapped for the machines that remain, and not the revoked one',
  );

  const afterRevoke = await encryptForChannel(CHANNEL, 'after the phone was lost');
  assert.equal(JSON.parse(afterRevoke).epoch, newest);

  // And the phone, when it comes back, is turned away at the directory rather
  // than quietly re-admitted - then reads nothing written since.
  resetE2ee();
  caller = 'alice';
  localStorage.setItem('betweenus.deviceId', 'alice-phone');
  await assert.rejects(initIdentity('alice'), /DEVICE_REVOKED/);
  assert.equal(
    await decryptForChannel(CHANNEL, afterRevoke),
    UNDECRYPTABLE,
    'a revoked machine must not read what was sent after it was revoked',
  );

  console.log('e2ee.check.ts: ok');
}

void main();
