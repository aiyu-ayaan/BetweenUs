/**
 * Self-check for the boot screen: `tsx src/features/shell/LoadingScreen.check.ts`.
 *
 * The screen itself is three CSS animations and cannot be asserted here. What
 * can, and what would otherwise only be noticed by somebody staring at a launch
 * they were not trying to look at, is the timing and the copy: a tip that
 * arrives before the wait is a wait, a rotation shorter than the time it takes
 * to read a line, or a line long enough to wrap the reserved space and shove
 * the mark up the screen.
 */
import assert from 'node:assert/strict';
import { LoadingScreen, TIPS, TIP_DELAY_MS, TIP_ROTATE_MS } from './LoadingScreen';

assert.equal(typeof LoadingScreen, 'function');

// The tip waits for the wait to become one. A restore is usually a single
// round trip; anything that flashes up inside that is noise.
assert.ok(TIP_DELAY_MS >= 800, 'a tip must not flash up during an ordinary fast start');

// And once it is up it stays long enough to be read. Roughly 200ms per word at
// a lazy reading pace, against the longest line on the list.
const longest = TIPS.reduce((most, tip) => Math.max(most, tip.split(' ').length), 0);
assert.ok(
  TIP_ROTATE_MS >= longest * 200,
  `the rotation (${TIP_ROTATE_MS}ms) is shorter than the longest tip takes to read`,
);

assert.ok(TIPS.length >= 3, 'one or two tips is a rotation somebody notices repeating');
assert.equal(new Set(TIPS).size, TIPS.length, 'a duplicated tip reads as the screen being stuck');

for (const tip of TIPS) {
  assert.ok(tip.trim().length > 0, 'an empty tip is a gap that looks like a failure');
  // The slot is `h-10` and `max-w-sm`: about two lines. A third line pushes
  // the mark upwards mid-wait, which reads as a second thing going wrong.
  assert.ok(tip.length <= 96, `tip too long for the reserved two lines: ${tip}`);
  // Sentences, because they are read once and never in a list.
  assert.ok(/[.?]$/.test(tip), `a tip is a sentence and ends like one: ${tip}`);
}

// Nothing here may claim progress. There is none to claim - a token refresh
// answers or it does not - and a percentage on a screen nobody is measuring is
// the one lie a loading screen is always tempted into.
for (const tip of TIPS) {
  assert.ok(!/%|loading|please wait/i.test(tip), `a tip is not a progress report: ${tip}`);
}

console.log('LoadingScreen.check.ts ok');
