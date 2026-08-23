/**
 * Run with `tsx src/services/safety-numbers.check.ts`.
 *
 * The properties worth holding, and every one of them is a way the feature
 * could be useless while still producing a number:
 *
 *   - both people compute the *same* number, whichever way round they are
 *   - the number changes when the key set changes, which is the whole point
 *   - the number does not change when the same keys arrive in another order,
 *     which would make every honest pair look like an attack
 *   - the number is tied to the account, so a key moved elsewhere does not
 *     carry its fingerprint with it
 */
import assert from 'node:assert/strict';
import {
  formatSafetyNumber,
  identityMaterial,
  safetyNumber,
  userFingerprint,
} from './safety-numbers';

const subtle = globalThis.crypto.subtle;

async function device(deviceId: string): Promise<{ deviceId: string; publicKey: string }> {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  return {
    deviceId,
    publicKey: JSON.stringify(await subtle.exportKey('jwk', pair.publicKey)),
  };
}

const laptop = await device('laptop');
const phone = await device('phone');
const stranger = await device('stranger');

const alice = 'aaaaaaaa-0000-0000-0000-000000000001';
const bob = 'bbbbbbbb-0000-0000-0000-000000000002';

// --- One person's half ------------------------------------------------------

const one = await userFingerprint(alice, await identityMaterial([laptop]));
assert.equal(one.length, 30, 'a half is thirty digits');
assert.match(one, /^\d{30}$/, 'and nothing but digits');

// The same input twice is the same number, or nothing else here means anything.
assert.equal(one, await userFingerprint(alice, await identityMaterial([laptop])));

// Device order must not matter. The material is sorted by device id, so a
// directory that returns rows the other way round is the same person.
const ordered = await userFingerprint(alice, await identityMaterial([laptop, phone]));
const reversed = await userFingerprint(alice, await identityMaterial([phone, laptop]));
assert.equal(ordered, reversed, 'the order rows arrive in must not change the number');

// Adding a device changes it. This is the property the feature exists for: a
// server that adds a key to somebody's directory cannot do it quietly.
assert.notEqual(one, ordered, 'a second device changes the number');

// The same keys under a different account are a different number, so a key
// lifted onto another account does not arrive already trusted.
assert.notEqual(one, await userFingerprint(bob, await identityMaterial([laptop])));

// A different key is a different number.
assert.notEqual(one, await userFingerprint(alice, await identityMaterial([stranger])));

// Nobody with no published device has a fingerprint at all - an empty string
// rather than a number over nothing, which would compare equal for every such
// person and read as "verified".
assert.equal(await userFingerprint(alice, await identityMaterial([])), '');

// --- The pair ---------------------------------------------------------------

const hers = await userFingerprint(bob, await identityMaterial([stranger]));

// Both ends print the same sixty digits without either being told to go first.
assert.equal(safetyNumber(one, hers), safetyNumber(hers, one));
assert.equal(safetyNumber(one, hers).length, 60);

// A pair where one half is missing is no number at all. Half of a safety
// number is something two people could read to each other and match.
assert.equal(safetyNumber(one, ''), '');
assert.equal(safetyNumber('', hers), '');

// --- Reading it out ---------------------------------------------------------

const shown = formatSafetyNumber(safetyNumber(one, hers));
assert.equal(shown.split('\n').length, 3, 'three lines of four groups');
for (const line of shown.split('\n')) {
  assert.match(line, /^\d{5} \d{5} \d{5} \d{5}$/, 'five digits a group, four to a line');
}
// The digits themselves survive the formatting.
assert.equal(shown.replace(/[\s]/g, ''), safetyNumber(one, hers));

console.log('safety-numbers: ok');
