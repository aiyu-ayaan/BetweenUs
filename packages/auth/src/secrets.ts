/**
 * Symmetric sealing for configuration secrets that have to be readable again -
 * OAuth client secrets, which the provider exchange needs in the clear.
 *
 * Passwords are hashed, not sealed; this is the other case. AES-256-GCM with a
 * random IV per value, so the same secret never produces the same ciphertext,
 * and the tag makes a tampered row fail loudly instead of decrypting to junk.
 *
 * The key is derived from `SETTINGS_SECRET`, falling back to `JWT_SECRET` so a
 * deployment that predates this feature keeps working. Rotating either one
 * makes the stored secrets unreadable - re-enter them in the admin panel.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function key(): Buffer {
  const material = process.env.SETTINGS_SECRET ?? process.env.JWT_SECRET;
  if (!material) throw new Error('SETTINGS_SECRET or JWT_SECRET must be set to seal secrets');
  // A hash, not the raw value: the key has to be exactly 32 bytes.
  return createHash('sha256').update(`betweenus-settings:${material}`).digest();
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), ciphertext.toString('base64'), cipher.getAuthTag().toString('base64')].join(
    '.',
  );
}

/** Returns null when the value was sealed with a different key, or tampered with. */
export function openSecret(sealed: string): string | null {
  const [version, iv, ciphertext, tag] = sealed.split('.');
  if (version !== VERSION || !iv || !ciphertext || !tag) return null;

  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
