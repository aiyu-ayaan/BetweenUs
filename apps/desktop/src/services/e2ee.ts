/**
 * Client side of end-to-end encryption: device identity, channel-key exchange,
 * and the encrypt/decrypt calls the chat and call features use.
 *
 * The server is a courier here. It stores public keys and sealed blobs, decides
 * who may publish them, and never holds anything that opens a message.
 */
import type { BackupSecretKind, EncryptedEnvelope, IdentityBackup } from '@nexora/shared-types';
import { ApiError, api } from './api';
import { setIdentityStatus } from '../stores/identity';
import {
  decryptBytes,
  decryptMessage,
  encryptBytes,
  encryptMessage,
  generateChannelKey,
  generateIdentity,
  openIdentity,
  parseEnvelope,
  sealIdentity,
  unwrapChannelKey,
  wrapChannelKey,
  type IdentityKeyPair,
} from './e2ee-crypto';

/** Shown instead of a message we hold no key for. Never throws into the UI. */
export const UNDECRYPTABLE = '\u{1F512} Encrypted - no key on this device yet';

export class MissingChannelKeyError extends Error {
  constructor() {
    super('No channel key on this device yet');
    this.name = 'MissingChannelKeyError';
  }
}

/**
 * This machine holds no identity and the account's backup needs a secret it was
 * not given. Thrown rather than papered over with a fresh identity: a new
 * identity cannot open a single channel key already sealed for the old one, so
 * generating one here is how history gets lost.
 */
export class IdentityLockedError extends Error {
  constructor(readonly kind: BackupSecretKind) {
    super(
      kind === 'password'
        ? 'Enter your account password to restore this account encryption key'
        : 'Enter your recovery passphrase to restore this account encryption key',
    );
    this.name = 'IdentityLockedError';
  }
}

/** What opens the backup. Held only for the moment a sign-in needs it. */
export interface BackupSecret {
  value: string;
  kind: BackupSecretKind;
}

interface ChannelKeyState {
  epoch: number;
  /** Every epoch this device can open, so old history stays readable. */
  keys: Map<number, string>;
}

let identity: IdentityKeyPair | null = null;
let identityUserId: string | null = null;
/** Set by initIdentity; everything that needs a key awaits it. */
let identityReady: Promise<IdentityKeyPair> | null = null;
const channels = new Map<string, ChannelKeyState>();
const inFlight = new Map<string, Promise<ChannelKeyState>>();

/**
 * Loads this device's identity key and publishes the public half. Called once
 * per sign-in, with the password when there is one to hand.
 *
 * Three ways it can go: the key is already on this machine; it is not, but the
 * account has a backup and `secret` opens it; or the account has no backup yet
 * and one is minted. The fourth case - backup present, no secret - is a
 * question for the user, and comes back as `IdentityLockedError`.
 */
export function initIdentity(userId: string, secret?: BackupSecret): Promise<IdentityKeyPair> {
  if (identityReady && identityUserId === userId) return identityReady;

  identityUserId = userId;
  // A failure here - the network was down, the token had not been minted yet -
  // must not be remembered. Keeping the rejected promise left the device
  // unregistered for the whole session, and every channel it tried to key
  // afterwards ended in "No channel key on this device yet".
  identityReady = loadIdentity(userId, secret).catch((error: unknown) => {
    if (identityUserId === userId) identityReady = null;
    throw error;
  });
  return identityReady;
}

async function loadIdentity(userId: string, secret?: BackupSecret): Promise<IdentityKeyPair> {
  const storageKey = `identity:${userId}`;
  const stored = await secureGet(storageKey);

  if (stored) {
    const pair = JSON.parse(stored) as IdentityKeyPair;
    await adopt(pair);
    // A machine that already worked may still have no backup - it predates
    // this, or nobody could supply a secret at the time. Fix it quietly when a
    // secret is at hand rather than waiting for the next reinstall to notice.
    void ensureBackup(pair, secret);
    return pair;
  }

  // A failed fetch must not fall through to "mint a new identity": that would
  // replace the account's published key, and every channel key sealed for the
  // old one would stop opening for good. Only a definite "no backup exists" is
  // allowed to start a new identity.
  const { backup } = await api.identityBackup();

  if (backup) {
    if (!secret || secret.kind !== backup.kind) {
      setIdentityStatus({ status: 'locked', kind: backup.kind });
      throw new IdentityLockedError(backup.kind);
    }
    const pair = await openBackup(backup, secret);
    await secureSet(storageKey, JSON.stringify(pair));
    await adopt(pair, true);
    return pair;
  }

  const pair = await generateIdentity();
  await secureSet(storageKey, JSON.stringify(pair));
  await adopt(pair);
  await ensureBackup(pair, secret);
  return pair;
}

/** Wrong secret is the expected failure, and deserves to say so. */
async function openBackup(backup: IdentityBackup, secret: BackupSecret): Promise<IdentityKeyPair> {
  try {
    return await openIdentity(backup, secret.value);
  } catch {
    setIdentityStatus({ status: 'locked', kind: backup.kind });
    throw new IdentityLockedError(backup.kind);
  }
}

