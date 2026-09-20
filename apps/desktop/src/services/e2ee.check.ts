/**
 * Channel-key distribution and the account vault, checked against a stand-in
 * directory that enforces the same publish rules the chat service does.
 *
 * The bug this file exists for, in the words it was reported in: *"the images
 * and chats are all gone."* A second machine signed in, read a wall of
 * padlocks, and was told to go and open the app on the laptop it was replacing
 * - which, if that laptop had been wiped or lost, was advice about a machine
 * that no longer existed. Those conversations were not delayed. They were
 * gone, and no server, support route or later sign-in could bring them back,
 * because every key was addressed to a machine rather than to the account.
 *
 * So the assertions below are mostly about *absence*: an epoch that must not
 * be minted, a padlock that must not appear, a fork that must not happen.
 *
 * Run with: pnpm --filter @betweenus/desktop check
 */
import assert from 'node:assert/strict';
import {
  ACCOUNT_SCOPE,
  type AccountKeyRecipient,
  type ChannelKeyEntry,
  type PublishChannelKeysRequest,
  type PutVaultFactorRequest,
  type VaultFactor,
} from '@betweenus/shared-types';
import { api, configureApi } from './api';
import { encryptMessage, generateChannelKey, wrapChannelKey } from './e2ee-crypto';
import {
  UNDECRYPTABLE,
  VaultLockedError,
  approveGrant,
  decryptForChannel,
  encryptForChannel,
  initIdentity,
  onRecoveryCode,
  pendingGrants,
  resetE2ee,
  rotateAccountIdentity,
  setVaultFactor,
  syncChannelKeys,
  unlockWithSecret,
  type VaultSecret,
} from './e2ee';

const CHANNEL = 'channel-general';

/**
 * Members of the channel, whether or not they have signed in anywhere yet.
 *
 * Mutable, because losing a member is part of what is checked here: the server
 * decides who a key may be wrapped for by asking who is a member *now*.
 */
let MEMBERS = ['alice', 'bob'];

type StoredKey = ChannelKeyEntry & { epoch: number; createdAt: number };

/** Device rows, keyed `userId:deviceId`. Still one per machine. */
const devices = new Map<string, { userId: string; deviceId: string; publicKey: string }>();
const revoked = new Map<string, number>();

/** One vault per account, and its factors. The server holds only ciphertext. */
interface StoredVault {
  publicKey: string;
  generation: number;
  keyring: { v: 1; iv: string; ct: string };
  factors: VaultFactor[];
}
const vaults = new Map<string, StoredVault>();

/** Machines waiting to be let in, keyed `userId:deviceId`. */
const grantRequests = new Map<
  string,
  { deviceId: string; publicKey: string; label: string | null; fingerprint: string }
>();

let tick = 0;
let stored: StoredKey[] = [];
let caller = 'alice';
/** Every epoch that was published, in order, so a re-key loop is visible. */
let published: number[] = [];
/** Recovery codes the client handed out, keyed by account. */
const recoveryCodes = new Map<string, string>();

function latestEpoch(): number {
  return stored.reduce((max, row) => Math.max(max, row.epoch), 0);
}

/** Member accounts with a vault, which is who a key may be wrapped for. */
function recipients(): AccountKeyRecipient[] {
  return MEMBERS.flatMap((userId) => {
    const vault = vaults.get(userId);
    return vault
      ? [{ userId, publicKey: vault.publicKey, generation: vault.generation }]
      : [];
  });
}

/**
 * Mirrors `E2eeService.publishKeys`, including the rules that guard it.
 *
 * The account-scope rule is the one worth having here rather than trusting
 * the client for: a client that quietly went back to per-device wraps would
 * pass every other assertion in this file, because everything reads correctly
 * on the machine that wrote it. It only fails on the *next* machine, which is
 * the failure mode this whole redesign is about.
 */
