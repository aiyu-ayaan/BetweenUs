/**
 * The key the decrypted history is sealed under (`history-at-rest.ts`).
 *
 * Per device, generated here, never sent anywhere, and never asked of the
 * person: there is no unlock step, because the vault key is already held by the
 * server for them and a second prompt for something derived on this device
 * would only be a way to lose history.
 *
 *  - In the desktop app the 32 random bytes go through the main process into
 *    the OS keychain (Electron `safeStorage`), and come back as a
 *    non-extractable `CryptoKey` for the renderer. Where the keychain is not
 *    available - a Linux box with no secret service - there is no secure place
 *    for them, so there is no key and the history stays in memory, as it always
 *    did. Writing the bytes to a file beside the data they protect would be
 *    ceremony.
 *  - In a browser the key is a non-extractable `CryptoKey` held in IndexedDB.
 *    Script cannot read its bytes, so a copied database does not open
 *    elsewhere. Without IndexedDB or WebCrypto: memory only.
 *
 * `forgetKey` is half of signing out. With the key gone, any record that
 * somehow survived is noise.
 */
const SLOT = 'history-key';

let pending: Promise<CryptoKey | null> | null = null;

const ALGORITHM = { name: 'AES-GCM', length: 256 } as const;

async function fromKeychain(bridge: NonNullable<Window['betweenus']>): Promise<CryptoKey | null> {
  if (!(await bridge.secureAvailable?.().catch(() => false))) return null;
  let encoded = await bridge.secureGet(SLOT);
  if (!encoded) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
    encoded = btoa(String.fromCharCode(...bytes));
    await bridge.secureSet(SLOT, encoded);
  }
  const raw = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return globalThis.crypto.subtle.importKey('raw', raw, ALGORITHM, false, ['encrypt', 'decrypt']);
}

/** What the browser path needs from the cache's database. Passed in so this file imports nothing of the app. */
export interface KeyShelf {
  get(): Promise<CryptoKey | null>;
  put(key: CryptoKey): Promise<void>;
  drop(): Promise<void>;
}

async function fromShelf(shelf: KeyShelf): Promise<CryptoKey | null> {
  const held = await shelf.get();
  if (held) return held;
  const fresh = await globalThis.crypto.subtle.generateKey(ALGORITHM, false, ['encrypt', 'decrypt']);
  await shelf.put(fresh);
  return fresh;
}

/** Null means "no secure place for a key here": keep history in memory only. */
export function historyKey(shelf: KeyShelf): Promise<CryptoKey | null> {
  pending ??= (async () => {
    try {
      if (!globalThis.crypto?.subtle) return null;
      const bridge = typeof window === 'undefined' ? undefined : window.betweenus;
      return bridge ? await fromKeychain(bridge) : await fromShelf(shelf);
    } catch {
      return null;
    }
  })();
  return pending;
}

/** Destroys the key, so everything sealed under it is unreadable from now on. */
export async function forgetKey(shelf: KeyShelf): Promise<void> {
  pending = null;
  try {
    const bridge = typeof window === 'undefined' ? undefined : window.betweenus;
    if (bridge) await bridge.secureSet(SLOT, '');
    else await shelf.drop();
  } catch {
    // Nothing to forget, or nowhere to forget it from: either way it is gone.
  }
}
