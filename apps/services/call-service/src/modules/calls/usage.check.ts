/** `pnpm --filter @betweenus/call-service check` - the clamp on reported usage. */
import assert from 'node:assert/strict';
import { MAX_REPORTED_BYTES, clampReportedBytes } from './usage';

assert.equal(clampReportedBytes(1024), 1024, 'an ordinary figure survives');
assert.equal(clampReportedBytes(0), 0);
assert.equal(clampReportedBytes(-5), 0, 'no call refunds data');
assert.equal(clampReportedBytes(Number.NaN), 0, 'nonsense reads as nothing');
assert.equal(clampReportedBytes(Number.POSITIVE_INFINITY), 0, 'infinity is nonsense, not a big number');
assert.equal(clampReportedBytes(MAX_REPORTED_BYTES * 10), MAX_REPORTED_BYTES);
assert.equal(clampReportedBytes(12.7), 12, 'whole bytes only');

console.log('call usage clamp: ok');
