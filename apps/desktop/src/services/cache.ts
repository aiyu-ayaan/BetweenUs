/**
 * What this device already knows, so opening the app is not a spinner.
 *
 * The port of `apps/android/core/src/main/java/com/aatech/betweenus/core/store/Cache.kt`,
 * and it keeps that file's one rule: **nothing in here is plaintext**. Messages
 * are stored exactly as the server sent them - a sealed envelope this client
 * happens to hold the key for - and the lists are things the server would hand
 * to anyone who asked with this account's token. Writing decrypted bodies to
 * disk would undo what the encryption is for, which is why the decrypted
 * history in `stores/chat.ts` stays in memory and dies with the window.
 *
 * The other exception is `plain`: the decrypted newest messages of recent
 * channels, so a cold start paints without the vault. They are sealed under a
 * per-device key that is not in this database (`history-key.ts`), and
 * `clear()` destroys the key as well as the rows. Read `history-at-rest.ts`.
 *
 * The one exception after that is `drafts`: the text somebody left unsent in a composer,
 * which is theirs, on their own device, and has no sealed form to keep instead.
 * It never leaves this machine - see `services/drafts.ts`.
 *
 * A cache has nothing in it that cannot be fetched again, so every failure path
 * here is "carry on without it". Nothing throws into a caller.
 */
import type { Channel, DirectChannel, Message, ServerWithRole } from '@betweenus/shared-types';
import type { Draft } from './drafts';
import { forgetKey, historyKey, type KeyShelf } from './history-key';
import { openHistory, overflow, sealHistory, type SealedHistory } from './history-at-rest';

const DB_NAME = 'betweenus-cache';
const DB_VERSION = 2;
const LISTS = 'lists';
const MESSAGES = 'messages';
const PLAIN = 'plain';
const KEYS = 'keys';
const OWNER_KEY = 'owner';

/**
 * Bumped by every `clear()`, so a snapshot that was being sealed while somebody
 * signed out is dropped instead of being written after the sign-out.
 */
let generation = 0;

/** Messages kept per channel. Fifty is the server's page; this holds ten of them. */
const MESSAGES_PER_CHANNEL = 500;

let open: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (open) return open;

  open = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LISTS)) db.createObjectStore(LISTS);
      if (!db.objectStoreNames.contains(MESSAGES)) {
        const store = db.createObjectStore(MESSAGES, { keyPath: 'id' });
        // Read by channel, ordered by time - which is the only read there is.
        store.createIndex('channel', ['channelId', 'createdAt']);
      }
      if (!db.objectStoreNames.contains(PLAIN)) db.createObjectStore(PLAIN, { keyPath: 'channelId' });
      // Holds a non-extractable CryptoKey in a browser; empty in the desktop app.
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS);
    };
    request.onsuccess = () => resolve(request.result);
    // A browser with storage denied, a private window, a corrupt database: all
    // of them are an app that works and does not open instantly.
    request.onerror = () => resolve(null);
  });

  return open;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

function ask<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

// --- Lists ------------------------------------------------------------------

async function readList<T>(key: string): Promise<T | null> {
  const db = await database();
  if (!db) return null;
  const store = db.transaction(LISTS, 'readonly').objectStore(LISTS);
  return (await ask<T>(store.get(key) as IDBRequest<T>)) ?? null;
}

async function writeList(key: string, value: unknown): Promise<void> {
  const db = await database();
  if (!db) return;
  const transaction = db.transaction(LISTS, 'readwrite');
  transaction.objectStore(LISTS).put(value, key);
  await done(transaction);
}

/** Where a browser keeps the history key. See `history-key.ts`. */
const shelf: KeyShelf = {
  async get() {
    const db = await database();
    if (!db) return null;
    const held = await ask<CryptoKey>(
      db.transaction(KEYS, 'readonly').objectStore(KEYS).get('history') as IDBRequest<CryptoKey>,
    );
    return held ?? null;
  },
  async put(key) {
    const db = await database();
    if (!db) throw new Error('No place to keep a key');
    const transaction = db.transaction(KEYS, 'readwrite');
    transaction.objectStore(KEYS).put(key, 'history');
    await done(transaction);
  },
  async drop() {
    const db = await database();
    if (!db) return;
    const transaction = db.transaction(KEYS, 'readwrite');
    transaction.objectStore(KEYS).clear();
    await done(transaction);
  },
};

