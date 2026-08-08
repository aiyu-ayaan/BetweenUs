/** Self-check: `pnpm --filter @nexora/desktop check`. Wrap/unwrap + message round-trip. */
import assert from 'node:assert/strict';
import {
  decryptMessage,
  encryptMessage,
  generateChannelKey,
  generateIdentity,
  parseEnvelope,
  unwrapChannelKey,
  wrapChannelKey,
} from './e2ee-crypto';

function flipLastChar(value: string): string {
  const last = value.at(-1) === 'A' ? 'B' : 'A';
  return value.slice(0, -1) + last;
}

async function main(): Promise<void> {
  const alice = await generateIdentity();
  const bob = await generateIdentity();
  const mallory = await generateIdentity();

  const channelKey = generateChannelKey();

  // Alice seals the channel key for Bob; only Bob's private key opens it.
  const forBob = await wrapChannelKey(channelKey, alice.privateKey, bob.publicKey);
  assert.equal(await unwrapChannelKey(forBob, bob.privateKey, alice.publicKey), channelKey);

  await assert.rejects(() => unwrapChannelKey(forBob, mallory.privateKey, alice.publicKey));

  // A sender also needs the key back on their own device.
  const forSelf = await wrapChannelKey(channelKey, alice.privateKey, alice.publicKey);
  assert.equal(await unwrapChannelKey(forSelf, alice.privateKey, alice.publicKey), channelKey);

  // Message round-trip through the wire format.
  const envelope = await encryptMessage('gm, encrypted', channelKey, 1);
  const serialised = JSON.stringify(envelope);
  assert.ok(!serialised.includes('gm, encrypted'), 'plaintext must not survive serialisation');

  const parsed = parseEnvelope(serialised);
  if (!parsed) throw new Error('envelope must parse back');
  assert.equal(parsed.epoch, 1);
  assert.equal(await decryptMessage(parsed, channelKey), 'gm, encrypted');

  // The wrong channel key must fail loudly rather than return garbage.
  await assert.rejects(() => decryptMessage(parsed, generateChannelKey()));

  // A tampered ciphertext must fail the GCM tag check.
  await assert.rejects(() => decryptMessage({ ...envelope, ct: flipLastChar(envelope.ct) }, channelKey));

  // Plaintext rows from before E2EE stay renderable instead of throwing.
  assert.equal(parseEnvelope('hello world'), null);
  assert.equal(parseEnvelope('{"v":2,"epoch":1,"iv":"a","ct":"b"}'), null);

  console.log('desktop e2ee-crypto check ok');
}

void main();