function publish(dto: PublishChannelKeysRequest): Response {
  const current = latestEpoch();

  if (dto.epoch > current) {
    if (dto.epoch !== current + 1) return forbidden('EPOCH_OUT_OF_ORDER');
  } else if (!stored.some((row) => row.epoch === dto.epoch && row.recipientUserId === caller)) {
    return forbidden('EPOCH_NOT_HELD');
  }

  // Everything is checked before anything is written, which is what the
  // service does. Storing as it went left a half-published epoch behind on a
  // rejected bundle: a channel key nobody can open under an epoch number
  // nobody minted.
  for (const entry of dto.entries) {
    if (!MEMBERS.includes(entry.recipientUserId)) return forbidden('RECIPIENT_NOT_MEMBER');
    if (entry.recipientDeviceId !== ACCOUNT_SCOPE) return forbidden('DEVICE_SCOPED_WRAP');
    if (!vaults.has(entry.recipientUserId)) return forbidden('RECIPIENT_HAS_NO_VAULT');
  }
  if (revoked.has(`${caller}:${dto.senderDeviceId}`)) return forbidden('DEVICE_REVOKED');

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

/** Epochs the caller holds only as a v1 per-device wrap. */
function promotableNow(): number[] {
  const mine = stored.filter((row) => row.recipientUserId === caller);
  const perAccount = new Set(
    mine.filter((row) => row.recipientDeviceId === ACCOUNT_SCOPE).map((row) => row.epoch),
  );
  return [
    ...new Set(
      mine
        .filter((row) => row.recipientDeviceId !== ACCOUNT_SCOPE && !perAccount.has(row.epoch))
        .map((row) => row.epoch),
    ),
  ].sort((a, b) => a - b);
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

    // --- The vault ---------------------------------------------------------

    if (url.pathname === '/api/v1/e2ee/vault' && method === 'GET') {
      const vault = vaults.get(caller);
      return Promise.resolve(
        json({
          vault: vault
            ? {
                publicKey: vault.publicKey,
                generation: vault.generation,
                keyring: vault.keyring,
                factors: vault.factors,
                createdAt: '2026-09-20T00:00:00.000Z',
                updatedAt: '2026-09-20T00:00:00.000Z',
              }
            : null,
        }),
      );
    }

    if (url.pathname === '/api/v1/e2ee/vault' && method === 'POST') {
      // Refused when one stands, never replaced: overwriting has no undo and
      // orphans every key wrapped for the identity it replaced.
      if (vaults.has(caller)) return Promise.resolve(forbidden('VAULT_EXISTS'));
      const dto = body as { publicKey: string; keyring: StoredVault['keyring']; factors: VaultFactor[] };
      if (!dto.factors.some((it) => it.kind !== 'device')) {
        return Promise.resolve(forbidden('NO_PORTABLE_FACTOR'));
      }
      vaults.set(caller, {
        publicKey: dto.publicKey,
        generation: 1,
        keyring: dto.keyring,
        factors: dto.factors,
      });
      return Promise.resolve(json({ vault: { ...vaults.get(caller)!, createdAt: '', updatedAt: '' } }));
    }

    if (url.pathname === '/api/v1/e2ee/vault/rotate') {
      const vault = vaults.get(caller);
      if (!vault) return Promise.resolve(forbidden('NO_VAULT'));
      const dto = body as { publicKey: string; generation: number; keyring: StoredVault['keyring'] };
      if (dto.generation !== vault.generation + 1) {
        return Promise.resolve(forbidden('GENERATION_OUT_OF_ORDER'));
      }
      vault.publicKey = dto.publicKey;
      vault.generation = dto.generation;
      vault.keyring = dto.keyring;
      return Promise.resolve(json({ vault: { ...vault, createdAt: '', updatedAt: '' } }));
    }

    if (url.pathname === '/api/v1/e2ee/vault/factors' && method === 'PUT') {
      const vault = vaults.get(caller);
      if (!vault) return Promise.resolve(forbidden('NO_VAULT'));
      const dto = body as PutVaultFactorRequest;
      const deviceId = dto.kind === 'device' ? dto.deviceId : '';
      vault.factors = [
        ...vault.factors.filter((it) => !(it.kind === dto.kind && it.deviceId === deviceId)),
        { ...dto, deviceId },
      ];
      if (dto.kind === 'device') grantRequests.delete(`${caller}:${deviceId}`);
      return Promise.resolve(json({ ok: true }));
    }

    if (url.pathname.startsWith('/api/v1/e2ee/vault/factors/') && method === 'DELETE') {
      const vault = vaults.get(caller);
      if (!vault) return Promise.resolve(forbidden('NO_VAULT'));
      const kind = url.pathname.split('/').pop() ?? '';
      const portable = vault.factors.filter((it) => it.kind !== 'device');
      // The invariant: an account may never be left with nothing but machines.
      if (portable.length <= 1 && portable.some((it) => it.kind === kind)) {
        return Promise.resolve(forbidden('LAST_PORTABLE_FACTOR'));
      }
      vault.factors = vault.factors.filter((it) => it.kind !== kind);
      return Promise.resolve(json({ ok: true }));
    }

    if (url.pathname === '/api/v1/e2ee/vault/grants' && method === 'POST') {
      const dto = body as { deviceId: string; publicKey: string; label: string; fingerprint: string };
      grantRequests.set(`${caller}:${dto.deviceId}`, { ...dto });
      return Promise.resolve(json({ ok: true }));
    }

    if (url.pathname === '/api/v1/e2ee/vault/grants' && method === 'GET') {
      return Promise.resolve(
        json({
          requests: [...grantRequests.entries()]
            .filter(([key]) => key.startsWith(`${caller}:`))
            .map(([, value]) => ({ ...value, requestedAt: '2026-09-20T00:00:00.000Z' })),
        }),
      );
    }

    if (url.pathname.startsWith('/api/v1/e2ee/vault/grants/')) {
      const deviceId = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      if (method === 'DELETE') {
        grantRequests.delete(`${caller}:${deviceId}`);
        return Promise.resolve(json({ ok: true }));
      }
      const factor = vaults
        .get(caller)
        ?.factors.find((it) => it.kind === 'device' && it.deviceId === deviceId);
      return Promise.resolve(json({ factor: factor ?? null }));
    }

    if (url.pathname === '/api/v1/e2ee/health') {
      const mine = stored.filter((row) => row.recipientUserId === caller);
      const perAccount = new Set(
        mine.filter((row) => row.recipientDeviceId === ACCOUNT_SCOPE).map((row) => row.epoch),
      );
      return Promise.resolve(
        json({
          portable: perAccount.size,
          sealed: promotableNow().length,
          lost: 0,
          recoverable: (vaults.get(caller)?.factors ?? []).some((it) => it.kind !== 'device'),
        }),
      );
    }

    if (url.pathname === '/api/v1/e2ee/channels') {
      return Promise.resolve(json(stored.some((row) => row.recipientUserId === caller) ? [CHANNEL] : []));
    }

    // --- Devices and keys ---------------------------------------------------

    if (url.pathname === '/api/v1/e2ee/devices' && method === 'POST') {
      const { publicKey, deviceId } = body as { publicKey: string; deviceId: string };
      // A revoked id stays revoked: a machine that could un-revoke itself makes
      // revocation a suggestion, and the machine in question runs this code.
      if (revoked.has(`${caller}:${deviceId}`)) return Promise.resolve(forbidden('DEVICE_REVOKED'));
      devices.set(`${caller}:${deviceId}`, { userId: caller, deviceId, publicKey });
      // A machine that got in by itself withdraws the request it made while it
      // was locked. Leaving it would put a machine that needs nothing on every
      // other machine's approval screen, and an approval prompt that is not
      // asking for anything is how people learn to approve without looking.
      if ((body as { holdsVault?: boolean }).holdsVault) grantRequests.delete(`${caller}:${deviceId}`);
      return Promise.resolve(json({ userId: caller, deviceId, publicKey }));
    }

    if (url.pathname === '/api/v1/e2ee/recipients') return Promise.resolve(json(recipients()));

    if (url.pathname.startsWith('/api/v1/e2ee/keys/')) {
      const epoch = latestEpoch();
      const covered = new Set(
        stored
          .filter((row) => row.epoch === epoch && row.recipientDeviceId === ACCOUNT_SCOPE)
          .map((row) => row.recipientUserId),
      );
      return Promise.resolve(
        json({
          channelId: CHANNEL,
          epoch,
          keys: stored.filter((row) => row.recipientUserId === caller),
          missingRecipients:
            epoch === 0 ? [] : recipients().filter((who) => !covered.has(who.userId)),
          rekeyNeeded: staleNow(epoch),
          // Only the deliberate exception is left here. Repairing somebody's
          // own second machine is no longer a thing that has to happen.
          gaps: [],
          promotable: promotableNow(),
        }),
      );
    }

    if (url.pathname === '/api/v1/e2ee/keys' && method === 'POST') {
      return Promise.resolve(publish(body as PublishChannelKeysRequest));
    }

    throw new Error(`unexpected call: ${method} ${url.pathname}`);
  }) as typeof fetch;
}

