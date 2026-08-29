/**
 * What a disappearing window means, in the two places it is decided.
 *
 * Both are arithmetic that is invisible until it is wrong, and both fail in
 * the same expensive direction: an inverted comparison in the sweep destroys
 * every message the moment it is sent, and an accepted off-list window lets a
 * hand-edited row set a three-second retention nobody's client can undo.
 */
import assert from 'node:assert/strict';
import { DISAPPEARING_WINDOWS, disappearingWindowLabel, isDisappearingWindow } from '@betweenus/shared-types';
import { expiredWhere } from './disappearing-sweeper';

const now = new Date('2026-08-29T12:00:00.000Z');

// The sweep takes what is already past its stamp, and nothing that is not.
const where = expiredWhere(now);
assert.deepEqual(where, { expiresAt: { lte: now } });
assert.ok(where.expiresAt.lte <= now, 'the cutoff is now: a message stamped for tomorrow survives');

// Null never matches `lte`, so a message with no window is never collected -
// which is the whole of "off" and is worth stating rather than assuming.
assert.equal(Object.keys(where).length, 1, 'nothing else narrows the sweep');

// Only the published windows are settable. `null` is off and is always allowed.
assert.ok(isDisappearingWindow(null));
assert.ok(isDisappearingWindow(undefined));
for (const seconds of DISAPPEARING_WINDOWS) assert.ok(isDisappearingWindow(seconds));
assert.ok(!isDisappearingWindow(3), 'a three-second window is not on the list');
assert.ok(!isDisappearingWindow(86_401), 'nearly a day is not a day');
assert.ok(!isDisappearingWindow(-86_400), 'a window cannot run backwards');

// The list is ordered shortest to longest: every picker renders it in order.
const ordered = [...DISAPPEARING_WINDOWS].sort((left, right) => left - right);
assert.deepEqual([...DISAPPEARING_WINDOWS], ordered);

// One spelling per window, so three clients cannot disagree about what "8h" is.
assert.equal(disappearingWindowLabel(null), 'Off');
assert.equal(disappearingWindowLabel(86_400), '24 hours');
assert.equal(disappearingWindowLabel(604_800), '7 days');

console.log('disappearing: ok');
