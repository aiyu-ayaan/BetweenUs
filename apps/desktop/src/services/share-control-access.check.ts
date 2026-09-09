import assert from 'node:assert/strict';
import { shareControlRefusal, type ShareControlContext } from './share-control-access';

const desktop: ShareControlContext = {
  sharing: true,
  onDesktop: true,
  platform: 'win32',
  wholeDisplay: true,
};

// --- the one case that says yes ---------------------------------------------

assert.equal(shareControlRefusal(desktop), null);

// --- nothing to control -----------------------------------------------------

assert.equal(
  shareControlRefusal({ ...desktop, sharing: false }),
  'they are not sharing a screen',
);

// A share that has stopped is answered as such whatever else is true: the ask
// and the answer are two moments, and the share can end between them.
assert.equal(
  shareControlRefusal({ sharing: false, onDesktop: false, wholeDisplay: false }),
  'they are not sharing a screen',
);

// --- the bug this ordering exists for ---------------------------------------

// A browser tab sharing its *entire screen*. The picker offered it, the share
// is a whole display, and it still cannot be driven - because a tab has no way
// to move its own machine's mouse. Saying "a window is being shared" here was
// the wrong answer to the wrong question, and it was the answer for every
// option in the picker.
const webWholeScreen: ShareControlContext = {
  sharing: true,
  onDesktop: false,
  wholeDisplay: true,
};
const web = shareControlRefusal(webWholeScreen);
assert.ok(web !== null);
assert.ok(!web.includes('a window is being shared'), 'must not blame the surface');
assert.ok(web.includes('browser'), 'must name the runtime');
assert.ok(web.includes('remote session'), 'must name the way through');

// A tab sharing a window gets the same sentence: the runtime settles it first,
// so the reason does not change with a choice that cannot matter.
assert.equal(shareControlRefusal({ ...webWholeScreen, wholeDisplay: false }), web);

// --- the two desktop refusals still stand -----------------------------------

assert.equal(
  shareControlRefusal({ ...desktop, platform: 'darwin' }),
  'control is not supported on that machine',
);

// The surface is the last question, and only where it can be acted on.
assert.equal(
  shareControlRefusal({ ...desktop, wholeDisplay: false }),
  'a window is being shared, not a whole screen',
);

// A desktop build with no bridge answer is not win32 by default.
assert.equal(
  shareControlRefusal({ sharing: true, onDesktop: true, wholeDisplay: true }),
  'control is not supported on that machine',
);

console.log('share-control-access.check.ts ok');
