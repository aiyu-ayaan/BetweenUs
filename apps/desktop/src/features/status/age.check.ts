/** Self-check for `statusAge`: the boundaries, and the clock that runs fast. */
import assert from 'node:assert/strict';
import { statusAge } from './age';

const now = new Date('2026-09-03T12:00:00.000Z');
const at = (ms: number): string => new Date(now.getTime() - ms).toISOString();

assert.equal(statusAge(at(0), now), 'just now');
assert.equal(statusAge(at(59_000), now), 'just now');
// The first minute is the boundary everything else hangs off.
assert.equal(statusAge(at(60_000), now), '1m ago');
assert.equal(statusAge(at(59 * 60_000), now), '59m ago');
assert.equal(statusAge(at(60 * 60_000), now), '1h ago');
assert.equal(statusAge(at(23 * 3_600_000), now), '23h ago');

// A client clock a few seconds behind the server's makes a fresh post look
// like it was written in the future. It reads as "just now", not "-1m ago".
assert.equal(statusAge(at(-5_000), now), 'just now');

// Nothing renders for a timestamp that is not one.
assert.equal(statusAge('not a date', now), '');

console.log('status age check ok');
