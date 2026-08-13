/**
 * End-to-end encryption primitives. WebCrypto only, no app imports, so this
 * module also runs under Node for `pnpm --filter @nexora/desktop check`.
 *
 * Scheme (see development/E2EE.md):
 *   - identity: ECDH P-256 key pair per device, private half never leaves it
 *   - channel key: random AES-256-GCM key per channel, per epoch
 *   - distribution: ECDH(sender, recipient) -> HKDF-SHA256 -> AES-GCM wrap
 *   - messages and call media: AES-256-GCM under the channel key
 */
import type { BackupSecretKind, IdentityBackup, EncryptedEnvelope } from '@nexora/shared-types';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const IDENTITY_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' } as const;
const WRAP_INFO = 'nexora/e2ee/v1/channel-key-wrap';
const IV_BYTES = 12;
const CHANNEL_KEY_BYTES = 32;
const BACKUP_SALT_BYTES = 16;
/**
 * PBKDF2 rounds for the identity backup. OWASP's 2023 floor for
 * PBKDF2-HMAC-SHA256 is 600k, and this runs once per sign-in on a machine that
 * has no identity yet - roughly a quarter-second, paid once, against a table
 * whose theft is the whole reason the blob is sealed.
 */
const BACKUP_ITERATIONS = 600_000;

export interface IdentityKeyPair {
  /** JWK JSON. Published to the server. */
  publicKey: string;
  /** JWK JSON. Stays on the device, encrypted at rest by the main process. */
  privateKey: string;
}

export interface WrappedChannelKey {
  wrappedKey: string;
  iv: string;
}

export async function generateIdentity(): Promise<IdentityKeyPair> {
  const pair = await subtle.generateKey(IDENTITY_ALGORITHM, true, ['deriveBits']);
  const [publicKey, privateKey] = await Promise.all([
    subtle.exportKey('jwk', pair.publicKey),
    subtle.exportKey('jwk', pair.privateKey),
  ]);
  return { publicKey: JSON.stringify(publicKey), privateKey: JSON.stringify(privateKey) };
}

/**
 * Seals the identity key pair so the server can hold it without being able to
 * open it. This is what makes an account portable: the same identity comes
 * back on any machine that can supply the secret, so channel keys already
 * sealed for it keep opening.
 *
 * The secret is stretched with PBKDF2 rather than used directly, because it is
 * a human-chosen string and the resulting blob is stored somewhere a thief can
 * reach offline.
 */
export async function sealIdentity(
  pair: IdentityKeyPair,
  secret: string,
  kind: BackupSecretKind,
): Promise<Omit<IdentityBackup, 'updatedAt'>> {
  const salt = randomBytes(BACKUP_SALT_BYTES);
  const key = await deriveBackupKey(secret, salt, BACKUP_ITERATIONS);
  const iv = randomIv();
  const sealed = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(pair)),
  );

  return {
    v: 1,
    kind,
    kdf: 'PBKDF2-SHA256',
    iterations: BACKUP_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(sealed)),
    publicKey: pair.publicKey,
  };
}

/** Throws if the secret is wrong - AES-GCM's tag is the only check needed. */
export async function openIdentity(
  backup: IdentityBackup,
  secret: string,
): Promise<IdentityKeyPair> {
  const key = await deriveBackupKey(secret, fromBase64(backup.salt), backup.iterations);
  const opened = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(backup.iv) },
    key,
    fromBase64(backup.ct),
  );

  const pair = JSON.parse(decoder.decode(opened)) as IdentityKeyPair;
  if (typeof pair.publicKey !== 'string' || typeof pair.privateKey !== 'string') {
    throw new Error('Backup did not contain an identity key pair');
  }
  return pair;
}

