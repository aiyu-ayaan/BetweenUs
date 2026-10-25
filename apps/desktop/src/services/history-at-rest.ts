/**
 * The decrypted history a device keeps on disk, sealed under a key only this
 * device can produce.
 *
 * `cache.ts` keeps ciphertext, which survives a restart but has to be opened
 * again - and opening it needs the channel key, which needs the vault, which
 * needs the network. So a cold start with no connection showed a spinner over
 * a channel the device had read yesterday. This is the other half: the opened
 * messages, per channel, sealed with AES-256-GCM under a per-device key
 * (`history-key.ts`) with the channel id as additional data, so a record cannot
 * be moved to a different channel and still open.
 *
 * Pure and WebCrypto only, so `pnpm --filter @betweenus/desktop check` runs it
 * under Node. Nothing here touches storage.
 *
 * What is deliberately never written: a one-time message (its whole point is
 * that the media is looked at once) and a disappearing one (the cache must not
 * outlive the window the sender chose). A deleted message is a tombstone with
 * an empty body, so rewriting a channel's snapshot after a delete is what
 * erases the words from disk; an edit is the same.
 */
const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Newest messages kept per channel. One page and a bit: enough to paint, not enough to be an archive. */
export const PLAIN_MESSAGES_PER_CHANNEL = 100;
/** Channels kept at once; the one written longest ago goes first. */
export const PLAIN_CHANNELS = 40;

const FORMAT = 1;

export interface SealedHistory {
  channelId: string;
  /** When this snapshot was written, for the bound on how many channels are kept. */
  at: number;
  /** The ids inside, so a delete can find the snapshots it touches without opening any. */
  ids: string[];
  v: number;
  iv: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
}

interface Keepable {
  id: string;
  viewOnce?: boolean;
  expiresAt?: string | null;
}

/** The newest messages worth keeping, oldest first, minus the kinds that must not outlive the screen. */
export function persistable<T extends Keepable>(messages: readonly T[]): T[] {
  return messages
    .filter((message) => !message.viewOnce && !message.expiresAt)
    .slice(-PLAIN_MESSAGES_PER_CHANNEL);
}

function aad(channelId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`betweenus/history/v${FORMAT}/${channelId}`);
}

export async function sealHistory<T extends Keepable>(
  key: CryptoKey,
  channelId: string,
  messages: readonly T[],
  now = Date.now(),
): Promise<SealedHistory> {
  const kept = persistable(messages);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const sealed = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(channelId) },
    key,
    encoder.encode(JSON.stringify(kept)),
  );
  return {
    channelId,
    at: now,
    ids: kept.map((message) => message.id),
    v: FORMAT,
    iv,
    ct: new Uint8Array(sealed),
  };
}

/** Null for anything that does not open: a different device's key, a moved record, a changed byte. */
export async function openHistory<T>(
  key: CryptoKey,
  record: SealedHistory,
): Promise<T[] | null> {
  if (record.v !== FORMAT) return null;
  try {
    const opened = await subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv, additionalData: aad(record.channelId) },
      key,
      record.ct,
    );
    const parsed: unknown = JSON.parse(decoder.decode(opened));
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

/** Which snapshots to drop to stay within `PLAIN_CHANNELS`: the ones written longest ago. */
export function overflow(records: readonly Pick<SealedHistory, 'channelId' | 'at'>[]): string[] {
  return [...records]
    .sort((a, b) => b.at - a.at)
    .slice(PLAIN_CHANNELS)
    .map((record) => record.channelId);
}
