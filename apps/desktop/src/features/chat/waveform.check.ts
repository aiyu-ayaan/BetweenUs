/**
 * Whether a voice message's bars actually fit in the space they are drawn in.
 *
 * This is the check the original bug needed and did not have. Forty-eight bars
 * went into a couple of hundred pixels, the gaps between them ate most of the
 * width, and every bar came out about a pixel across - rendered, correct by
 * every type in the codebase, and invisible on screen. Nothing but arithmetic
 * would have caught it.
 *
 * So the arithmetic is asserted here, at both widths the player is laid out
 * at. Changing the bar count, the gap, or the size of the avatar and the play
 * button without checking the budget fails this rather than shipping a blank
 * strip.
 */
import assert from 'node:assert/strict';
import { VOICE_WAVEFORM_BARS } from '@betweenus/shared-types';
import { WAVE_LAYOUT, barWidthPx } from './waveform';

const bars = Array.from({ length: VOICE_WAVEFORM_BARS }, () => 0.5);

// --- The desktop width -----------------------------------------------------

const wide = WAVE_LAYOUT.minPlayerPx - WAVE_LAYOUT.fixedPx;
const wideBar = barWidthPx(bars.length, wide);
assert.ok(
  wideBar >= WAVE_LAYOUT.minBarPx,
  `a bar is ${wideBar.toFixed(2)}px at the narrowest desktop layout; ` +
    `below ${WAVE_LAYOUT.minBarPx}px it reads as nothing`,
);

// --- The phone width -------------------------------------------------------

const narrow = WAVE_LAYOUT.mobilePlayerPx - WAVE_LAYOUT.fixedPx;
const narrowBar = barWidthPx(bars.length, narrow);
assert.ok(
  narrowBar >= WAVE_LAYOUT.minBarPx,
  `a bar is ${narrowBar.toFixed(2)}px on a phone; below ${WAVE_LAYOUT.minBarPx}px it reads as nothing`,
);

// --- What actually bought the room -----------------------------------------
//
// The gap, not the bar count. Forty-seven gaps at the old two pixels is
// ninety-four pixels of a bubble a few hundred wide - more than half the
// waveform spent on the spaces between it. Stated as an assertion because the
// first attempt at a fix was to halve the bar count, and the arithmetic says
// that was never the problem.
const atOldGap = (narrow - (bars.length - 1) * 2) / bars.length;
assert.ok(atOldGap < WAVE_LAYOUT.minBarPx, 'the old two-pixel gap was survivable after all');
assert.ok(narrowBar > atOldGap, 'a smaller gap is what widens the bars');

// --- The formula itself ----------------------------------------------------

// Gaps are between bars, not around them: n bars have n-1 gaps.
assert.equal(barWidthPx(1, 100), 100, 'one bar has no gap to pay for');
assert.equal(barWidthPx(2, 101), 50, 'two bars share one gap');
assert.equal(barWidthPx(0, 100), 0, 'no bars, no width');

console.log('waveform: ok');
