/**
 * When a one-time message has no looks left in it.
 *
 * This is the policy the reported bug was about: a single `viewedAt` meant the
 * first person to open one in a channel destroyed it, and everybody else was
 * shown "Opened" for something they had never been given. One look each is two
 * lists and a subtraction, and it is worth asserting because getting it wrong
 * in either direction is invisible - too eager destroys somebody's message
 * unread, too lax keeps ciphertext for ever.
 */
import assert from 'node:assert/strict';
import { looksOwed } from './messages.service';

const author = 'author';
const ada = 'ada';
const grace = 'grace';

// --- A direct message: two people, one of them the author ------------------

// Before the recipient looks, their look is owed - so the message survives.
assert.deepEqual(looksOwed([author, ada], [], author), [ada]);
// Once they have, nothing is owed and the message goes. This is the case that
// always worked, and it has to keep working.
assert.deepEqual(looksOwed([author, ada], [ada], author), []);

// --- A channel: the bug --------------------------------------------------

const room = [author, ada, grace];
// One person opening theirs leaves the other's look outstanding. Under the old
// single-stamp rule this was already "destroyed", which is the bug.
assert.deepEqual(looksOwed(room, [ada], author), [grace]);
assert.deepEqual(looksOwed(room, [grace], author), [ada]);
// Only when both have looked is it spent.
assert.deepEqual(looksOwed(room, [ada, grace], author), []);

// --- The author is not a viewer --------------------------------------------

// Re-reading your own spends nothing, so an author's "look" never counts
// towards the total and never appears as owed.
assert.deepEqual(looksOwed(room, [author], author), [ada, grace]);
assert.deepEqual(looksOwed([author], [], author), [], 'an author alone owes nothing');

// --- Odd shapes ------------------------------------------------------------

// A channel emptied since the message was sent: holding ciphertext for a
// recipient who no longer exists helps nobody.
assert.deepEqual(looksOwed([], [], author), []);
// Somebody who has left is not owed a look even though they used to be here.
assert.deepEqual(looksOwed([author, ada], [], author), [ada]);
// A look recorded for somebody no longer in the audience does not satisfy
// anybody else's - it is simply ignored.
assert.deepEqual(looksOwed([author, grace], [ada], author), [grace]);
// Two looks from the same person, which the unique index prevents but the
// arithmetic must survive anyway.
assert.deepEqual(looksOwed(room, [ada, ada], author), [grace]);

console.log('one-time: ok');
