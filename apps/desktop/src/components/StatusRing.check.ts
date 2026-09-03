/**
 * Self-check for the segmented ring's geometry.
 *
 * Worth asserting because it is arithmetic nobody reads back off the screen:
 * an off-by-one in the offsets draws a ring that is subtly wrong - segments
 * that overlap, or a gap that grows around the circle - and it looks like a
 * rendering quirk rather than a bug in a formula.
 */
import assert from 'node:assert/strict';
import { MAX_SEGMENTS, ringSegments } from './StatusRing';

const CIRCUMFERENCE = 2 * Math.PI * 47;

/** The drawn part of a dasharray. */
const arcOf = (dash: string): number => Number(dash.split(' ')[0]);

// One post is a whole circle with no notch in it: a lone arc with a gap reads
// as a rendering fault, not as a count of one.
const single = ringSegments(1);
assert.equal(single.length, 1);
assert.equal(arcOf(single[0]!.dash), CIRCUMFERENCE);
assert.equal(single[0]!.offset, 0);

// Four posts are four arcs, evenly spaced, starting at the top of each quarter.
const four = ringSegments(4);
assert.equal(four.length, 4);
const step = CIRCUMFERENCE / 4;
four.forEach((segment, index) => {
  assert.equal(segment.offset, -index * step);
  // Each arc is its share of the circle less one gap.
  assert.ok(Math.abs(arcOf(segment.dash) - (step - 5)) < 1e-9);
});

// Every arc plus every gap is exactly one circle - no drift, no overlap.
const total = four.reduce((sum, segment) => sum + arcOf(segment.dash) + 5, 0);
assert.ok(Math.abs(total - CIRCUMFERENCE) < 1e-9);

// Past the point where an arc would be shorter than the gap beside it, the
// count stops being drawn and the ring goes solid. It stopped being legible
// well before that, and arcs shorter than their gaps read as a dashed line.
const many = ringSegments(MAX_SEGMENTS + 1);
assert.equal(many.length, 1);
assert.equal(arcOf(many[0]!.dash), CIRCUMFERENCE);

// The last size that is still counted really is counted.
assert.equal(ringSegments(MAX_SEGMENTS).length, MAX_SEGMENTS);

// Nothing posted draws nothing, and the caller never asks - but a zero must
// not divide by itself into NaN if it ever does.
assert.equal(ringSegments(0).length, 1);

console.log('status ring check ok');
