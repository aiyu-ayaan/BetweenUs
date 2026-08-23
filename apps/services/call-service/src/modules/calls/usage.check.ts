/** `pnpm --filter @betweenus/call-service check` - the clamp on reported usage. */
import assert from 'node:assert/strict';
import { MAX_REPORTED_BYTES, clampReportedBytes, clampReportedLinks } from './usage';

assert.equal(clampReportedBytes(1024), 1024, 'an ordinary figure survives');
assert.equal(clampReportedBytes(0), 0);
assert.equal(clampReportedBytes(-5), 0, 'no call refunds data');
assert.equal(clampReportedBytes(Number.NaN), 0, 'nonsense reads as nothing');
assert.equal(clampReportedBytes(Number.POSITIVE_INFINITY), 0, 'infinity is nonsense, not a big number');
assert.equal(clampReportedBytes(MAX_REPORTED_BYTES * 10), MAX_REPORTED_BYTES);
assert.equal(clampReportedBytes(12.7), 12, 'whole bytes only');

assert.deepEqual(clampReportedLinks(undefined), [], 'a client that reports nothing reports nothing');
assert.deepEqual(clampReportedLinks([{ username: 'nobody' }]), [], 'a link with no peer is not a link');
assert.deepEqual(
  clampReportedLinks([
    {
      userId: 'u1',
      username: 'ayaan',
      bytesSent: 10.9,
      bytesReceived: -1,
      roundTripMs: 42.4,
      packetsLost: 3,
      packetsReceived: 100,
      transport: 'relay',
    },
  ]),
  [
    {
      userId: 'u1',
      username: 'ayaan',
      bytesSent: 10,
      bytesReceived: 0,
      roundTripMs: 42,
      packetsLost: 3,
      packetsReceived: 100,
      transport: 'relay',
    },
  ],
  'an ordinary link survives, rounded and floored',
);
assert.equal(
  clampReportedLinks([{ userId: 'u1', transport: 'sfu' }])[0]?.transport,
  null,
  'a transport nobody defined reads as unknown, not as itself',
);
assert.equal(
  clampReportedLinks(Array.from({ length: 500 }, (_, i) => ({ userId: `u${i}` }))).length,
  32,
  'a flood of links is cut to a call-sized number',
);

console.log('call usage clamp: ok');
