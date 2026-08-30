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
  backupIdentity,
  decryptForChannel,
  encryptForChannel,
  initIdentity,
  resetE2ee,
  syncChannelKeys,
  type BackupSecret,
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
/**
 * Sealed identities, keyed `userId:kind`.
 *
 * Per kind rather than per account, the way the table is: a recovery passphrase
 * used to overwrite the password-sealed blob, and the password blob is the only
 * one a fresh sign-in holds the secret for.
 */
const backups = new Map<string, Record<string, unknown>>();

/** Every backup an account holds, as `GET /e2ee/backup` returns them. */
function backupsFor(userId: string): Record<string, unknown>[] {
  return [...backups.entries()]
    .filter(([key]) => key.startsWith(`${userId}:`))
    .map(([, value]) => value);
}
let tick = 0;
let stored: StoredKey[] = [];
let caller = 'alice';
/** Every epoch that was published, in order, so a re-key loop is visible. */
let published: number[] = [];
/** One-shot fault: the next publish behaves like a dropped request. */
let failNextPublish = false;

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

  // Every entry is checked before any of them is written, which is what the
  // service does - it validates, then `createMany`. Storing as it went left a
  // half-published epoch behind on a rejected bundle, and a half-published
  // epoch is a channel key nobody can open and an epoch number nobody minted.
  for (const entry of dto.entries) {
    if (!MEMBERS.includes(entry.recipientUserId)) return forbidden('RECIPIENT_NOT_MEMBER');
    if (revoked.has(`${entry.recipientUserId}:${entry.recipientDeviceId}`)) {
      return forbidden('DEVICE_REVOKED');
    }
  }

  for (const entry of dto.entries) {
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

/**
 * Machines missing an epoch their owner already holds somewhere else, over
 * every epoch that exists. Mirrors `E2eeService.gaps`, including the condition
 * that makes it safe: a person's second machine is repaired, and a member who
 * joined last week is still not handed the year before that.
 */
function gapsNow(): Array<{ epoch: number; devices: DeviceKey[] }> {
  const held = new Set(
    stored.map((row) => `${row.epoch}:${row.recipientUserId}:${row.recipientDeviceId}`),
  );
  const owners = new Set(stored.map((row) => `${row.epoch}:${row.recipientUserId}`));
  const epochs = [...new Set(stored.map((row) => row.epoch))].sort((a, b) => b - a);
  return epochs
    .map((epoch) => ({
      epoch,
      devices: knownDevices().filter(
        (device) =>
          owners.has(`${epoch}:${device.userId}`) &&
          !held.has(`${epoch}:${device.userId}:${device.deviceId}`),
      ),
    }))
    .filter((gap) => gap.devices.length > 0);
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

    // Sealed identities, so a machine that cannot open the one that is there
    // can be told apart from an account that has none.
    if (url.pathname === '/api/v1/e2ee/backup') {
      if (method === 'GET') {
        const held = backupsFor(caller);
        return Promise.resolve(
          json({ backups: held, backup: held.find((it) => it.kind === 'password') ?? held[0] ?? null }),
        );
      }
      const blob = body as Record<string, unknown>;
      backups.set(`${caller}:${String(blob.kind)}`, blob);
      return Promise.resolve(json({ ok: true }));
    }
    if (url.pathname.startsWith('/api/v1/e2ee/backup/')) {
      backups.delete(`${caller}:${url.pathname.split('/').pop() ?? ''}`);
      return Promise.resolve(json({ ok: true }));
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
          // The same question asked of every epoch, which is what lets a
          // machine that signed in today be handed the history.
          gaps: gapsNow(),
        }),
      );
    }

    if (url.pathname === '/api/v1/e2ee/keys' && method === 'POST') {
      if (failNextPublish) {
        failNextPublish = false;
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve(publish(body as PublishChannelKeysRequest));
    }

    throw new Error(`unexpected call: ${method} ${url.pathname}`);
  }) as typeof fetch;
}

/**
 * `secureGet`/`secureSet` fall back to localStorage, which Node has not got.
 *
 * One store, with the sealed identity partitioned by device id. Two machines
 * are two keychains, and sharing one here would have made every "different
 * laptop" in this file the same laptop under another name - it would open every
 * wrap addressed to the other one and prove nothing. The device id is the same
 * value the client reads, so switching machines switches keychains without
 * anything else having to know.
 */
