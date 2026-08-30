/**
 * The arithmetic behind every number on the health screen.
 *
 * Worth pinning because these are the failures that never look like failures.
 * A byte formatter that divides by 1000 renders a perfectly plausible screen
 * that is wrong by 2.4% per unit; a duration that forgets to carry hours out of
 * days reports a fortnight of uptime as fourteen days and twenty-six hours. Both
 * pass an eyeball and neither passes an assertion.
 *
 * Run with: pnpm --filter @betweenus/admin check
 */
import assert from 'node:assert/strict';
import { formatBytes, formatCount, formatDuration, percentOf } from './format';

// The divisor is 1024, not 1000. This is the whole reason the module exists.
assert.equal(formatBytes(0), '0 B');
assert.equal(formatBytes(999), '999 B');
assert.equal(formatBytes(1023), '1023 B', 'still bytes right up to the boundary');
assert.equal(formatBytes(1024), '1.00 KB', 'the boundary is 1024, never 1000');
assert.equal(formatBytes(1000), '1000 B', 'a thousand bytes is not a kilobyte');
assert.equal(formatBytes(1024 * 1024), '1.00 MB');
assert.equal(formatBytes(1024 ** 3), '1.00 GB');
assert.equal(formatBytes(1024 ** 4), '1.00 TB');
assert.equal(formatBytes(1024 ** 5), '1.00 PB');
// Past the last unit it keeps counting in petabytes rather than falling off the
// end of the table and rendering `undefined`.
assert.equal(formatBytes(1024 ** 6), '1024 PB');

// Precision shrinks as the unit grows, so a column of sizes stays scannable.
assert.equal(formatBytes(1536), '1.50 KB');
assert.equal(formatBytes(1024 * 50), '50.0 KB');
assert.equal(formatBytes(1024 * 500), '500 KB');

// Not-a-number is a missing measurement, and must never render as a size.
assert.equal(formatBytes(Number.NaN), '—');
assert.equal(formatBytes(Number.POSITIVE_INFINITY), '—');

assert.equal(formatDuration(0), '0s');
assert.equal(formatDuration(45), '45s');
assert.equal(formatDuration(60), '1m');
assert.equal(formatDuration(90), '1m 30s');
assert.equal(formatDuration(3600), '1h');
assert.equal(formatDuration(3600 + 12 * 60), '1h 12m');
assert.equal(formatDuration(86400), '1d');
// The carry that goes wrong: a day and a bit is `1d 4h`, never `1d 28h`.
assert.equal(formatDuration(86400 + 4 * 3600 + 59 * 60), '1d 4h');
assert.equal(formatDuration(14 * 86400 + 3600), '14d 1h');
assert.equal(formatDuration(-1), '—', 'a negative uptime is a bug, not a duration');

assert.equal(formatCount(0), '0');
assert.equal(formatCount(Number.NaN), '—');

// A server reporting no connection cap must not paint a bar `NaN%` wide, which
// CSS reads as "as wide as you like".
assert.equal(percentOf(5, 0), 0);
assert.equal(percentOf(5, 10), 50);
assert.equal(percentOf(30, 10), 100, 'clamped: a bar never overflows its track');
assert.equal(percentOf(-5, 10), 0);

console.log('format.check.ts: ok');
