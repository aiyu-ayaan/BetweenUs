/**
 * Self-check for the camera effects seam.
 *
 * Run with `pnpm --filter @betweenus/desktop check`. The frame loop itself
 * needs a camera and a worker and is not testable here; what is testable is
 * every decision *around* it, and each of those has a failure that is
 * effectively impossible to reproduce on purpose: a pipeline built to do
 * nothing, an effect silently dropped on a browser that cannot run it, or a
 * call that flickers between filtered and unfiltered for its whole duration.
 */
import assert from 'node:assert/strict';
import {
  FILTERS,
  FRAME_BUDGET_MS,
  FrameBudget,
  NO_EFFECT,
  effectFor,
  effectsSupported,
  isPassThrough,
} from './camera-effects';

// --- Doing nothing must cost nothing ----------------------------------------

// The guarded bug is a full canvas round trip per frame, at 1080p30, to produce
// a picture identical to the one that went in.
assert.equal(isPassThrough(NO_EFFECT), true);
assert.equal(isPassThrough({ filter: null, blurBackground: 0 }), true);

// Both of these arrive from a real interface where "off" was picked, and
// neither is a filter. `'none'` is a valid CSS filter meaning no filtering.
assert.equal(isPassThrough({ filter: '', blurBackground: 0 }), true);
assert.equal(isPassThrough({ filter: 'none', blurBackground: 0 }), true);
assert.equal(isPassThrough({ filter: '   ', blurBackground: 0 }), true);

// Anything real is not a pass-through.
assert.equal(isPassThrough({ filter: 'grayscale(1)', blurBackground: 0 }), false);
// Blur alone, with no colour filter, still needs the pipeline - this is the
// assertion that keeps portrait mode working when it is added.
assert.equal(isPassThrough({ filter: null, blurBackground: 8 }), false);

// --- The filter catalogue ---------------------------------------------------

// `none` has to be a genuine pass-through, or picking "no filter" builds a
// pipeline to apply nothing.
assert.equal(isPassThrough(FILTERS.none as never), true);

// Every other filter has to actually be one, or it is an entry in a menu that
// does nothing when chosen.
for (const [name, effect] of Object.entries(FILTERS)) {
  if (name === 'none') continue;
  assert.equal(isPassThrough(effect), false, `${name} must do something`);
}

// An unknown name is not a crash and not a half-applied effect: it is nothing.
// Filters are stored by name in local storage, so a profile written by a build
// that had a filter this one has since dropped is a real case.
assert.deepEqual(effectFor('a-filter-that-was-removed'), NO_EFFECT);
assert.deepEqual(effectFor(''), NO_EFFECT);
assert.equal(effectFor('mono'), FILTERS.mono);

// --- The capability gate ----------------------------------------------------

// Both halves are required. Probing for one and using the other is how this
// breaks on precisely the browsers nobody runs the app in.
assert.equal(effectsSupported({}), false);
assert.equal(effectsSupported({ MediaStreamTrackProcessor: () => undefined }), false);
assert.equal(effectsSupported({ VideoTrackGenerator: () => undefined }), false);
assert.equal(
  effectsSupported({
    MediaStreamTrackProcessor: () => undefined,
    VideoTrackGenerator: () => undefined,
  }),
  true,
);
// The older name for the writing half is honoured too.
assert.equal(
  effectsSupported({
    MediaStreamTrackProcessor: () => undefined,
    MediaStreamTrackGenerator: () => undefined,
  }),
  true,
);
// A property that exists but is not callable is not support.
assert.equal(
  effectsSupported({ MediaStreamTrackProcessor: true, VideoTrackGenerator: true }),
  false,
);

// --- The budget guard -------------------------------------------------------

const slow = FRAME_BUDGET_MS + 10;
const fast = 1;

// One slow frame is a scheduling hiccup, not a verdict. Turning an effect off
// because a window was dragged is the behaviour being prevented.
{
  const budget = new FrameBudget();
  assert.equal(budget.record(slow), false);
  assert.equal(budget.bypassed, false);
}

// A sustained run does end it, and says so exactly once.
{
  const budget = new FrameBudget();
  let changes = 0;
  for (let i = 0; i < 100; i += 1) if (budget.record(slow)) changes += 1;
  assert.equal(budget.bypassed, true);
  assert.equal(changes, 1, 'the swap is announced once, not every frame after');
}

// A single fast frame resets the run: the condition is *sustained* slowness.
{
  const budget = new FrameBudget();
  for (let i = 0; i < 29; i += 1) budget.record(slow);
  budget.record(fast);
  for (let i = 0; i < 29; i += 1) budget.record(slow);
  assert.equal(budget.bypassed, false);
}

// Coming back requires comfortably under budget, sustained. Frames sitting
// exactly on the threshold must not bring it back, or a machine on the line
// toggles the effect for the whole call - which looks far worse than either
// state does on its own.
{
  const budget = new FrameBudget();
  for (let i = 0; i < 30; i += 1) budget.record(slow);
  assert.equal(budget.bypassed, true);

  for (let i = 0; i < 500; i += 1) budget.record(FRAME_BUDGET_MS);
  assert.equal(budget.bypassed, true, 'at the line is not recovery');

  let changes = 0;
  for (let i = 0; i < 90; i += 1) if (budget.record(fast)) changes += 1;
  assert.equal(budget.bypassed, false);
  assert.equal(changes, 1);
}

// And recovery is not instant: one fast frame after a bad run keeps the bypass.
{
  const budget = new FrameBudget();
  for (let i = 0; i < 30; i += 1) budget.record(slow);
  assert.equal(budget.record(fast), false);
  assert.equal(budget.bypassed, true);
}

console.log('camera-effects.check.ts: ok');
