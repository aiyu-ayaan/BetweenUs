/**
 * Client side of end-to-end encryption: device identity, channel-key exchange,
 * and the encrypt/decrypt calls the chat and call features use.
 *
 * The server is a courier here. It stores public keys and sealed blobs, decides
 * who may publish them, and never holds anything that opens a message.
 */
import type { EncryptedEnvelope } from '@nexora/shared-types';
import { api } from './api';
import {
  decryptMessage,
  encryptMessage,
  generateChannelKey,
  generateIdentity,
  parseEnvelope,
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
 * Loads (or creates) this device's identity key and publishes the public half.
 * Called once per sign-in.
 */
export function initIdentity(userId: string): Promise<IdentityKeyPair> {
  if (identityReady && identityUserId === userId) return identityReady;

  identityUserId = userId;
  identityReady = loadIdentity(userId);
  return identityReady;
}

async function loadIdentity(userId: string): Promise<IdentityKeyPair> {
  const storageKey = `identity:${userId}`;
  const stored = await secureGet(storageKey);

  const pair = stored ? (JSON.parse(stored) as IdentityKeyPair) : await generateIdentity();
  if (!stored) await secureSet(storageKey, JSON.stringify(pair));

  identity = pair;
  // Idempotent: re-publishing keeps the directory correct if the row was lost.
  await api.registerDeviceKey(pair.publicKey);
  return pair;
}

export function resetE2ee(): void {
  // Key material is per-user; a sign-out must not leak it into the next session.
  identity = null;
  identityUserId = null;
  identityReady = null;
  channels.clear();
  inFlight.clear();
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

async function createChannelKey(channelId: string, epoch: number): Promise<void> {
  const key = generateChannelKey();
  const devices = await api.channelDevices(channelId);
  try {
    await shareKey(channelId, epoch, key, devices);
  } catch {
    // Lost the race with another member; loadChannelKey re-reads either way.
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

/** Waits for sign-in key setup instead of racing it. */
async function currentIdentity(): Promise<IdentityKeyPair> {
  if (identityReady) return identityReady;
  if (identity) return identity;
  throw new MissingChannelKeyError();
}

/**
 * Private keys go through the main process, which seals them with the OS
 * keychain (Electron `safeStorage`). Outside Electron - a browser opened on the
 * Vite dev server - there is no keychain, so localStorage is the fallback.
 */
async function secureGet(key: string): Promise<string | null> {
  const bridge = window.nexora?.secureGet;
  if (bridge) return bridge(key);
  return localStorage.getItem(`nexora.secure.${key}`);
}

async function secureSet(key: string, value: string): Promise<void> {
  const bridge = window.nexora?.secureSet;
  if (bridge) {
    await bridge(key, value);
    return;
  }
  localStorage.setItem(`nexora.secure.${key}`, value);
}

export type { EncryptedEnvelope };