/** Publishes the public half and marks this machine ready. */
async function adopt(pair: IdentityKeyPair, backedUp = false): Promise<void> {
  identity = pair;
  // Idempotent: re-publishing keeps the directory correct if the row was lost.
  await api.registerDeviceKey(pair.publicKey);
  setIdentityStatus({ status: 'ready', backedUp });
}

/**
 * Uploads a backup when the account has none for this identity and a secret is
 * available to seal it with. Never throws into a sign-in: an account without a
 * backup still works, it is only unrecoverable, and the settings panel says so.
 */
async function ensureBackup(pair: IdentityKeyPair, secret?: BackupSecret): Promise<void> {
  try {
    const { backup } = await api.identityBackup();
    if (backup?.publicKey === pair.publicKey) {
      setIdentityStatus({ status: 'ready', backedUp: true });
      return;
    }
    if (!secret) {
      setIdentityStatus({ status: 'ready', backedUp: false });
      return;
    }
    await api.putIdentityBackup(await sealIdentity(pair, secret.value, secret.kind));
    setIdentityStatus({ status: 'ready', backedUp: true });
  } catch {
    // Offline, or the server is older than this client. Nothing is lost that
    // was not already missing.
  }
}

/**
 * Restores the identity from the account backup with a secret the user has just
 * typed. The sign-in that hit `IdentityLockedError` continues from here.
 */
export async function restoreIdentity(secret: BackupSecret): Promise<void> {
  const userId = identityUserId;
  if (!userId) throw new Error('Nobody is signed in');
  identityReady = null;
  await initIdentity(userId, secret);
}

/**
 * Seals the current identity under a secret the user chose, for an account that
 * has no password to derive from - a provider sign-in - or for anyone who would
 * rather not tie the two together.
 */
export async function backupIdentity(secret: BackupSecret): Promise<void> {
  const pair = await currentIdentity();
  await api.putIdentityBackup(await sealIdentity(pair, secret.value, secret.kind));
  setIdentityStatus({ status: 'ready', backedUp: true });
}

/**
 * Re-seals the backup after a password change. Skipped silently when the backup
 * is keyed to a passphrase instead, which a password change does not touch.
 */
export async function rewrapBackupForPassword(newPassword: string): Promise<void> {
  const { backup } = await api.identityBackup();
  if (backup?.kind !== 'password') return;
  await backupIdentity({ value: newPassword, kind: 'password' });
}

export function resetE2ee(): void {
  // Key material is per-user; a sign-out must not leak it into the next session.
  identity = null;
  identityUserId = null;
  identityReady = null;
  channels.clear();
  inFlight.clear();
  setIdentityStatus({ status: 'absent' });
}

export async function encryptForChannel(channelId: string, plaintext: string): Promise<string> {
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) throw new MissingChannelKeyError();
  const envelope = await encryptMessage(plaintext, key, state.epoch);
  return JSON.stringify(envelope);
}

/** Never throws: undecryptable content renders as a placeholder. */
export async function decryptForChannel(channelId: string, content: string): Promise<string> {
  const envelope = parseEnvelope(content);
  // Messages written before E2EE (and any future plaintext system message).
  if (!envelope) return content;

  try {
    const key = await keyForEpoch(channelId, envelope.epoch);
    return await decryptMessage(envelope, key);
  } catch {
    return UNDECRYPTABLE;
  }
}

/**
 * Seals a file under the channel's current key. The epoch comes back with it,
 * because the recipient has to know which generation opens it - the same
 * bookkeeping `EncryptedEnvelope` does for a message.
 */
export async function encryptFileForChannel(
  channelId: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; iv: string; epoch: number }> {
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) throw new MissingChannelKeyError();
  const { iv, ciphertext } = await encryptBytes(bytes, key);
  return { ciphertext, iv, epoch: state.epoch };
}

/** Throws rather than returning a placeholder: a file either opens or it does not. */
export async function decryptFileForChannel(
  channelId: string,
  ciphertext: Uint8Array<ArrayBuffer>,
  iv: string,
  epoch: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return decryptBytes(ciphertext, iv, await keyForEpoch(channelId, epoch));
}

/**
 * Key material for LiveKit's external key provider. A call reuses the channel
 * key, so joining a call needs no second key exchange and the SFU forwards
 * frames it cannot decode.
 */
export async function callKeyForChannel(channelId: string): Promise<string> {
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) throw new MissingChannelKeyError();
  return key;
}

/**
 * Re-wraps the current key for members who have none. Called when a channel is
 * opened, so a member who joined after the key was minted becomes readable
 * without anyone restarting the app.
 */
export async function syncChannelKeys(channelId: string): Promise<void> {
  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(state.epoch);
  if (!key) return;

  const latest = await api.channelKeys(channelId);
  if (latest.epoch !== state.epoch || latest.missingRecipients.length === 0) return;
  await shareKey(channelId, state.epoch, key, latest.missingRecipients);
}

async function keyForEpoch(channelId: string, epoch: number): Promise<string> {
  const cached = channels.get(channelId)?.keys.get(epoch);
  if (cached) return cached;

  const state = await ensureChannelKey(channelId);
  const key = state.keys.get(epoch);
  if (!key) throw new MissingChannelKeyError();
  return key;
}

