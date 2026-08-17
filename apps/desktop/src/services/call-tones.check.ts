/**
 * Run with `tsx src/services/call-tones.check.ts`.
 *
 * Only the roster arithmetic is checked: the synthesis needs an AudioContext
 * and the only assertion worth making about it is whether it sounds right,
 * which no test makes. What can be wrong here silently is the set difference -
 * a roster arrives as a whole list, so "somebody joined" is not an event.
 */
import assert from 'node:assert/strict';
import { rosterChange } from './call-tones';

// Nothing happened.
assert.deepEqual(rosterChange(['a'], ['a']), { joined: false, left: false });

// One each way.
assert.deepEqual(rosterChange(['a'], ['a', 'b']), { joined: true, left: false });
assert.deepEqual(rosterChange(['a', 'b'], ['a']), { joined: false, left: true });

// Four people arriving at once is an arrival, not four of them.
assert.deepEqual(rosterChange([], ['a', 'b', 'c', 'd']), { joined: true, left: false });

// One in, one out, in the same roster: both are true, and both are worth
// hearing - the alternative is a swap that sounds like nothing changed.
assert.deepEqual(rosterChange(['a'], ['b']), { joined: true, left: true });

// Order is not a change. A roster is a set; the server does not promise one.
assert.deepEqual(rosterChange(['a', 'b'], ['b', 'a']), { joined: false, left: false });

console.log('call-tones.check.ts ok');
