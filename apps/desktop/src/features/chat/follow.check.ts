/** Run with `tsx src/features/chat/follow.check.ts`. The message list's latch. */
import assert from 'node:assert/strict';
import { FOLLOW_SLACK_PX, nextFollow, type ScrollBox } from './follow';

/** A viewport 600 tall holding `content`, scrolled to `top`. */
const box = (content: number, top: number): ScrollBox => ({
  scrollHeight: content,
  scrollTop: top,
  clientHeight: 600,
});

// --- at the bottom -----------------------------------------------------------

// Pinned to the bottom, however it got there.
assert.equal(nextFollow(true, 1400, box(2000, 1400)), true);
assert.equal(nextFollow(false, 1400, box(2000, 1400)), true, 'coming back re-pins');
// Within the slack still counts: a smooth scroll that is a pixel from settling
// must not read as somebody walking away.
assert.equal(nextFollow(true, 1400, box(2000, 1400 - (FOLLOW_SLACK_PX - 1))), true);

// --- the reader scrolls away -------------------------------------------------

// Up and out of the slack: the one thing content cannot do to itself.
assert.equal(nextFollow(true, 1400, box(2000, 900)), false);
// A nudge up that stays within the slack is still reading the newest message.
assert.equal(nextFollow(true, 1400, box(2000, 1390)), true);
// Scrolling down, but not all the way back, does not re-pin on its own.
assert.equal(nextFollow(false, 900, box(2000, 1000)), false);

// --- the content moves, not the reader ---------------------------------------

// A picture decrypted and the row grew by 300: same scroll position, bottom
// suddenly 300 away. This is the case the old rule got wrong, and the reason
// a channel of photos stopped following the conversation.
assert.equal(nextFollow(true, 1400, box(2300, 1400)), true, 'growth must not un-pin');
// Several of them, one after another, as a channel of photos decrypts.
let following = true;
for (const grown of [2300, 2600, 2900, 3200]) {
  following = nextFollow(following, 1400, box(grown, 1400));
}
assert.equal(following, true, 'a channel of photos must still be following');

// The viewport shrank instead - a typing indicator appeared, or the composer
// grew a preview of the photo about to be sent. Nothing scrolled at all.
assert.equal(
  nextFollow(true, 1400, { scrollHeight: 2000, scrollTop: 1400, clientHeight: 440 }),
  true,
  'a shorter viewport must not un-pin',
);

// And a reader who had already walked away is not dragged back by any of it.
assert.equal(nextFollow(false, 900, box(2300, 900)), false);

// --- the list is shorter than the viewport -----------------------------------

// Nothing to scroll: an empty or nearly empty channel is at the bottom by
// definition, and the first message must land under the follow.
assert.equal(nextFollow(true, 0, box(300, 0)), true);
assert.equal(nextFollow(false, 0, box(300, 0)), true);

console.log('follow.check.ts ok');
