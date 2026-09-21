/**
 * Where scheduled messages and reminders wait, on this device.
 *
 * IndexedDB, beside the message cache (`cache.ts`), and bound by the same rule
 * that file keeps: **nothing on disk is plaintext.** A scheduled message is
 * unsent words - it cannot be sealed under the channel key yet, because the
 * point of sealing at the due time is to use whatever key the channel has
 * *then* - so every row here is sealed under a key of its own instead. That
 * key never leaves this device: it goes through `secureSet`, which in the
 * desktop app is the OS keychain (Electron `safeStorage`) and in a browser is
 * the same storage the web client already keeps its identity keys in.
 *
 * Its own database rather than a third store in the cache's: the cache is
 * disposable by design - it may be dropped whole whenever its shape changes -
 * and a message somebody wrote is not.
 *
 * Every failure here is "carry on without it", as in the cache: a browser with
 * storage denied still has scheduling for as long as the tab stays open.
 */
import { decryptMessage, encryptMessage, generateChannelKey, parseEnvelope } from './e2ee-crypto';
import { secureGet, secureSet } from './e2ee';
import { parseScheduled, type Scheduled } from './schedule';

const DB_NAME = 'betweenus-scheduled';
const DB_VERSION = 1;
const ITEMS = 'items';
const META = 'meta';
const OWNER_KEY = 'owner';
const LOCAL_KEY = 'scheduled.local-key';

/** A row as it sits on disk: the id to find it by, and everything else sealed. */
interface SealedRow {
  id: string;
  sealed: string;
}

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
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
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

let localKey: Promise<string> | null = null;

/** This device's sealing key for the list, made the first time it is needed. */
function sealingKey(): Promise<string> {
  if (localKey) return localKey;
  localKey = (async () => {
    const stored = await secureGet(LOCAL_KEY).catch(() => null);
    if (stored) return stored;
    const fresh = generateChannelKey();
    await secureSet(LOCAL_KEY, fresh);
    return fresh;
  })();
  // A keychain that failed once may answer next time; do not cache the failure.
  localKey.catch(() => {
    localKey = null;
  });
  return localKey;
}

async function seal(item: Scheduled): Promise<SealedRow> {
  const envelope = await encryptMessage(JSON.stringify(item), await sealingKey(), 0);
  return { id: item.id, sealed: JSON.stringify(envelope) };
}

async function unseal(row: SealedRow): Promise<Scheduled | null> {
  const envelope = parseEnvelope(row.sealed);
  if (!envelope) return null;
  try {
    return parseScheduled(JSON.parse(await decryptMessage(envelope, await sealingKey())));
  } catch {
    // Sealed under a key this device no longer has - a keychain reset. Unsent
    // words that cannot be opened are gone either way.
    return null;
  }
}

async function readOwner(db: IDBDatabase): Promise<string | null> {
  const store = db.transaction(META, 'readonly').objectStore(META);
  return (await ask<string>(store.get(OWNER_KEY) as IDBRequest<string>)) ?? null;
}

export const scheduledStore = {
  /**
   * Everything waiting for `userId`. Rows written for any other account are
   * dropped first: an unsent message is somebody's words, and sending them
   * from the next account to sign in here is the worst outcome available.
   */
  async load(userId: string): Promise<Scheduled[]> {
    const db = await database();
    if (!db) return [];
    if ((await readOwner(db)) !== userId) {
      await scheduledStore.clear();
      const transaction = db.transaction(META, 'readwrite');
      transaction.objectStore(META).put(userId, OWNER_KEY);
      await done(transaction);
      return [];
    }
    const store = db.transaction(ITEMS, 'readonly').objectStore(ITEMS);
    const rows = (await ask<SealedRow[]>(store.getAll() as IDBRequest<SealedRow[]>)) ?? [];
    const items = await Promise.all(rows.map(unseal));
    return items.filter((item): item is Scheduled => item !== null);
  },

  /**
   * Whether a row is still on disk. Asked right before acting on one, so a
   * second tab that already sent it - and removed it - is not followed by this
   * one sending it again.
   */
  async has(id: string): Promise<boolean> {
    const db = await database();
    if (!db) return true;
    const store = db.transaction(ITEMS, 'readonly').objectStore(ITEMS);
    return (await ask(store.getKey(id))) != null;
  },

  async put(item: Scheduled): Promise<void> {
    const db = await database();
    if (!db) return;
    const row = await seal(item);
    const transaction = db.transaction(ITEMS, 'readwrite');
    transaction.objectStore(ITEMS).put(row);
    await done(transaction);
  },

  async remove(id: string): Promise<void> {
    const db = await database();
    if (!db) return;
    const transaction = db.transaction(ITEMS, 'readwrite');
    transaction.objectStore(ITEMS).delete(id);
    await done(transaction);
  },

  /** Sign-out: every unsent message and every reminder goes with the account. */
  async clear(): Promise<void> {
    const db = await database();
    if (!db) return;
    const transaction = db.transaction([ITEMS, META], 'readwrite');
    transaction.objectStore(ITEMS).clear();
    transaction.objectStore(META).clear();
    await done(transaction);
  },
};
