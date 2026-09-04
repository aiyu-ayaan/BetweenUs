/** Self-check for `spentAfter`: the moments player's clock, across pauses. */
import assert from 'node:assert/strict';
import { spentAfter } from './clock';

// A bar that was running is charged for the time it ran.
assert.equal(spentAfter(0, 1_000, 3_000), 2_000);

// And keeps what it already had, so a post resumed twice is not restarted.
assert.equal(spentAfter(2_000, 5_000, 6_500), 3_500);

// The regression this exists for: a bar that never started spends nothing.
//
// Every bar in a run mounts when the player opens, and each one is paused the
// instant it becomes the current post - the picture is still downloading. A
// start time taken at mount would have charged it for every second the earlier
// posts were up, so the second photo of three opened already spent, fired in
// the same frame, and the run jumped to the next person.
assert.equal(spentAfter(0, null, 60_000), 0);
assert.equal(spentAfter(2_000, null, 60_000), 2_000);

// A clock that steps backwards - the machine woke, or the system time moved -
// takes nothing off. Time not spent is the safe direction to be wrong in: the
// post holds the screen a moment too long rather than vanishing.
assert.equal(spentAfter(2_000, 5_000, 4_000), 2_000);

console.log('status clock check ok');
