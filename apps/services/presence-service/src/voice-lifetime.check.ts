/** Run with `tsx src/voice-lifetime.check.ts`. */
import assert from 'node:assert/strict';
import { voiceLifetime } from './voice-lifetime';

// Redis: -2 is "no such key", -1 is "no expiry set". Swapping the two would
// empty every call that is actually running.
assert.equal(voiceLifetime(-2), 'gone');
assert.equal(voiceLifetime(-1), 'adopt');

// Anything counting down is a roster something is still behind.
assert.equal(voiceLifetime(90_000), 'live');
assert.equal(voiceLifetime(1), 'live');
// Zero comes back for a key in the millisecond before it goes; the next sweep
// reads -2 and clears it, which is soon enough and never early.
assert.equal(voiceLifetime(0), 'live');

console.log('voice-lifetime.check.ts ok');
