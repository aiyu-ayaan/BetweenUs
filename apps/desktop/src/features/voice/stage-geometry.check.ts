/**
 * Self-check for the letterbox arithmetic behind pointer and click mapping.
 *
 * Run with `pnpm --filter @nexora/desktop check`. Every named cursor and every
 * click handed to somebody else's machine goes through these two functions, so
 * an off-by-a-black-bar here is visible on the far end.
 */
import assert from 'node:assert/strict';
import { contentBox, fractionIn, EMPTY_BOX } from './stage-geometry';

// Same aspect ratio: the picture is the whole box.
assert.deepEqual(contentBox(1600, 900, 1920, 1080), {
  left: 0,
  top: 0,
  width: 1600,
  height: 900,
});

// A 16:10 desktop in a 16:9 box: bars down the sides, none top or bottom.
const wide = contentBox(1600, 900, 1920, 1200);
assert.equal(wide.height, 900);
assert.equal(wide.width, 1440);
assert.equal(wide.left, 80);
assert.equal(wide.top, 0);

// A 4:3 desktop in a wide box: the same, more so.
const tall = contentBox(1600, 900, 1024, 768);
assert.equal(tall.height, 900);
assert.equal(tall.width, 1200);
assert.equal(tall.left, 200);

// Nothing measured yet, and a track with no dimensions, are both "no picture".
assert.deepEqual(contentBox(0, 0, 1920, 1080), EMPTY_BOX);
assert.deepEqual(contentBox(1600, 900, 0, 0), EMPTY_BOX);

// The middle of the picture is the middle of the screen, bars or no bars.
assert.deepEqual(fractionIn(wide, 80 + 720, 450), { x: 0.5, y: 0.5 });
// The corners are exactly the corners.
assert.deepEqual(fractionIn(wide, 80, 0), { x: 0, y: 0 });
assert.deepEqual(fractionIn(wide, 1520, 900), { x: 1, y: 1 });
// On the black bar: not a point on anybody's screen, so nothing is sent.
assert.equal(fractionIn(wide, 40, 450), null);
assert.equal(fractionIn(wide, 1560, 450), null);
assert.equal(fractionIn(EMPTY_BOX, 10, 10), null);

console.log('stage-geometry self-check passed');