async function deriveBackupKey(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function generateChannelKey(): string {
  const bytes = new Uint8Array(CHANNEL_KEY_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

export async function wrapChannelKey(
  channelKey: string,
  privateJwk: string,
  peerPublicJwk: string,
): Promise<WrappedChannelKey> {
  const key = await deriveWrappingKey(privateJwk, peerPublicJwk);
  const iv = randomIv();
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv }, key, fromBase64(channelKey));
  return { wrappedKey: toBase64(new Uint8Array(sealed)), iv: toBase64(iv) };
}

export async function unwrapChannelKey(
  wrapped: WrappedChannelKey,
  privateJwk: string,
  peerPublicJwk: string,
): Promise<string> {
  const key = await deriveWrappingKey(privateJwk, peerPublicJwk);
  const opened = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrapped.iv) },
    key,
    fromBase64(wrapped.wrappedKey),
  );
  return toBase64(new Uint8Array(opened));
}

export async function encryptMessage(
  plaintext: string,
  channelKey: string,
  epoch: number,
): Promise<EncryptedEnvelope> {
  const key = await importContentKey(channelKey);
  const iv = randomIv();
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  return { v: 1, epoch, iv: toBase64(iv), ct: toBase64(new Uint8Array(sealed)) };
}

export async function decryptMessage(
  envelope: EncryptedEnvelope,
  channelKey: string,
): Promise<string> {
  const key = await importContentKey(channelKey);
  const opened = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
    key,
    fromBase64(envelope.ct),
  );
  return decoder.decode(opened);
}

/**
 * Seals raw bytes - a file - under the channel key. Separate from
 * `encryptMessage` because the result is uploaded as a blob rather than
 * stored in a message, so it stays binary instead of becoming base64.
 *
 * ponytail: the whole file is sealed in one AES-GCM operation, which means it
 * is held in memory twice while that happens. That is why the client refuses
 * attachments over MAX_ATTACHMENT_BYTES. Chunked AEAD - one sealed frame per
 * upload part, each with its own nonce - is the upgrade if larger files matter.
 */
export async function encryptBytes(
  plaintext: Uint8Array<ArrayBuffer>,
  channelKey: string,
): Promise<{ iv: string; ciphertext: Uint8Array<ArrayBuffer> }> {
  const key = await importContentKey(channelKey);
  const iv = randomIv();
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: toBase64(iv), ciphertext: new Uint8Array(sealed) };
}

export async function decryptBytes(
  ciphertext: Uint8Array<ArrayBuffer>,
  iv: string,
  channelKey: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await importContentKey(channelKey);
  const opened = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, ciphertext);
  return new Uint8Array(opened);
}

/**
 * Reads a stored message body. Returns null for anything that is not an
 * envelope, so plaintext rows written before E2EE still render.
 */
export function parseEnvelope(content: string): EncryptedEnvelope | null {
  if (!content.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(content) as Partial<EncryptedEnvelope>;
    if (parsed.v !== 1) return null;
    if (typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') return null;
    if (typeof parsed.epoch !== 'number') return null;
    return { v: 1, epoch: parsed.epoch, iv: parsed.iv, ct: parsed.ct };
  } catch {
    return null;
  }
}

async function deriveWrappingKey(privateJwk: string, peerPublicJwk: string): Promise<CryptoKey> {
  const [privateKey, publicKey] = await Promise.all([
    subtle.importKey('jwk', JSON.parse(privateJwk) as JsonWebKey, IDENTITY_ALGORITHM, false, [
      'deriveBits',
    ]),
    subtle.importKey('jwk', JSON.parse(peerPublicJwk) as JsonWebKey, IDENTITY_ALGORITHM, false, []),
  ]);

  // The raw ECDH output is a curve point, not a uniform key: run it through
  // HKDF before it is used as an AES key.
  const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);

  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // A fixed salt is safe here: the pair is static and every wrap uses a
      // fresh random IV. `info` domain-separates this use of the secret.
      salt: new Uint8Array(new ArrayBuffer(32)),
      info: encoder.encode(WRAP_INFO),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function importContentKey(channelKey: string): Promise<CryptoKey> {
  return subtle.importKey('raw', fromBase64(channelKey), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// The typed arrays below are built on an explicit ArrayBuffer: WebCrypto's
// BufferSource excludes SharedArrayBuffer-backed views.
function randomIv() {
  return randomBytes(IV_BYTES);
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
