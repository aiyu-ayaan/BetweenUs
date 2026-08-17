/**
 * What this device already knows, so opening the app is not a spinner.
 *
 * The port of `apps/android/core/src/main/java/com/aktech/nexora/core/store/Cache.kt`,
 * and it keeps that file's one rule: **nothing in here is plaintext**. Messages
 * are stored exactly as the server sent them - a sealed envelope this client
 * happens to hold the key for - and the lists are things the server would hand
 * to anyone who asked with this account's token. Writing decrypted bodies to
 * disk would undo what the encryption is for, which is why the decrypted
 * history in `stores/chat.ts` stays in memory and dies with the window.
 *
 * A cache has nothing in it that cannot be fetched again, so every failure path
 * here is "carry on without it". Nothing throws into a caller.
 */
import type { Channel, DirectChannel, Message, ServerWithRole } from '@nexora/shared-types';

const DB_NAME = 'nexora-cache';
const DB_VERSION = 1;
const LISTS = 'lists';
const MESSAGES = 'messages';
const OWNER_KEY = 'owner';

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
    const db = await database();
    if (!db) return;
    const transaction = db.transaction([LISTS, MESSAGES], 'readwrite');
    transaction.objectStore(LISTS).clear();
    transaction.objectStore(MESSAGES).clear();
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
  async putMessages(messages: Message[]): Promise<void> {
    if (messages.length === 0) return;
    const db = await database();
    if (!db) return;

    const transaction = db.transaction(MESSAGES, 'readwrite');
    const store = transaction.objectStore(MESSAGES);
    for (const message of messages) store.put(message);
    await done(transaction);

    for (const channelId of new Set(messages.map((message) => message.channelId))) {
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
