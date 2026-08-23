/**
 * Safety numbers: the thing that makes the key directory checkable.
 *
 * Everything else in `E2EE.md` protects a message from whoever reads the
 * database. None of it protects against the *server handing out the wrong
 * public key*, because a client has no way to tell a stranger's key from a
 * substituted one - it asked the server, and the server answered. A safety
 * number is the answer: two people compare a short string over a channel the
 * server does not control, and if it matches, they know they hold each other's
 * real keys.
 *
 * This is the last of the three E2EE items and the one with the most UI in it,
 * because the cryptography is the easy half. Nobody is protected by a
 * fingerprint they never look at.
 *
 * ## Why a whole user rather than a device
 *
 * The directory is one key per machine, so a per-device number would mean
 * comparing n by m strings with somebody who owns a laptop and a phone, which
 * is a feature people would stop using rather than report. The number is over
 * the user's *whole* active device set instead: every machine they have, in a
 * canonical order.
 *
 * That has the property that matters. A server that adds a device to somebody's
 * directory - which is exactly how it would read their messages - changes their
 * safety number, and a number that was verified stops matching. So does
 * genuinely adding a phone, and that is correct rather than unfortunate: the
 * client cannot tell those apart, and neither can the person, which is the
 * whole reason they are asked to look.
 *
 * ## The algorithm
 *
 * Signal's numeric fingerprint, and deliberately not something invented here.
 * Iterated SHA-512 over the key material, truncated to 30 bytes, read as six
 * groups of five decimal digits. The iteration count is the point of it: a
 * 30-digit truncation is short enough to read aloud, so making each guess cost
 * 5200 hashes is what keeps somebody from grinding out a key that collides with
 * a number you already trust.
 *
 * The two halves are sorted before being joined, so both people see the same
 * string without either being "first".
 */

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

/**
 * Signal's count, kept rather than tuned. It is the only thing standing between
 * a 30-digit fingerprint and somebody who wants to find a second key that
 * produces it, so it is not the number to shave for a faster dialog.
 */
const FINGERPRINT_ITERATIONS = 5200;

/** Two bytes of version, so a later scheme cannot be confused with this one. */
const FINGERPRINT_VERSION = new Uint8Array([0x00, 0x00]);

/** Six groups of five digits: 30 digits per person, 60 in a displayed pair. */
const GROUP_BYTES = 5;
const GROUPS = 6;

/** A device as far as this file cares: an id to sort by and a key to hash. */
export interface FingerprintDevice {
  deviceId: string;
  /** The ECDH P-256 public half, as the JWK the directory stores. */
  publicKey: string;
}

/**
 * The bytes that stand for one person's identity.
 *
 * Every active device's public key, in device-id order, as raw uncompressed
 * curve points rather than as JWK text. The raw form is what makes this
 * canonical: two clients that serialise the same key with their JSON fields in
 * a different order would otherwise compute different numbers for the same
 * person, and the failure would look exactly like an attack.
 *
 * Sorting is by device id and not by key, because the id is what the person
 * sees in their own device list - an ordering somebody can check by hand is
 * worth more than one that is marginally cheaper.
 */
export async function identityMaterial(devices: FingerprintDevice[]): Promise<Uint8Array<ArrayBuffer>> {
  const sorted = [...devices].sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));

  const points = await Promise.all(
    sorted.map(async (device) => {
      const key = await subtle.importKey(
        'jwk',
        JSON.parse(device.publicKey) as JsonWebKey,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
      );
      return new Uint8Array(await subtle.exportKey('raw', key));
    }),
  );

  const total = points.reduce((sum, point) => sum + point.byteLength, 0);
  const material = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const point of points) {
    material.set(point, offset);
    offset += point.byteLength;
  }
  return material;
}

/**
 * One person's half of a safety number: thirty digits.
 *
 * The user id is hashed in alongside the keys so that moving a key to another
 * account does not carry its fingerprint with it. It is a stable identifier
 * rather than a display name for the same reason a username is not used: a
 * name can be changed by whoever runs the deployment.
 */
export async function userFingerprint(
  userId: string,
  material: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (material.byteLength === 0) return '';

  const identifier = encoder.encode(userId);
  let hash = new Uint8Array(
    await subtle.digest('SHA-512', concat(FINGERPRINT_VERSION, material, identifier)),
  );

  // Sequential on purpose - each round takes the last one's output, which is
  // what makes the work impossible to skip.
  for (let round = 1; round < FINGERPRINT_ITERATIONS; round += 1) {
    hash = new Uint8Array(await subtle.digest('SHA-512', concat(hash, material)));
  }

  let digits = '';
  for (let group = 0; group < GROUPS; group += 1) {
    digits += chunkToDigits(hash.subarray(group * GROUP_BYTES, (group + 1) * GROUP_BYTES));
  }
  return digits;
}

/**
 * The number the two people compare.
 *
 * Sorted, so both ends print the same sixty digits and neither has to be told
 * which of them goes first. An empty half - somebody with no devices at all -
 * gives an empty number rather than half of one, because half a safety number
 * is something that can be read aloud and matched, and it would mean nothing.
 */
export function safetyNumber(mine: string, theirs: string): string {
  if (!mine || !theirs) return '';
  return mine < theirs ? mine + theirs : theirs + mine;
}

/** Sixty digits in twelve groups of five, which is how they are read aloud. */
export function formatSafetyNumber(digits: string): string {
  const groups = digits.match(/.{1,5}/g) ?? [];
  const lines: string[] = [];
  for (let index = 0; index < groups.length; index += 4) {
    lines.push(groups.slice(index, index + 4).join(' '));
  }
  return lines.join('\n');
}

function chunkToDigits(chunk: Uint8Array): string {
  // Five bytes is forty bits, which exceeds what a 32-bit shift can hold, so
  // this accumulates in a float - exact up to 2^53 and therefore exact here.
  let value = 0;
  for (const byte of chunk) value = value * 256 + byte;
  return String(value % 100_000).padStart(5, '0');
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
