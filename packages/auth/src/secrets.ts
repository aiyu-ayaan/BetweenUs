/**
 * Symmetric sealing for configuration secrets that have to be readable again -
 * OAuth client secrets, which the provider exchange needs in the clear.
 *
 * Passwords are hashed, not sealed; this is the other case. AES-256-GCM with a
 * random IV per value, so the same secret never produces the same ciphertext,
 * and the tag makes a tampered row fail loudly instead of decrypting to junk.
 *
 * The key is derived from `SETTINGS_SECRET`, falling back to `JWT_SECRET` so a
 * deployment that predates this feature keeps working.
 *
 * `SETTINGS_SECRET_PREVIOUS` is what makes rotating it something other than a
 * silent loss. Sealing always uses the live key; opening tries the live key and
 * then the previous one, so a rotation re-reads what is already stored and the
 * next admin-panel save writes it back under the new key. Without it, rotating
 * turns every stored OAuth client secret into a value that decrypts to nothing -
 * and `openSecret` returns null for that, which looks like an empty setting
 * rather than like a mistake.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '@betweenus/config';

const VERSION = 'v1';

function derive(material: string): Buffer {
  // A hash, not the raw value: the key has to be exactly 32 bytes.
  return createHash('sha256').update(`betweenus-settings:${material}`).digest();
}

function key(): Buffer {
  const material = env('SETTINGS_SECRET') ?? env('JWT_SECRET');
  if (!material) throw new Error('SETTINGS_SECRET or JWT_SECRET must be set to seal secrets');
  return derive(material);
}

/** The key before the last rotation, if this deployment is mid-rotation. */
function previousKey(): Buffer | undefined {
  const material = env('SETTINGS_SECRET_PREVIOUS') ?? env('JWT_SECRET_PREVIOUS');
  return material === undefined ? undefined : derive(material);
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

  const withKey = (material: Buffer): string | null => {
    try {
      const decipher = createDecipheriv('aes-256-gcm', material, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  };

  const opened = withKey(key());
  if (opened !== null) return opened;

  const previous = previousKey();
  return previous === undefined ? null : withKey(previous);
}
