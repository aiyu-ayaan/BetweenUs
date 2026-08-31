/**
 * That the STUN wire format written by hand in `turn-probe.ts` is the one on
 * the wire.
 *
 * Every assertion here is a mistake that produces the *same* symptom in
 * production - a relay answering `401` to a credential that is perfectly
 * correct - and none of them can be told apart by looking at the failure. That
 * is the whole reason this file exists: the protocol has no useful error
 * reporting, so the encoding has to be checked against the specification rather
 * than against a running relay.
 *
 * The one worth naming: `MESSAGE-INTEGRITY` is computed over a header whose
 * declared length already includes the 24 bytes of the attribute that has not
 * been appended yet (RFC 5389 §15.4). Get it wrong and every allocation is
 * refused, with an error that points at the credential instead of the code.
 *
 * Nothing here opens a socket. `probeRelay` needs a relay and belongs in
 * TESTING.md; these are the pure parts, which are the parts that are wrong.
 *
 * Run with: pnpm --filter @betweenus/call-service check
 */
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import {
  decodeErrorCode,
  decodeXorAddress,
  encodeAttribute,
  encodeMessage,
  encodeSigned,
  longTermKey,
  parseMessage,
  parseTurnUrl,
} from './turn-probe';

const MAGIC_COOKIE = 0x2112a442;

function attributesArePaddedButNotOverDeclared(): void {
  // Three bytes of value: one byte of padding, and a declared length that still
  // says three. A parser that read the padded length would find an attribute
  // boundary one byte late for the rest of the message.
  const attribute = encodeAttribute(0x0006, Buffer.from('abc', 'utf8'));
  assert.equal(attribute.length, 8, 'padded to a four-byte boundary');
  assert.equal(attribute.readUInt16BE(2), 3, 'but the declared length excludes the padding');
  assert.equal(attribute.subarray(4, 7).toString('utf8'), 'abc');
  assert.equal(attribute.readUInt8(7), 0, 'padding is zero');

  const exact = encodeAttribute(0x0006, Buffer.from('abcd', 'utf8'));
  assert.equal(exact.length, 8, 'a value already on the boundary gains nothing');
}

function aMessageSurvivesARoundTrip(): void {
  const txid = Buffer.from('0123456789ab', 'utf8');
  const message = encodeMessage(0x0003, txid, [
    encodeAttribute(0x0019, Buffer.from([17, 0, 0, 0])),
    encodeAttribute(0x0006, Buffer.from('betweenus', 'utf8')),
  ]);

  assert.equal(message.readUInt32BE(4), MAGIC_COOKIE, 'the cookie is what marks it as STUN');
  assert.equal(message.readUInt16BE(2), message.length - 20, 'length counts the body only');

  const parsed = parseMessage(message);
  assert.ok(parsed, 'it parses back');
  assert.equal(parsed?.type, 0x0003);
  assert.ok(parsed?.txid.equals(txid), 'the transaction id survives, which is how a reply is matched');
  assert.equal(
    parsed?.attributes.get(0x0006)?.toString('utf8'),
    'betweenus',
    'and a padded attribute reads back without its padding',
  );
  assert.equal(parsed?.attributes.get(0x0019)?.readUInt8(0), 17, 'UDP');
}

function rubbishIsRejectedRatherThanGuessedAt(): void {
  assert.equal(parseMessage(Buffer.alloc(4)), null, 'too short to be a header');
  assert.equal(parseMessage(Buffer.alloc(20)), null, 'no magic cookie is not a STUN message');

  // A length field claiming more body than the datagram holds: a truncated or
  // hostile packet, and reading it would walk off the end of the buffer.
  const lying = encodeMessage(0x0003, Buffer.alloc(12), []);
  lying.writeUInt16BE(400, 2);
  assert.equal(parseMessage(lying), null, 'a length longer than the packet is refused');
}

/**
 * The signature the relay will recompute.
 *
 * Written out independently here rather than by calling the same helper: a
 * check that reuses the implementation's own arithmetic agrees with it whether
 * or not either is right.
 */