export const cache = {
  /**
   * Binds the cache to an account. A different one than last time means
   * everything here belongs to somebody else and goes.
   *
   * Called before either store reads from it, so a cache belonging to another
   * account is gone rather than merely about to be.
   */
  async claim(userId: string): Promise<void> {
    const owner = await readList<string>(OWNER_KEY);
    if (owner === userId) return;
    await cache.clear();
    await writeList(OWNER_KEY, userId);
  },

  /**
   * Forgets everything. Signing out is the one moment somebody has said they
   * are done with this device - a session that merely expired keeps its cache,
   * so signing back in is still instant.
   */
  async clear(): Promise<void> {
    generation += 1;
    const db = await database();
    if (db) {
      const transaction = db.transaction([LISTS, MESSAGES, PLAIN], 'readwrite');
      transaction.objectStore(LISTS).clear();
      transaction.objectStore(MESSAGES).clear();
      transaction.objectStore(PLAIN).clear();
      await done(transaction);
    }
    // After the rows, never before: a sealed row with no key is noise, but a
    // key with rows left behind it is a reason to have kept the key.
    await forgetKey(shelf);
  },

  /**
   * Forgets one channel's messages and nothing else.
   *
   * What "clear this chat" needs. `clear()` would work and is one line shorter,
   * but it throws away every other conversation this device has cached - so
   * clearing one chat would turn the next four things the person opens into
   * spinners, for no reason they could connect to what they just did.
   */
  async forgetChannel(channelId: string): Promise<void> {
    const db = await database();
    if (!db) return;

    const plain = db.transaction(PLAIN, 'readwrite');
    plain.objectStore(PLAIN).delete(channelId);
    await done(plain);

    const transaction = db.transaction(MESSAGES, 'readwrite');
    const index = transaction.objectStore(MESSAGES).index('channel');
    const range = IDBKeyRange.bound([channelId, ''], [channelId, '\uffff']);

    await new Promise<void>((resolve) => {
      const cursor = index.openCursor(range);
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) {
          resolve();
          return;
        }
        at.delete();
        at.continue();
      };
      cursor.onerror = () => resolve();
    });
    await done(transaction);
  },

  servers: (): Promise<ServerWithRole[] | null> => readList('servers'),
  putServers: (servers: ServerWithRole[]): Promise<void> => writeList('servers', servers),

  channels: (serverId: string): Promise<Channel[] | null> => readList(`channels:${serverId}`),
  putChannels: (serverId: string, channels: Channel[]): Promise<void> =>
    writeList(`channels:${serverId}`, channels),

  directs: (): Promise<DirectChannel[] | null> => readList('directs'),
  putDirects: (directs: DirectChannel[]): Promise<void> => writeList('directs', directs),

  /**
   * Where each channel had been read up to. Cached because the unread line is
   * drawn from it the moment a channel opens, and on a cold start that is well
   * before the network has answered - which is how a restart used to lose the
   * line entirely.
   */
  readMarkers: (): Promise<Record<string, string | null> | null> => readList('readMarkers'),
  putReadMarkers: (markers: Record<string, string | null>): Promise<void> =>
    writeList('readMarkers', markers),

  /**
   * Unsent composer text, by channel. Kept with the lists rather than in a
   * store of its own, so the `clear()` that runs on sign-out and on an account
   * switch takes it too - with no schema version to bump for it.
   */
  drafts: (): Promise<Record<string, Draft> | null> => readList('drafts'),
  putDrafts: (drafts: Record<string, Draft>): Promise<void> => writeList('drafts', drafts),

  // --- Messages -------------------------------------------------------------

  /** The newest page of a channel, oldest first, as the screen wants it. */
  async messages(channelId: string, limit = 50): Promise<Message[]> {
    const db = await database();
    if (!db) return [];

    const index = db.transaction(MESSAGES, 'readonly').objectStore(MESSAGES).index('channel');
    const range = IDBKeyRange.bound([channelId, ''], [channelId, '￿']);
    const newest: Message[] = [];

    await new Promise<void>((resolve) => {
      // Backwards from the newest, because "the last fifty" is the question -
      // walking forwards would read the whole channel to answer it.
      const cursor = index.openCursor(range, 'prev');
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at || newest.length >= limit) {
          resolve();
          return;
        }
        newest.push(at.value as Message);
        at.continue();
      };
      cursor.onerror = () => resolve();
    });

    return newest.reverse();
  },

  /**
   * Keeps the last few hundred per channel. History fetched once should not
   * need fetching again, and a few thousand rows of ciphertext is not a size
   * worth worrying about - but a channel read back to its first message is,
   * so the oldest are dropped rather than kept forever.
   */
  /**
   * Forgets specific messages, by id.
   *
   * For the two deletions that leave no tombstone - a one-time message that
   * was opened, and one whose disappearing window closed. An ordinary delete
   * does not come through here: its tombstone is written over the old row by
   * `putMessages`, which is what makes the channel say "this was here and is
   * gone" after a restart.
   */
  async forgetMessages(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const db = await database();
    if (!db) return;

    const transaction = db.transaction(MESSAGES, 'readwrite');
    const store = transaction.objectStore(MESSAGES);
    for (const id of messageIds) store.delete(id);
    await done(transaction);

    await cache.invalidatePlain(messageIds);
  },

  // --- Decrypted history ------------------------------------------------------

  /**
   * Drops every sealed snapshot that holds any of these messages.
   *
   * Dropped whole rather than opened and edited: the snapshot is rewritten from
   * what is on screen as soon as the channel next changes, and the price of that
   * is one slower cold start, against holding the key open to patch a record.
   * What it buys is that an edit or a delete does not leave the old words on
   * disk for even the second the debounced write would take.
   */
  async invalidatePlain(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const db = await database();
    if (!db) return;
    const gone = new Set(messageIds);
    const plain = db.transaction(PLAIN, 'readwrite');
    const rows = plain.objectStore(PLAIN);
    const all = await ask<SealedHistory[]>(rows.getAll() as IDBRequest<SealedHistory[]>);
    for (const row of all ?? []) {
      if (row.ids.some((id) => gone.has(id))) rows.delete(row.channelId);
    }
    await done(plain);
  },

  /**
   * The newest decrypted messages of a channel as of the last time it changed,
   * or null when there is none, there is no key, or the record does not open.
   */
  async plainHistory<T>(channelId: string): Promise<T[] | null> {
    const db = await database();
    if (!db) return null;
    const key = await historyKey(shelf);
    if (!key) return null;
    const record = await ask<SealedHistory>(
      db.transaction(PLAIN, 'readonly').objectStore(PLAIN).get(channelId) as IDBRequest<SealedHistory>,
    );
    if (!record) return null;
    const opened = await openHistory<T>(key, record);
    // A record that does not open is of no use to anybody and will not start to.
    if (!opened) void cache.forgetPlain(channelId);
    return opened;
  },

  /** Replaces a channel's snapshot. A no-op where there is no secure place for a key. */
  async putPlain<T extends { id: string; viewOnce?: boolean; expiresAt?: string | null }>(
    channelId: string,
    messages: readonly T[],
  ): Promise<void> {
    const started = generation;
    const db = await database();
    if (!db) return;
    const key = await historyKey(shelf);
    if (!key) return;
    const record = await sealHistory(key, channelId, messages);
    // Signed out, or the account changed, while this was being sealed.
    if (started !== generation) return;

    const transaction = db.transaction(PLAIN, 'readwrite');
    const store = transaction.objectStore(PLAIN);
    if (record.ids.length === 0) store.delete(channelId);
    else store.put(record);
    await done(transaction);

    const sweep = db.transaction(PLAIN, 'readwrite');
    const rows = sweep.objectStore(PLAIN);
    const all = await ask<SealedHistory[]>(rows.getAll() as IDBRequest<SealedHistory[]>);
    for (const id of overflow(all ?? [])) rows.delete(id);
    await done(sweep);
  },

  async forgetPlain(channelId: string): Promise<void> {
    const db = await database();
    if (!db) return;
    const transaction = db.transaction(PLAIN, 'readwrite');
    transaction.objectStore(PLAIN).delete(channelId);
    await done(transaction);
  },

  async putMessages(messages: Message[]): Promise<void> {
    // The channel's timeline only. A thread reply is not in it, and this
    // store is read back as "the newest fifty of the channel" - a reply kept
    // here would be painted into the timeline on the next cold open.
    const timeline = messages.filter((message) => !message.threadRootId);
    if (timeline.length === 0) return;
    const db = await database();
    if (!db) return;

    const transaction = db.transaction(MESSAGES, 'readwrite');
    const store = transaction.objectStore(MESSAGES);
    for (const message of timeline) store.put(message);
    await done(transaction);

    for (const channelId of new Set(timeline.map((message) => message.channelId))) {
      await prune(channelId);
    }
  },
};

/** Drops everything past the ceiling in one channel, oldest first. */
async function prune(channelId: string): Promise<void> {
  const db = await database();
  if (!db) return;

  const transaction = db.transaction(MESSAGES, 'readwrite');
  const index = transaction.objectStore(MESSAGES).index('channel');
  const range = IDBKeyRange.bound([channelId, ''], [channelId, '￿']);
  let seen = 0;

  await new Promise<void>((resolve) => {
    const cursor = index.openCursor(range, 'prev');
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) {
        resolve();
        return;
      }
      seen += 1;
      if (seen > MESSAGES_PER_CHANNEL) at.delete();
      at.continue();
    };
    cursor.onerror = () => resolve();
  });

  await done(transaction);
}
