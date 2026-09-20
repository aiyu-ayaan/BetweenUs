/**
 * End-to-end encryption primitives. WebCrypto only, no app imports, so this
 * module also runs under Node for `pnpm --filter @betweenus/desktop check`.
 *
 * Scheme (see development/devdocs/E2EE.md):
 *   - identity: ECDH P-256 key pair per *account*, held in a sealed keyring
 *   - vault: a random 32-byte master key seals the keyring; each factor seals
 *     the master key independently (PBKDF2 for a typed secret, ECDH for a
 *     grant to a machine)
 *   - channel key: random AES-256-GCM key per channel, per epoch
 *   - distribution: ECDH(sender account, recipient account) -> HKDF-SHA256 ->
 *     AES-GCM wrap, once per member rather than once per machine
 *   - messages and call media: AES-256-GCM under the channel key
 *
 * The device key pair is still here and still per machine. What it is for is
 * narrower than it was: receiving a vault grant, and being revocable. It is
 * no longer what a channel key is addressed to, which is the change that
 * stopped a new machine being a machine with no history.
 */
import type {
  BackupSecretKind,
  EncryptedEnvelope,
  IdentityBackup,
  PortableFactorKind,
  PutVaultFactorRequest,
  SealedKeyring,
  VaultFactor,
} from '@betweenus/shared-types';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const IDENTITY_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' } as const;
const WRAP_INFO = 'betweenus/e2ee/v1/channel-key-wrap';
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

// --- The account vault --------------------------------------------------------
//
// One master key per account seals one identity *keyring*; every door into the
// vault seals that same master key independently. Channel keys are wrapped to
// the keyring's current public half, so any machine that can open any door
// reads everything the account has ever been wrapped for - including history
// from before that machine existed.
//
// Two indirections, and both earn their place:
//
// - **Master key, not "the identity sealed four ways".** Adding or replacing a
//   door re-seals 32 bytes rather than the identity, so a password change and
//   a device approval touch nothing that history depends on.
// - **A ring, not a key.** Rotating after a lost laptop appends a generation
//   and leaves the rest, so every key ever wrapped to an older public half
//   still opens. v1 could not rotate at all, for want of exactly this.

/** Domain separation, so a device grant can never be replayed as a channel wrap. */
const GRANT_INFO = 'betweenus/e2ee/v2/vault-grant';

/** 32 bytes, like the channel key it is a sibling of. */
const MASTER_KEY_BYTES = 32;

/**
 * Crockford base32 without the letters that read as digits, so a code can be
 * copied off paper by somebody who is not enjoying the experience.
 */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 26 characters of that alphabet is 130 bits. Not guessable, and writable. */
const RECOVERY_CODE_LENGTH = 26;

/** One identity, and when it became the account's. */
export interface KeyringEntry {
  generation: number;
  publicKey: string;
  privateKey: string;
}

export interface OpenVault {
  /** Base64, 32 bytes. Seals the keyring and nothing else. */
  masterKey: string;
  /** Oldest generation first. The last one is what others wrap to now. */
  keyring: KeyringEntry[];
}

/** The generation everybody else wraps for. */
export function currentIdentityOf(vault: OpenVault): KeyringEntry {
  const latest = vault.keyring[vault.keyring.length - 1];
  if (!latest) throw new Error('A keyring with no identities in it');
  return latest;
}

export function generateMasterKey(): string {
  return toBase64(randomBytes(MASTER_KEY_BYTES));
}

/**
 * A recovery code, in groups of four.
 *
 * The factor that exists so an account can *always* get back in. It is not
 * derived from anything somebody can change (a password), forget (a
 * passphrase) or lose with a machine (a grant) - it is 130 bits shown once and
 * written down, which is the only kind of secret that survives the day
 * everything else goes wrong.
 *
 * Rejection sampling rather than a modulo, because the alphabet is 32
 * characters and a byte is 256 values - the bias would be invisible and real.
 */
export function generateRecoveryCode(): string {
  const out: string[] = [];
  while (out.length < RECOVERY_CODE_LENGTH) {
    for (const byte of randomBytes(RECOVERY_CODE_LENGTH)) {
      if (out.length === RECOVERY_CODE_LENGTH) break;
      // 256 is not a multiple of 32 only because of the top bits; masking to
      // five bits makes every value in range and the draw uniform.
      out.push(RECOVERY_ALPHABET[byte & 31]!);
    }
  }
  return (out.join('').match(/.{1,4}/g) ?? []).join('-');
}

/**
 * What a typed recovery code has to become before it is used as a secret.
 *
 * Somebody reading one off paper will use spaces, lowercase, or the dashes
 * this printed and one they added. Normalising here rather than at each call
 * site means a correct code never fails for the shape it was typed in - which
 * would be indistinguishable, to the person typing it, from having lost the
 * account.
 */
export function normaliseRecoveryCode(typed: string): string {
  const bare = typed.toUpperCase().replace(/[^0-9A-Z]/g, '');
  // The two substitutions people actually make, and the reason the alphabet
  // excludes I, L, O and U in the first place.
  const folded = bare.replace(/[IL]/g, '1').replace(/O/g, '0');
  return (folded.match(/.{1,4}/g) ?? []).join('-');
}

