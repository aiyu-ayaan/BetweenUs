/**
 * Self-check for the crop-and-rotate geometry.
 *
 * Run with `pnpm --filter @betweenus/desktop check`. The property worth
 * guarding is that the frame is always covered: a scale or a clamp that is
 * wrong by a pixel is an avatar with a sliver of nothing down one side, and it
 * only shows on the pictures whose aspect ratio happens to hit it.
 */
import assert from 'node:assert/strict';
import {
  MAX_ZOOM,
  NO_EDIT,
  clampEdit,
  coverScale,
  cssTransform,
  isSideways,
  isUnedited,
  panRange,
  rotate,
  turned,
} from './image-edit';

const SQUARE = { width: 512, height: 512 };
const WIDE = { width: 4000, height: 3000 };
const TALL = { width: 1080, height: 1920 };
const FRAME = { width: 300, height: 300 };
const BANNER = { width: 320, height: 180 };

// Quarter turns wrap in both directions.
assert.equal(rotate(0, 1), 90);
assert.equal(rotate(270, 1), 0);
assert.equal(rotate(0, -1), 270);
assert.equal(rotate(180, 2), 0);

assert.equal(isSideways(90), true);
assert.equal(isSideways(270), true);
assert.equal(isSideways(0), false);
assert.deepEqual(turned(WIDE, 90), { width: 3000, height: 4000 });
assert.deepEqual(turned(WIDE, 180), { width: 4000, height: 3000 });

// Cover, never contain: at zoom 1 the picture is at least as big as the frame
// on both axes, for every picture, every frame and every turn.
for (const image of [SQUARE, WIDE, TALL, { width: 40, height: 900 }]) {
  for (const frame of [FRAME, BANNER, { width: 200, height: 400 }]) {
    for (const rotation of [0, 90, 180, 270] as const) {
      const scale = coverScale(image, frame, rotation);
      const shown = turned(image, rotation);
      assert.ok(shown.width * scale >= frame.width - 1e-9, 'covers width');
      assert.ok(shown.height * scale >= frame.height - 1e-9, 'covers height');
      // And it is the *smallest* such scale: one axis fits exactly.
      const slackX = shown.width * scale - frame.width;
      const slackY = shown.height * scale - frame.height;
      assert.ok(Math.min(slackX, slackY) < 1e-6, 'no scale to spare');
    }
  }
}

// A square picture in a square frame at zoom 1 has nowhere to go, so a drag
// does nothing rather than sliding the picture off its own frame.
assert.deepEqual(panRange(SQUARE, FRAME, NO_EDIT), { width: 0, height: 0 });
assert.deepEqual(clampEdit(SQUARE, FRAME, { ...NO_EDIT, offsetX: 90, offsetY: -90 }), NO_EDIT);

// A wide picture in a square frame slides sideways and not up.
const wideRange = panRange(WIDE, FRAME, NO_EDIT);
assert.ok(wideRange.width > 0);
assert.equal(wideRange.height, 0);

// Turned a quarter, the same picture slides up and not sideways.
const turnedRange = panRange(WIDE, FRAME, { ...NO_EDIT, rotation: 90 });
assert.equal(turnedRange.width, 0);
assert.ok(turnedRange.height > 0);

// Zoom is clamped at both ends: never below "covers the frame", never past the
// point where a photo is showing its own pixels.
assert.equal(clampEdit(SQUARE, FRAME, { ...NO_EDIT, zoom: 0.2 }).zoom, 1);
assert.equal(clampEdit(SQUARE, FRAME, { ...NO_EDIT, zoom: 99 }).zoom, MAX_ZOOM);

// Zooming in gives the picture somewhere to go, and the clamp keeps it there.
const zoomed = clampEdit(SQUARE, FRAME, { ...NO_EDIT, zoom: 2, offsetX: 10_000 });
assert.equal(zoomed.zoom, 2);
assert.ok(zoomed.offsetX > 0);
assert.equal(zoomed.offsetX, panRange(SQUARE, FRAME, zoomed).width);

// A degenerate picture must not produce NaN, which would silently blank a canvas.
assert.equal(coverScale({ width: 0, height: 0 }, FRAME, 0), 1);

// The preview's transform is the one the canvas replays, in that order.
assert.equal(
  cssTransform(SQUARE, FRAME, NO_EDIT),
  `translate(0px, 0px) scale(${300 / 512}) rotate(0deg)`,
);

assert.equal(isUnedited(NO_EDIT), true);
assert.equal(isUnedited({ ...NO_EDIT, rotation: 90 }), false);
assert.equal(isUnedited({ ...NO_EDIT, offsetX: 1 }), false);

console.log('image-edit.check.ts: ok');