function integrityIsSignedOverTheLengthItWillHave(): void {
  const txid = Buffer.alloc(12, 7);
  const key = longTermKey('betweenus', 'example.org', 'secret');
  assert.deepEqual(
    key,
    createHash('md5').update('betweenus:example.org:secret').digest(),
    'MD5(username:realm:password), per RFC 5389 §15.4',
  );

  const attributes = [encodeAttribute(0x0019, Buffer.from([17, 0, 0, 0]))];
  const signed = encodeSigned(0x0003, txid, attributes, key);

  const integrity = signed.subarray(signed.length - 20);
  assert.equal(signed.readUInt16BE(signed.length - 24), 0x0008, 'MESSAGE-INTEGRITY is last');
  assert.equal(
    signed.readUInt16BE(2),
    signed.length - 20,
    'the declared length counts the integrity attribute',
  );

  // Recompute the way a relay does: everything before the attribute, with the
  // header length already counting it.
  const covered = signed.subarray(0, signed.length - 24);
  const expected = createHmac('sha1', key).update(covered).digest();
  assert.deepEqual(integrity, expected, 'the HMAC covers the message as the relay will read it');

  // And the failure this is really guarding: signing the shorter length.
  const naive = encodeMessage(0x0003, txid, attributes);
  const wrong = createHmac('sha1', key).update(naive).digest();
  assert.notDeepEqual(integrity, wrong, 'signing the pre-append length is the classic bug');
}

/** RFC 5389 §15.2's own worked example, which is why these constants look odd. */
function xorAddressesAreUnmasked(): void {
  const txid = Buffer.from('0123456789ab', 'utf8');

  // 192.0.2.1:32853 masked with the cookie.
  const value = Buffer.alloc(8);
  value.writeUInt8(0, 0);
  value.writeUInt8(0x01, 1);
  value.writeUInt16BE(32853 ^ (MAGIC_COOKIE >>> 16), 2);
  const cookie = Buffer.alloc(4);
  cookie.writeUInt32BE(MAGIC_COOKIE, 0);
  for (const [index, octet] of [192, 0, 2, 1].entries()) {
    value.writeUInt8(octet ^ (cookie[index] as number), 4 + index);
  }

  assert.equal(decodeXorAddress(value, txid), '192.0.2.1:32853');
  assert.equal(decodeXorAddress(Buffer.alloc(4), txid), null, 'a truncated address is not guessed');
}

function errorCodesReadAsNumbers(): void {
  // Class 4, number 01, with a reason - the refusal that carries the realm.
  const value = Buffer.concat([
    Buffer.from([0, 0, 4, 1]),
    Buffer.from('Unauthorized', 'utf8'),
  ]);
  assert.deepEqual(decodeErrorCode(value), { code: 401, reason: 'Unauthorized' });

  const forbidden = Buffer.concat([Buffer.from([0, 0, 4, 3]), Buffer.from('Forbidden', 'utf8')]);
  assert.equal(decodeErrorCode(forbidden).code, 403);
  assert.equal(decodeErrorCode(Buffer.alloc(2)).code, 0, 'a truncated code is 0, not a crash');
}

/**
 * URL parsing, including the defaults nobody remembers.
 *
 * `new URL` is not usable here: it refuses `turn:` outright, so the alternative
 * to this regex is not the platform parser, it is being wrong about ports.
 */
function turnUrlsAreReadTheWayRfc7065Says(): void {
  assert.deepEqual(parseTurnUrl('turn:203.0.113.10:3478'), {
    scheme: 'turn',
    host: '203.0.113.10',
    port: 3478,
    transport: 'udp',
  });

  assert.deepEqual(
    parseTurnUrl('turn:relay.example.com'),
    { scheme: 'turn', host: 'relay.example.com', port: 3478, transport: 'udp' },
    'turn: defaults to 3478 over UDP',
  );

  assert.deepEqual(
    parseTurnUrl('turns:relay.example.com'),
    { scheme: 'turns', host: 'relay.example.com', port: 5349, transport: 'tcp' },
    'turns: defaults to 5349 over TCP - a different port, not just a different scheme',
  );

  assert.equal(
    parseTurnUrl('turns:relay.example.com:443?transport=tcp')?.port,
    443,
    'an explicit port wins over the default',
  );

  assert.equal(
    parseTurnUrl('turn:relay.example.com:3478?transport=tcp')?.transport,
    'tcp',
    'and an explicit transport wins over the scheme default',
  );

  assert.equal(parseTurnUrl('stun:stun.example.com:3478'), null, 'STUN is not a relay');
  assert.equal(parseTurnUrl('https://relay.example.com'), null);
  assert.equal(parseTurnUrl('turn:relay.example.com:0'), null, 'port 0 is not a port');
  assert.equal(parseTurnUrl('turn:relay.example.com:70000'), null, 'nor is one past 65535');
}

function main(): void {
  attributesArePaddedButNotOverDeclared();
  aMessageSurvivesARoundTrip();
  rubbishIsRejectedRatherThanGuessedAt();
  integrityIsSignedOverTheLengthItWillHave();
  xorAddressesAreUnmasked();
  errorCodesReadAsNumbers();
  turnUrlsAreReadTheWayRfc7065Says();
  console.log('turn-probe self-check passed');
}

main();
