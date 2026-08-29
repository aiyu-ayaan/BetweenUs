/**
 * Who may fetch the bytes of a one-time message.
 *
 * This is the rule the whole feature rests on. Everything the clients do - a
 * card that locks, a viewer that refuses to open twice - is software choosing
 * to behave, and a one-time message whose only guarantee is that the
 * recipient's client felt like keeping it is not a guarantee. The bytes come
 * through one door, and this is the check on it.
 *
 * Worth asserting rather than reading, because both refusals look redundant
 * until you ask what happens without them: without the author check a sender
 * re-opens their own message on a second device for ever, and without the
 * count check anybody replays the URL.
 */
import assert from 'node:assert/strict';
import { oneTimeLookLeft } from './uploads.controller';

const author = 'author';
const ada = 'ada';

// A recipient who has not looked has a look. This is the fetch that spends it,
// and it has to succeed - the view is recorded after the bytes are handed
// over, not before, or nobody could ever open one.
assert.equal(oneTimeLookLeft(ada, author, 0), true);

// And never again, however the second request is made: a rebuilt client, a
// replayed URL, a second device signed in to the same account.
assert.equal(oneTimeLookLeft(ada, author, 1), false);
assert.equal(oneTimeLookLeft(ada, author, 5), false);

// The author may not read it back, and not on the first attempt either. They
// sent it; it was never theirs to re-open. This is also the one case a client
// cannot enforce on its own, because the author is the account that had the
// plaintext to begin with.
assert.equal(oneTimeLookLeft(author, author, 0), false);
assert.equal(oneTimeLookLeft(author, author, 1), false);

// The author check is not a special case of the view count. An author who has
// never "viewed" their own message still has no look, which is the assertion
// that stops the first branch being deleted as redundant.
assert.equal(
  oneTimeLookLeft(author, author, 0),
  false,
  'an author with no view row is still refused',
);

console.log('one-time-read: ok');