function stubBrowserGlobals(): void {
  const store = new Map<string, string>();
  const partition = (key: string): string =>
    key.startsWith('betweenus.secure.')
      ? `${store.get('betweenus.deviceId') ?? 'unknown'}/${key}`
      : key;
  Object.assign(globalThis, {
    window: { location: { origin: 'http://localhost:8080' } },
    localStorage: {
      getItem: (key: string) => store.get(partition(key)) ?? null,
      setItem: (key: string, value: string) => store.set(partition(key), value),
      removeItem: (key: string) => store.delete(partition(key)),
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
/**
 * Lets the work a sign-in started but did not wait for finish.
 *
 * Generous, because the slowest of it is a 600k-round PBKDF2 seal. A shorter
 * wait does not make the check faster, it makes it pass for the wrong reason.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2000));
}

/** Wipes the key a machine holds, so the next sign-in is a machine without one. */
function forgetIdentity(userId: string): void {
  localStorage.removeItem(`betweenus.secure.identity:${userId}`);
}

async function signIn(
  userId: string,
  device = 'device-1',
  secret?: BackupSecret,
): Promise<void> {
  resetE2ee();
  caller = userId;
  localStorage.setItem('betweenus.deviceId', `${userId}-${device}`);
  await initIdentity(userId, secret);
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

  // And it reads nothing yet. The phone holds one epoch - the one it had to
  // mint for itself, because no machine holding the older ones was online to
  // wrap them for it - so the whole conversation up to this moment is a
  // padlock. That is the wall of them a second device opens on, and what the
  // next few lines exist to repair.
  assert.equal(
    await decryptForChannel(CHANNEL, afterBob),
    UNDECRYPTABLE,
    'a brand new machine starts with no history, before anyone repairs it',
  );
  assert.equal(await decryptForChannel(CHANNEL, beforeBob), UNDECRYPTABLE);

  // The laptop still reads its own history.
  await signIn('alice', 'device-1');
  assert.equal(await decryptForChannel(CHANNEL, afterBob), 'after bob left');

  // And opening the channel on the laptop hands the phone every epoch the
  // laptop holds. This is the repair: it is the same person, who can read
  // those messages on the machine in front of them, and the server offers the
  // gap only for a machine whose *owner* already holds that epoch.
  const epochBeforeRepair = latestEpoch();
  await syncChannelKeys(CHANNEL);
  assert.equal(
    latestEpoch(),
    epochBeforeRepair,
    'every device is covered, so nothing needs re-keying',
  );
  assert.deepEqual(
    stored
      .filter((row) => row.recipientDeviceId === 'alice-phone')
      .map((row) => row.epoch)
      .sort((a, b) => a - b),
    [1, 2, 3, 4],
    'the phone is handed every epoch the laptop holds, not only the newest',
  );

  // So the phone now reads the whole conversation, including what was written
  // three epochs before it existed.
  await signIn('alice', 'phone');
  assert.equal(
    await decryptForChannel(CHANNEL, beforeBob),
    'before bob arrived',
    'the second machine reads history once a machine that holds it has been online',
  );
  assert.equal(await decryptForChannel(CHANNEL, afterBob), 'after bob left');

  // And bob, who was never a member when that was written, is still not handed
  // it. The repair is one person's own second machine and nothing wider: the
  // gap list names a device only when its owner already holds that epoch.
  const bobDevices = new Set(
    stored.filter((row) => row.recipientUserId === 'bob').map((row) => row.epoch),
  );
  assert.equal(bobDevices.has(3), false, 'a former member gains nothing from a repair');
  assert.equal(bobDevices.has(4), false, 'a former member gains nothing from a repair');

  await signIn('alice', 'device-1');
  const beforeRevoke = latestEpoch();

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
  assert.equal(latestEpoch(), beforeRevoke + 1, 'a revoked device forces exactly one re-key');

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

  // --- A dropped request during self-heal must not brick the channel -------
  //
  // Dave joins a channel alice already keyed, offline. Opening it makes his
  // client mint its own epoch the same way bob's did above - but this time the
  // publish call itself fails (a network blip), not a race another member won.
  // The old code marked the channel "already tried" before that call returned,
  // so every later attempt this session skipped straight to "no key" instead
  // of trying again. It must retry instead.
  const CHANNEL_2 = 'channel-random';
  MEMBERS = ['alice', 'dave'];
  await signIn('alice');
  const beforeDave = await encryptForChannel(CHANNEL_2, 'hello before dave');

  await signIn('dave');
  failNextPublish = true;
  assert.equal(
    await decryptForChannel(CHANNEL_2, beforeDave),
    UNDECRYPTABLE,
    'a dropped request during self-heal still renders as undecryptable, not a crash',
  );
  assert.equal(
    await decryptForChannel(CHANNEL_2, beforeDave),
    UNDECRYPTABLE,
    'the message dave was never sealed for stays closed - that part is by design',
  );
  const fromDave = await encryptForChannel(CHANNEL_2, 'hi from dave');
  assert.notEqual(
    fromDave,
    undefined,
    'a retry after the dropped request must mint dave a working epoch, not stay locked out',
  );

  await signIn('alice');
  assert.equal(
    await decryptForChannel(CHANNEL_2, fromDave),
    'hi from dave',
    'alice must read what dave sent once his self-heal succeeded on retry',
  );

  // A sign-in that cannot open the account backup must still sign in.
  //
  // This is the GitHub case: the account has a backup sealed under a password,
  // the provider sign-in has no password to offer, and there is nothing on
  // screen to ask with. It mints a key of its own and carries on - and it must
  // not seal that key over the backup the other machines restore from.
  MEMBERS = [...MEMBERS, 'erin'];
  await signIn('erin');
  await backupIdentity({ value: 'erin-account-password', kind: 'password' });
  const erinsBackup = backups.get('erin:password');
  assert.notEqual(erinsBackup, undefined, 'erin has an account backup to be locked out of');

  // A machine with nothing of its own on it, which is what a new one is. The
  // identity is stored per account rather than per device id, so it has to go
  // for this to be a second laptop rather than the first one renamed.
  forgetIdentity('erin');
  await signIn('erin', 'device-2');
  assert.deepEqual(
    backups.get('erin:password'),
    erinsBackup,
    'a machine that could not open the backup must never replace it',
  );
  const fromErin = await encryptForChannel(CHANNEL_2, 'sent from the new laptop');
  assert.notEqual(
    fromErin,
    undefined,
    'a provider sign-in with no secret must reach a usable key rather than stop and ask',
  );

  const forkedKey = devices.get('erin:erin-device-2')?.publicKey;
  assert.notEqual(
    forkedKey,
    erinsBackup?.publicKey,
    'a machine that could not open the backup is on a key of its own - that is the fork',
  );

  // The same laptop, signed in later with the account password. Two things at
  // once, and both are the reported bug.
  //
  // It must *recover*: the fork was permanent, because the minted key sat in
  // the keychain and every later launch short-circuited on it without ever
  // asking for the backup again. A phone signed in with the right password read
  // every message it had ever been sent as a padlock, for the life of the
  // install, with no way back and nothing on screen to say so.
  //
  // And the password must still not quietly promote the minted key to the
  // account's backup: every machine still restoring from the real one would be
  // locked out of everything, and nothing would say so.
  await signIn('erin', 'device-2', { value: 'erin-account-password', kind: 'password' });
  await settle();
  assert.equal(
    devices.get('erin:erin-device-2')?.publicKey,
    erinsBackup?.publicKey,
    'a forked machine must take the account key back on the next sign-in that can open the backup',
  );

  // And the secret, when there is one, still puts the account key on the
  // machine that asks with it.
  forgetIdentity('erin');
  await signIn('erin', 'device-3', { value: 'erin-account-password', kind: 'password' });
  const fromErinsThird = await encryptForChannel(CHANNEL_2, 'sent from the third');
  assert.equal(
    await decryptForChannel(CHANNEL_2, fromErin),
    'sent from the new laptop',
    'a machine restored from the backup reads what the account key already opened',
  );

  // The backup is still the one erin sealed, byte for byte. `ensureBackup` runs
  // on every sign-in and is not awaited by any of them, so this is checked last,
  // once all of them have had their chance to overwrite it: the laptop holding a
  // key of its own must not promote that key to the account's, or every machine
  // restoring from the real one is locked out of everything and nothing says so.
  await settle();
  assert.deepEqual(
    backups.get('erin:password'),
    erinsBackup,
    'no sign-in may replace the account backup with a key of its own',
  );
  assert.notEqual(fromErinsThird, undefined, 'the restored machine can seal too');

  // A recovery passphrase must not take the password path away.
  //
  // The table was keyed on the account, so setting one overwrote the
  // password-sealed blob - and that blob is the only thing a fresh sign-in
  // holds the secret for. Losing it turned every later "sign in on a new
  // device" into the fork above, which is a padlock on the whole account.
  await backupIdentity({ value: 'erin-recovery-passphrase', kind: 'passphrase' });
  assert.deepEqual(
    backups.get('erin:password'),
    erinsBackup,
    'setting a recovery passphrase must leave the password backup standing',
  );
  assert.notEqual(
    backups.get('erin:passphrase'),
    undefined,
    'the passphrase backup is stored alongside it, not instead of it',
  );

  // And a new machine still recovers with the password alone, which is the
  // whole promise: sign in anywhere, read everything, type nothing extra.
  forgetIdentity('erin');
  await signIn('erin', 'device-4', { value: 'erin-account-password', kind: 'password' });
  await settle();
  assert.equal(
    devices.get('erin:erin-device-4')?.publicKey,
    erinsBackup?.publicKey,
    'the account password must still restore the account key after a passphrase was set',
  );

  console.log('e2ee.check.ts: ok');
}

void main();