/** Seals the master key under a secret somebody typed. */
export async function sealMasterKeyWithSecret(
  masterKey: string,
  secret: string,
  kind: PortableFactorKind,
): Promise<PutVaultFactorRequest> {
  const salt = randomBytes(BACKUP_SALT_BYTES);
  const key = await deriveBackupKey(secret, salt, BACKUP_ITERATIONS);
  const iv = randomIv();
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv }, key, fromBase64(masterKey));

  return {
    v: 1,
    kind,
    deviceId: '',
    kdf: 'PBKDF2-SHA256',
    iterations: BACKUP_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(sealed)),
    senderPublicKey: '',
  };
}

/** Throws if the secret is wrong - AES-GCM's tag is the only check needed. */
export async function openMasterKeyWithSecret(
  factor: VaultFactor,
  secret: string,
): Promise<string> {
  const key = await deriveBackupKey(secret, fromBase64(factor.salt), factor.iterations);
  const opened = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(factor.iv) },
    key,
    fromBase64(factor.ct),
  );
  return toBase64(new Uint8Array(opened));
}

/**
 * Seals the master key to one machine's public key, which is how a machine
 * with no portable secret is let in.
 *
 * The sealing side is an *account* identity and the receiving side is a
 * *device* key, so the two halves of the ECDH come from different places on
 * purpose: the approver proves it holds the account, and the grant can only be
 * opened by the machine whose fingerprint the two people compared.
 */
export async function sealMasterKeyForDevice(
  masterKey: string,
  accountPrivateJwk: string,
  accountPublicJwk: string,
  deviceId: string,
  devicePublicJwk: string,
): Promise<PutVaultFactorRequest> {
  const key = await deriveGrantKey(accountPrivateJwk, devicePublicJwk);
  const iv = randomIv();
  const sealed = await subtle.encrypt({ name: 'AES-GCM', iv }, key, fromBase64(masterKey));

  return {
    v: 1,
    kind: 'device',
    deviceId,
    kdf: 'ECDH-HKDF-SHA256',
    iterations: 0,
    salt: '',
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(sealed)),
    senderPublicKey: accountPublicJwk,
  };
}

/** The receiving half: this machine's private key against the approver's. */
export async function openMasterKeyFromGrant(
  factor: VaultFactor,
  devicePrivateJwk: string,
): Promise<string> {
  const key = await deriveGrantKey(devicePrivateJwk, factor.senderPublicKey);
  const opened = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(factor.iv) },
    key,
    fromBase64(factor.ct),
  );
  return toBase64(new Uint8Array(opened));
}

/** Seals the keyring under the master key. */
export async function sealKeyring(
  keyring: KeyringEntry[],
  masterKey: string,
): Promise<SealedKeyring> {
  const key = await importContentKey(masterKey);
  const iv = randomIv();
  const sealed = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(keyring)),
  );
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(sealed)) };
}

/**
 * Opens the keyring, and refuses anything that is not one.
 *
 * The shape check is not defensive typing for its own sake. A keyring that
 * parsed to something unexpected and was used anyway would have this client
 * publish a public key it holds no private half for, and every key wrapped to
 * it afterwards would be unopenable - by anybody, forever.
 */
export async function openKeyring(
  sealed: SealedKeyring,
  masterKey: string,
): Promise<KeyringEntry[]> {
  const key = await importContentKey(masterKey);
  const opened = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) },
    key,
    fromBase64(sealed.ct),
  );

  const parsed: unknown = JSON.parse(decoder.decode(opened));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('The vault did not contain a keyring');
  }
  const keyring = parsed as KeyringEntry[];
  for (const entry of keyring) {
    if (
      typeof entry?.generation !== 'number' ||
      typeof entry?.publicKey !== 'string' ||
      typeof entry?.privateKey !== 'string'
    ) {
      throw new Error('The vault did not contain a keyring');
    }
  }
  return [...keyring].sort((left, right) => left.generation - right.generation);
}

/**
 * A digest of a public key, for two people to read to each other.
 *
 * The same construction as the safety number a conversation has, and for the
 * same reason: approving a grant seals the account's master key to whatever
 * key is in the request, so the only thing standing between that and a key
 * somebody else substituted is a person comparing twelve digits on two
 * screens.
 */
export async function keyFingerprint(publicJwk: string): Promise<string> {
  const digest = await subtle.digest('SHA-256', encoder.encode(publicJwk));
  const bytes = new Uint8Array(digest);
  const digits = [...bytes.slice(0, 6)]
    .map((byte) => byte.toString(10).padStart(3, '0'))
    .join('');
  return (digits.match(/.{1,4}/g) ?? []).join(' ');
}

/**
 * ECDH -> HKDF for a vault grant.
 *
 * Domain-separated from the channel-key wrap by `info`. The two use the same
 * curve and, in the approver's case, the same private key, so without this a
 * grant and a channel-key wrap would be the same ciphertext under the same
 * key - and a wrap intercepted from the directory could be replayed as a
 * grant of the account's master key.
 */
async function deriveGrantKey(privateJwk: string, peerPublicJwk: string): Promise<CryptoKey> {
  const [privateKey, publicKey] = await Promise.all([
    subtle.importKey('jwk', JSON.parse(privateJwk) as JsonWebKey, IDENTITY_ALGORITHM, false, [
      'deriveBits',
    ]),
    subtle.importKey('jwk', JSON.parse(peerPublicJwk) as JsonWebKey, IDENTITY_ALGORITHM, false, []),
  ]);

  const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);

  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(new ArrayBuffer(32)),
      info: encoder.encode(GRANT_INFO),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
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