/**
 * `secureGet`/`secureSet` fall back to localStorage, which Node has not got.
 *
 * One store, with secrets partitioned by device id. Two machines are two
 * keychains, and sharing one here would make every "different laptop" in this
 * file the same laptop under another name - it would hold the master key
 * already and prove nothing.
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
 * Lets the work a sign-in started but did not wait for finish.
 *
 * Generous, because the slowest of it is a 600k-round PBKDF2 seal. A shorter
 * wait does not make the check faster, it makes it pass for the wrong reason.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2500));
}

/** Signs an account in on one machine. A new `device` is a new machine. */
async function signIn(userId: string, device = 'device-1', secret?: VaultSecret): Promise<void> {
  resetE2ee();
  caller = userId;
  localStorage.setItem('betweenus.deviceId', `${userId}-${device}`);
  await initIdentity(userId, secret);
}

/** Signs in expecting to be locked out, which is now a first-class outcome. */
async function signInLocked(userId: string, device: string, secret?: VaultSecret): Promise<void> {
  resetE2ee();
  caller = userId;
  localStorage.setItem('betweenus.deviceId', `${userId}-${device}`);
  await assert.rejects(initIdentity(userId, secret), VaultLockedError);
}

async function main(): Promise<void> {
  stubBrowserGlobals();
  stubDirectory();
  configureApi(
    () => 'test-token',
    async () => 'test-token',
  );

  // Every vault is created with a recovery code, whether anybody asked for one
  // or not. That is the factor the "no data is lost" promise rests on: it is
  // not derived from anything somebody can change, forget on a password reset,
  // or lose with a machine.
  onRecoveryCode((code) => recoveryCodes.set(caller, code));

  const PASSWORD: VaultSecret = { value: 'alice-account-password', kind: 'password' };

  // --- One account, one identity, however many machines ---------------------

  await signIn('alice', 'device-1', PASSWORD);
  assert.ok(vaults.has('alice'), 'the first machine creates the vault');
  assert.ok(
    recoveryCodes.get('alice'),
    'and hands out a recovery code, once, rather than offering one in a settings panel',
  );
  assert.deepEqual(
    (vaults.get('alice')?.factors ?? []).map((it) => it.kind).sort(),
    ['password', 'recovery-code'],
    'the password seals a second door, so signing in elsewhere needs nothing extra typed',
  );

  const beforeBob = await encryptForChannel(CHANNEL, 'before bob arrived');
  assert.deepEqual(published, [1], 'alice should have minted exactly the first epoch');
  assert.equal(stored.length, 1, 'the first key is wrapped for alice alone');
  assert.equal(
    stored[0]?.recipientDeviceId,
    ACCOUNT_SCOPE,
    'and it is addressed to the account, never to the machine that minted it',
  );

  // Bob is invited and opens the channel with alice long since offline.
  await signIn('bob', 'device-1', { value: 'bob-password', kind: 'password' });
  const fromBob = await encryptForChannel(CHANNEL, 'hi');
  assert.deepEqual(published, [1, 2], 'bob should have minted the next epoch, once');
  assert.deepEqual(
    stored.filter((row) => row.epoch === 2).map((row) => row.recipientUserId).sort(),
    ['alice', 'bob'],
    'the new epoch must be wrapped for every member, not just its author',
  );

  // Opening the channel again must not walk the epoch forward every time.
  resetE2ee();
  await initIdentity('bob');
  await encryptForChannel(CHANNEL, 'again');
  assert.deepEqual(published, [1, 2], 'a machine that holds the key must not re-key');

  // What alice wrote before bob was a member stays closed to him. Nothing
  // about the vault widens who may read what: it changes *which machines of a
  // member* can, and the answer is now all of them.
  assert.equal(
    await decryptForChannel(CHANNEL, beforeBob),
    UNDECRYPTABLE,
    'history from before the join must not become readable',
  );

  await signIn('alice', 'device-1');
  assert.equal(await decryptForChannel(CHANNEL, fromBob), 'hi');
  assert.equal(await decryptForChannel(CHANNEL, beforeBob), 'before bob arrived');

  // --- The reported bug -----------------------------------------------------
  //
  // A second machine, signed in with the account password, and nothing else
  // happening anywhere. Under v1 this read a wall of padlocks and a line
  // telling its owner to go and open the app on the first laptop; if that
  // laptop was gone, so was the conversation. Here it reads everything, at
  // once, with no other machine online and nothing to wait for.

  const epochsBeforePhone = latestEpoch();
  await signIn('alice', 'phone', PASSWORD);

  assert.equal(
    latestEpoch(),
    epochsBeforePhone,
    'a new machine must not mint an epoch: it holds the account key already',
  );
  assert.equal(
    await decryptForChannel(CHANNEL, beforeBob),
    'before bob arrived',
    'the whole history opens on a machine that did not exist when it was written',
  );
  assert.equal(await decryptForChannel(CHANNEL, fromBob), 'hi');
  assert.deepEqual(published, [1, 2], 'and it published nothing at all to get there');

  // --- A machine with no secret is locked, never forked ---------------------
  //
  // The provider sign-in: no password to offer and nothing on screen to ask
  // with. v1 minted an identity of its own here and carried on, which is what
  // split accounts in two - each identity reading a different slice of the
  // same history, permanently, with nothing saying so.

  const publicKeyBefore = vaults.get('alice')?.publicKey;
  await signInLocked('alice', 'tablet');

  assert.equal(
    vaults.get('alice')?.publicKey,
    publicKeyBefore,
    'a locked machine must not publish an identity of its own',
  );
  assert.deepEqual(published, [1, 2], 'and must not mint an epoch it alone could read');
  assert.ok(
    grantRequests.has('alice:alice-tablet'),
    'it asks to be let in instead, which is the thing v1 had no way to express',
  );

  // The first route out: the recovery code, typed on the locked screen. No
  // other machine has to be online, which is the whole reason the factor
  // exists.
  await unlockWithSecret({ value: recoveryCodes.get('alice')!, kind: 'recovery-code' });
  assert.equal(
    await decryptForChannel(CHANNEL, beforeBob),
    'before bob arrived',
    'a recovery code alone brings back every conversation the account has',
  );

  // The second route out: approval from a machine that is already in.
  await signInLocked('alice', 'work-laptop');
  assert.ok(grantRequests.has('alice:alice-work-laptop'));

  await signIn('alice', 'device-1', PASSWORD);
  const waiting = await pendingGrants();
  assert.equal(waiting.length, 1, 'the machine that is in can see the one that is not');
  await approveGrant(waiting[0]!);

  await signIn('alice', 'work-laptop');
  assert.equal(
    await decryptForChannel(CHANNEL, beforeBob),
    'before bob arrived',
    'an approved machine reads the whole history, with no secret typed on it',
  );

  // A grant is sealed to the key in the request, so a fingerprint that does
  // not match the key it is about is refused. Recomputed here rather than
  // trusted from the wire: the field arrived beside the key it describes, so
  // believing it would be checking a claim against itself.
  await signIn('alice', 'device-1', PASSWORD);
  await assert.rejects(
    approveGrant({
      deviceId: 'alice-imposter',
      publicKey: vaults.get('bob')!.publicKey,
      label: null,
      fingerprint: '0000 0000 0000',
      requestedAt: '2026-09-20T00:00:00.000Z',
    }),
    /fingerprint/,
  );

  // --- A message is not sealed until every member can open the epoch --------
  //
  // v1 fired the re-wrap in the background and sent regardless, so a message
  // could be written under an epoch a member had no wrap for - and nothing
  // ever repaired it.

  MEMBERS = ['alice', 'bob', 'carol'];
  await signIn('carol', 'device-1', { value: 'carol-password', kind: 'password' });
  await signIn('alice', 'device-1', PASSWORD);

  const forCarol = await encryptForChannel(CHANNEL, 'welcome carol');
  const carolHasEpoch = stored.some(
    (row) => row.recipientUserId === 'carol' && row.epoch === JSON.parse(forCarol).epoch,
  );
  assert.ok(
    carolHasEpoch,
    'the sender covers every member before it seals, not after it has sent',
  );

  await signIn('carol', 'device-1');
  assert.equal(await decryptForChannel(CHANNEL, forCarol), 'welcome carol');

  // --- Rotation keeps the history readable ----------------------------------
  //
  // v1 could not rotate an account identity at all: doing so abandoned every
  // row sealed for the old one, which is to say the history. A ring means a
  // rotation appends rather than replaces.

  await signIn('alice', 'device-1', PASSWORD);
  const generationBefore = vaults.get('alice')!.generation;
  await rotateAccountIdentity();
  assert.equal(vaults.get('alice')!.generation, generationBefore + 1);

  assert.equal(
    await decryptForChannel(CHANNEL, beforeBob),
    'before bob arrived',
    'every key wrapped to an older generation still opens after a rotation',
  );

  // And a machine unlocking *after* the rotation gets the whole ring, so it
  // reads the old generations too. A rotation that only the rotating machine
  // survived would be the same data loss under a new name.
  await signIn('alice', 'phone-2', PASSWORD);
  assert.equal(
    await decryptForChannel(CHANNEL, beforeBob),
    'before bob arrived',
    'the keyring travels with the vault, so a later machine reads pre-rotation history',
  );

  // --- The last way in cannot be taken away ---------------------------------

  await signIn('alice', 'device-1', PASSWORD);
  await setVaultFactor({ value: 'alice-passphrase', kind: 'passphrase' });

  // With three portable factors, dropping one is somebody's own business.
  await api.deleteVaultFactor('password');
  await api.deleteVaultFactor('passphrase');

  // With one left it is not: this is the difference between a security setting
  // and losing every message on the next reinstall, and it is the server's
  // call rather than this client's so that it holds for every client there
  // will ever be.
  await assert.rejects(api.deleteVaultFactor('recovery-code'), /LAST_PORTABLE_FACTOR/);
  assert.ok(
    (vaults.get('alice')?.factors ?? []).some((it) => it.kind !== 'device'),
    'a vault always keeps a door that is not a machine',
  );

  // --- Rescuing what v1 left behind -----------------------------------------
  //
  // A row sealed to one installation's device key, which is what every
  // pre-vault wrap is. Only that machine can open it and only that machine can
  // promote it, so the client does - on every channel open, and once across
  // every channel at sign-in, because the window closes when the machine is
  // wiped.

  MEMBERS = ['alice'];
  stored = [];
  published = [];
  // The section above took the password factor away; put it back, because the
  // point of what follows is a machine signing in the ordinary way.
  await signIn('alice', 'device-1', { value: recoveryCodes.get('alice')!, kind: 'recovery-code' });
  await setVaultFactor(PASSWORD);
  await signIn('alice', 'device-1', PASSWORD);

  // A v1 world, built exactly as v1 left one: a channel key sealed to one
  // installation's device key, and a message under it. Nothing but that
  // machine can open either, and nothing but that machine ever will be able
  // to - the server holds no key and no other machine was ever wrapped for.
  const devicePublicKey = devices.get('alice:alice-device-1')!.publicKey;
  const devicePrivateKey = JSON.parse(
    localStorage.getItem('betweenus.secure.identity:alice')!,
  ).privateKey as string;

  const legacyKey = generateChannelKey();
  const legacyMessage = JSON.stringify(await encryptMessage('written under v1', legacyKey, 1));
  const legacyWrap = await wrapChannelKey(legacyKey, devicePrivateKey, devicePublicKey);
  stored.push({
    epoch: 1,
    recipientUserId: 'alice',
    recipientDeviceId: 'alice-device-1',
    senderUserId: 'alice',
    senderDeviceId: 'alice-device-1',
    senderPublicKey: devicePublicKey,
    wrappedKey: legacyWrap.wrappedKey,
    iv: legacyWrap.iv,
    createdAt: (tick += 1),
  });

  assert.deepEqual(promotableNow(), [1], 'the server names the v1 row as promotable');

  // This is the state the bug report was written from: a second machine, with
  // the right password, reading a padlock - because the only key in existence
  // is addressed to a laptop rather than to the account.
  await signIn('alice', 'fresh-laptop', PASSWORD);
  assert.equal(
    await decryptForChannel(CHANNEL, legacyMessage),
    UNDECRYPTABLE,
    'before promotion, a v1 row is readable by exactly one machine in the world',
  );

  // The machine that holds it opens the channel once.
  await signIn('alice', 'device-1', PASSWORD);
  assert.equal(
    await decryptForChannel(CHANNEL, legacyMessage),
    'written under v1',
    'the machine that holds the v1 key still reads it',
  );
  await syncChannelKeys(CHANNEL);
  await settle();

  assert.ok(
    stored.some(
      (row) =>
        row.epoch === 1 &&
        row.recipientUserId === 'alice' &&
        row.recipientDeviceId === ACCOUNT_SCOPE,
    ),
    'it re-addresses the key it alone could open to the account',
  );
  assert.deepEqual(promotableNow(), [], 'and does not do it again on the next open');

  // And the rescue is real. The same fresh machine, which has never held that
  // device key and never will, now reads the message - and so will every
  // machine this account ever signs in on, including after this laptop is
  // wiped. That is the whole of what changed.
  await signIn('alice', 'fresh-laptop', PASSWORD);
  assert.equal(
    await decryptForChannel(CHANNEL, legacyMessage),
    'written under v1',
    'a machine that never held the v1 key reads the promoted history',
  );

  console.log('e2ee.check.ts: ok');
}

void main();
