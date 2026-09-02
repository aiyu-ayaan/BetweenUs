import assert from 'node:assert/strict';
import { listState } from './list-state';

// --- the three answers -------------------------------------------------------

assert.equal(listState(0, true), 'loading', 'nothing yet, and something is coming');
assert.equal(listState(0, false), 'empty', 'nothing, and nothing coming: say so');
assert.equal(listState(3, false), 'ready');

// --- rows beat loading -------------------------------------------------------

// The rule the ad-hoc versions kept getting wrong in the other direction:
// a list that already has rows and is revalidating keeps drawing the rows.
// Blanking a list somebody is reading, on every refresh, is worse than a few
// seconds of slightly stale content.
assert.equal(listState(3, true), 'ready', 'a refreshing list still draws what it has');
assert.equal(listState(1, true), 'ready');

// --- never both, never neither ----------------------------------------------

// The failure this exists to stop is an empty state shown *during* a fetch -
// "No friends yet. Add someone by their username." to an account with forty
// friends. Whatever else changes, that pair must never come out together.
for (const count of [0, 1, 50]) {
  for (const loading of [true, false]) {
    const state = listState(count, loading);
    assert.ok(
      state === 'loading' || state === 'empty' || state === 'ready',
      `${count}/${loading} is one of the three`,
    );
    assert.ok(
      !(state === 'empty' && loading),
      `${count} rows with a fetch in flight never reads as empty`,
    );
    assert.ok(
      !(state !== 'ready' && count > 0),
      `${count} rows are always drawn`,
    );
  }
}

console.log('list-state.check.ts ok');
