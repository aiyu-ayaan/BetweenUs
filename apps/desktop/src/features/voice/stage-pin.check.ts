/**
 * Self-check for how long a stage pin lives - see stage-pin.ts.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import {
  STAGE_PIN_KEY,
  endStagePin,
  pinFor,
  readStagePin,
  resolveStagePin,
  watchStagePin,
  writeStagePin,
  type PinStorage,
} from './stage-pin';

/** A `sessionStorage` stand-in, so this runs under node. */
function memoryStorage(): PinStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const tile = (key: string, userId: string | null, isLocal = false) => ({ key, userId, isLocal });

// Saved for a channel, read back for that channel after a "reload".
const storage = memoryStorage();
const bob = pinFor('call-1', tile('peer-b', 'user-b'));
writeStagePin(storage, bob);
assert.deepEqual(readStagePin(storage, 'call-1'), bob);

// Never restored into a different call.
assert.equal(readStagePin(storage, 'call-2'), null);

// Unpinning, or pressing Leave, removes it.
writeStagePin(storage, null);
assert.equal(storage.data.has(STAGE_PIN_KEY), false);
assert.equal(readStagePin(storage, 'call-1'), null);

// Garbage and a storage that throws are no pin, not an exception.
storage.data.set(STAGE_PIN_KEY, '{not json');
assert.equal(readStagePin(storage, 'call-1'), null);
storage.data.set(STAGE_PIN_KEY, JSON.stringify({ channelId: 'call-1', key: 7 }));
assert.equal(readStagePin(storage, 'call-1'), null);
const throwing: PinStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};
assert.equal(readStagePin(throwing, 'call-1'), null);
assert.doesNotThrow(() => writeStagePin(throwing, bob));
assert.doesNotThrow(() => writeStagePin(throwing, null));
assert.equal(readStagePin(null, 'call-1'), null);

// Resolved by key; after a reconnect gave them a new peer id, by user id.
const stage = [tile('local', 'me', true), tile('peer-a', 'user-a'), tile('peer-b', 'user-b')];
assert.equal(resolveStagePin(bob, stage, 'call-1'), 'peer-b');
const rejoined = [tile('local', 'me', true), tile('peer-b2', 'user-b')];
assert.equal(resolveStagePin(bob, rejoined, 'call-1'), 'peer-b2');
// Yourself resolves to the local tile, and never to your own presence entry.
const self = pinFor('call-1', tile('local', 'me', true));
assert.equal(resolveStagePin(self, stage, 'call-1'), 'local');
assert.equal(resolveStagePin(self, [tile('me', 'me')], 'call-1'), null);
// Nobody by that key or that user: no hero.
assert.equal(resolveStagePin(bob, [tile('peer-a', 'user-a')], 'call-1'), null);
assert.equal(resolveStagePin(null, stage, 'call-1'), null);

// Straight after a rejoin the stage is still filling: the pin waits for them.
let watch = watchStagePin({ pin: bob, seen: false }, false, true, 'call-1');
assert.deepEqual(watch, { pin: bob, seen: false });
// They arrive, and the pin takes hold.
watch = watchStagePin(watch, true, true, 'call-1');
assert.deepEqual(watch, { pin: bob, seen: true });
// They leave while this window watches: the pin goes.
watch = watchStagePin(watch, false, true, 'call-1');
assert.deepEqual(watch, { pin: null, seen: false });

// A dropped connection is not them leaving - `seen` resets, the pin stays.
const dropped = watchStagePin({ pin: bob, seen: true }, false, false, 'call-1');
assert.deepEqual(dropped, { pin: bob, seen: false });

// The call ending - its roster going from somebody to nobody - clears it.
const ending = memoryStorage();
writeStagePin(ending, bob);
// Leaving while others stay is not the end: the pin waits for the rejoin.
endStagePin(ending, 'call-1', ['me', 'user-b'], ['user-b']);
assert.deepEqual(readStagePin(ending, 'call-1'), bob);
// Another channel emptying is not this call.
endStagePin(ending, 'call-2', ['x'], []);
assert.deepEqual(readStagePin(ending, 'call-1'), bob);
// A roster first heard empty says nothing either.
endStagePin(ending, 'call-1', [], []);
assert.deepEqual(readStagePin(ending, 'call-1'), bob);
endStagePin(ending, 'call-1', ['user-b'], []);
assert.equal(readStagePin(ending, 'call-1'), null);

// Somebody with the same user id leaving a *different* call touches nothing:
// the pin is for call-1, and neither resolving nor watching reads call-2.
assert.equal(resolveStagePin(bob, [tile('peer-b', 'user-b')], 'call-2'), null);
const other = watchStagePin({ pin: bob, seen: true }, false, true, 'call-2');
assert.deepEqual(other, { pin: bob, seen: true });
const otherIdle = watchStagePin({ pin: bob, seen: true }, false, false, 'call-2');
assert.deepEqual(otherIdle, { pin: bob, seen: true });

console.log('stage-pin self-check passed');