/**
 * Keys a channel that was just created, so it is usable by whoever opens it
 * first rather than by whoever happens to type in it first.
 */
export async function keyChannel(channelId: string): Promise<void> {
  await ensureChannelKey(channelId);
}

/**
 * Resolves the channel's key, creating and distributing one if the channel has
 * never been keyed. Concurrent callers share one round-trip.
 */
function ensureChannelKey(channelId: string): Promise<ChannelKeyState> {
  const cached = channels.get(channelId);
  if (cached) return Promise.resolve(cached);

  const existing = inFlight.get(channelId);
  if (existing) return existing;

  const pending = loadChannelKey(channelId).finally(() => inFlight.delete(channelId));
  inFlight.set(channelId, pending);
  return pending;
}

async function loadChannelKey(channelId: string): Promise<ChannelKeyState> {
  const self = await currentIdentity();
  let response = await api.channelKeys(channelId);

  if (response.epoch === 0) {
    // Nobody has keyed this channel yet - do it, then re-read rather than
    // trusting our own write: another member may have won the race.
    await createChannelKey(channelId, 1);
    response = await api.channelKeys(channelId);
  }

  const keys = new Map<number, string>();
  for (const entry of response.keys) {
    try {
      keys.set(
        entry.epoch,
        await unwrapChannelKey(
          { wrappedKey: entry.wrappedKey, iv: entry.iv },
          self.privateKey,
          entry.senderPublicKey,
        ),
      );
    } catch {
      // A key sealed for a previous identity of ours; skip it, keep the rest.
    }
  }

  const state: ChannelKeyState = { epoch: response.epoch, keys };
  if (!keys.has(response.epoch)) throw new MissingChannelKeyError();

  channels.set(channelId, state);

  // Members who joined after the key was minted cannot read anything until a
  // holder re-wraps it for them. We hold it, so we do it.
  if (response.missingRecipients.length > 0) {
    const key = keys.get(response.epoch);
    if (key) void shareKey(channelId, response.epoch, key, response.missingRecipients);
  }

  return state;
}

/**
 * Mints the first key for a channel nobody has keyed yet.
 *
 * Any member who may send a message may do this - waiting for an admin to open
 * the channel is not a rule the server has, and pretending otherwise is what
 * made an empty channel unusable until its owner typed into it first.
 */
async function createChannelKey(channelId: string, epoch: number): Promise<void> {
  const self = await currentIdentity();
  const key = generateChannelKey();
  const devices = await api.channelDevices(channelId);

  // Our own row may not be in the directory yet on a device that signed in a
  // moment ago. Minting a key we cannot open (or, with an empty directory,
  // publishing nothing at all) leaves the channel unkeyed and the sender told
  // there is no key - so we always seal one for ourselves.
  const recipients = devices.some((device) => device.userId === identityUserId)
    ? devices
    : [...devices, { userId: identityUserId ?? '', publicKey: self.publicKey }];

  try {
    await shareKey(channelId, epoch, key, recipients);
  } catch (error) {
    // Another member keyed it first: harmless, loadChannelKey re-reads and
    // finds theirs. Anything else is a real failure and must not be mistaken
    // for "this device has no key".
    const raced = error instanceof ApiError && error.code === 'EPOCH_OUT_OF_ORDER';
    if (!raced) throw error;
  }
}

async function shareKey(
  channelId: string,
  epoch: number,
  key: string,
  recipients: Array<{ userId: string; publicKey: string }>,
): Promise<void> {
  const self = await currentIdentity();

  const entries = await Promise.all(
    recipients.map(async (recipient) => {
      const wrapped = await wrapChannelKey(key, self.privateKey, recipient.publicKey);
      return {
        recipientUserId: recipient.userId,
        senderPublicKey: self.publicKey,
        wrappedKey: wrapped.wrappedKey,
        iv: wrapped.iv,
      };
    }),
  );

  if (entries.length === 0) return;
  await api.publishChannelKeys({ channelId, epoch, entries });
}

/** Waits for sign-in key setup instead of racing it, and retries a failed one. */
async function currentIdentity(): Promise<IdentityKeyPair> {
  if (identityReady) return identityReady;
  if (identityUserId) return initIdentity(identityUserId);
  if (identity) return identity;
  throw new MissingChannelKeyError();
}

/**
 * Private keys go through the main process, which seals them with the OS
 * keychain (Electron `safeStorage`). Outside Electron - a browser opened on the
 * Vite dev server - there is no keychain, so localStorage is the fallback.
 */
export async function secureGet(key: string): Promise<string | null> {
  const bridge = window.nexora?.secureGet;
  if (bridge) return bridge(key);
  return localStorage.getItem(`nexora.secure.${key}`);
}

export async function secureSet(key: string, value: string): Promise<void> {
  const bridge = window.nexora?.secureSet;
  if (bridge) {
    await bridge(key, value);
    return;
  }
  localStorage.setItem(`nexora.secure.${key}`, value);
}

export type { EncryptedEnvelope };
