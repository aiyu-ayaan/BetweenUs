/**
 * Self-check for the automatic idle status: `tsx src/services/idle.check.ts`.
 *
 * The decision is four lines and every way of getting it wrong is silent - a
 * status that never comes back, or one that overwrites what somebody chose - so
 * the cases are here rather than being noticed by a person wondering why their
 * dot is the wrong colour.
 */
import assert from 'node:assert/strict';
import { autoStatus, IDLE_AFTER_SECONDS } from './idle';

const T = IDLE_AFTER_SECONDS;

// Online is the one status that moves on its own.
assert.equal(autoStatus('online', 0, false), 'online');
assert.equal(autoStatus('online', T - 1, false), 'online');
assert.equal(autoStatus('online', T, false), 'idle');
assert.equal(autoStatus('online', T * 10, false), 'idle');

// ...and it comes back. A watcher that only ever goes one way is the classic
// version of this bug.
assert.equal(autoStatus('online', 0, false), 'online');

// A chosen status is never touched, in either direction: do-not-disturb does
// not decay into idle, and an idle somebody picked deliberately is not
// "corrected" back to online the moment they move the mouse.
for (const seconds of [0, T, T * 10]) {
  assert.equal(autoStatus('dnd', seconds, false), 'dnd');
  assert.equal(autoStatus('invisible', seconds, false), 'invisible');
  assert.equal(autoStatus('idle', seconds, false), 'idle');
}

// A call is presence. Twenty minutes of listening to somebody talk without
// touching the keyboard is not being away.
assert.equal(autoStatus('online', T * 10, true), 'online');
// And it does not resurrect a chosen status either.
assert.equal(autoStatus('dnd', T * 10, true), 'dnd');

// The threshold is a parameter, so a shorter one behaves the same way.
assert.equal(autoStatus('online', 30, false, 60), 'online');
assert.equal(autoStatus('online', 60, false, 60), 'idle');

console.log('idle check ok');
