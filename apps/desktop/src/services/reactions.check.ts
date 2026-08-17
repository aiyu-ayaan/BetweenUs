/** Run with `tsx src/services/reactions.check.ts`. Who reacted, as a sentence. */
import assert from 'node:assert/strict';
import { reactorNames, type Reactor } from './reactions';

const members: Reactor[] = [
  { userId: 'u1', username: 'ada', displayName: 'Ada Lovelace' },
  { userId: 'u2', username: 'bob', displayName: '' },
];

assert.equal(reactorNames([], members, 'me'), '');
assert.equal(reactorNames(['u1'], members, 'me'), 'Ada Lovelace');
// No display name falls back to the username rather than to nothing.
assert.equal(reactorNames(['u2'], members, 'me'), 'bob');
assert.equal(reactorNames(['u1', 'u2'], members, 'me'), 'Ada Lovelace and bob');

// "You" is always first, wherever the server put it in the list.
assert.equal(reactorNames(['u1', 'me'], members, 'me'), 'You and Ada Lovelace');
assert.equal(reactorNames(['u1', 'me', 'u2'], members, 'me'), 'You, Ada Lovelace and bob');

// A member who has left, and a direct message, where there is no member list at
// all: counted rather than named.
assert.equal(reactorNames(['gone'], members, 'me'), '1 other');
assert.equal(reactorNames(['gone', 'also-gone'], [], undefined), '2 others');
assert.equal(reactorNames(['u1', 'gone'], members, 'me'), 'Ada Lovelace and 1 other');
assert.equal(reactorNames(['me', 'gone'], members, 'me'), 'You and 1 other');

console.log('reactions.check.ts ok');
