/**
 * Self-check for the centre crop a stored picture is framed to.
 *
 * Run with `pnpm --filter @betweenus/desktop check`. Worth pinning because the
 * two cases that go wrong are the two nobody has to hand while writing it: a
 * portrait photograph cropped down to a 4:1 band, and a panorama cropped up to
 * a square. Both are arithmetic, so neither needs a browser to test.
 */
import assert from 'node:assert/strict';
import { COVER_ASPECT } from '@betweenus/shared-types';
import { cropBox } from './attachments';

// --- a square out of a landscape photograph ----------------------------------

const wideToSquare = cropBox(1600, 900, 1);
assert.equal(wideToSquare.width, 900, 'the short edge is what a square is limited by');
assert.equal(wideToSquare.height, 900);
assert.equal(wideToSquare.x, 350, 'and it is taken from the middle');
assert.equal(wideToSquare.y, 0, 'with nothing to trim vertically');

// --- a square out of a portrait photograph -----------------------------------

const tallToSquare = cropBox(900, 1600, 1);
assert.equal(tallToSquare.width, 900);
assert.equal(tallToSquare.height, 900);
assert.equal(tallToSquare.x, 0);
assert.equal(tallToSquare.y, 350);

// --- a cover band out of an ordinary photograph ------------------------------

// 4:3 is far taller than 4:1, so the full width is kept and the height is cut.
const band = cropBox(4000, 3000, COVER_ASPECT);
assert.equal(band.width, 4000, 'a photograph narrower than the band keeps its width');
assert.equal(band.height, 1000, 'and gives up height until it is the right shape');
assert.equal(band.x, 0);
assert.equal(band.y, 1000, 'taken from the middle, so a horizon stays near the centre');

// --- a cover band out of something already wider than the band ---------------

// 8:1 is flatter than 4:1, so this time width is what runs out.
const flat = cropBox(8000, 1000, COVER_ASPECT);
assert.equal(flat.height, 1000, 'a panorama keeps its full height');
assert.equal(flat.width, 4000);
assert.equal(flat.y, 0);
assert.equal(flat.x, 2000);

// --- the shape is always what was asked for ----------------------------------

// The property that actually matters, over a spread of shapes: whatever goes
// in, the box that comes out is the requested aspect and fits inside the
// source. A crop that escaped the source draws transparent pixels down one
// edge, which is the bug this whole function exists to not have.
for (const [width, height] of [
  [100, 100],
  [1920, 1080],
  [1080, 1920],
  [3000, 401],
  [17, 4001],
] as const) {
  for (const aspect of [1, COVER_ASPECT, 16 / 9]) {
    const box = cropBox(width, height, aspect);
    assert.ok(
      Math.abs(box.width / box.height - aspect) < 1e-9,
      `${width}x${height} at ${aspect}: the crop is the requested shape`,
    );
    assert.ok(box.x >= 0 && box.y >= 0, 'the crop starts inside the picture');
    assert.ok(
      box.x + box.width <= width + 1e-9 && box.y + box.height <= height + 1e-9,
      'and ends inside it',
    );
  }
}

console.log('picture-crop: ok');
