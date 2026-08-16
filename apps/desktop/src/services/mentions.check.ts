/**
 * Self-check for mention detection: `tsx src/services/mentions.check.ts`.
 *
 * The failure that matters is a prefix match - `@ann` firing for `@anna` - a
 * mentions-only channel then being noisier than the channel it was meant to
 * quieten, which is a bug nobody reports because it looks like the feature not
 * working rather than a rule being wrong.
 */
import assert from 'node:assert/strict';
import { mentionsMe } from './mentions';

const me = { username: 'ann', displayName: 'Ann Wexford' };

// The plain cases.
assert.equal(mentionsMe('@ann can you look at this', me), true);
assert.equal(mentionsMe('hey @ann', me), true);
assert.equal(mentionsMe('(@ann)', me), true);
assert.equal(mentionsMe('@ann, when you have a minute', me), true);
assert.equal(mentionsMe('nothing to do with you', me), false);

// Case does not matter.
assert.equal(mentionsMe('@ANN look', me), true);
assert.equal(mentionsMe('@Ann Wexford please', me), true);

// A longer name that starts with mine is somebody else.
assert.equal(mentionsMe('@anna said no', me), false);
assert.equal(mentionsMe('@annie is here', me), false);

// The name without the @ is just a word.
assert.equal(mentionsMe('ann said no', me), false);

// An email address is not a mention, and neither is a run-together pair.
assert.equal(mentionsMe('write to bob@ann.example', me), false);

// Broadcasts address everybody, including me.
assert.equal(mentionsMe('@everyone standup in five', me), true);
assert.equal(mentionsMe('@here quick question', me), true);
assert.equal(mentionsMe('@everyones problem', me), false);

// Nothing to read is not a mention: an undecryptable message and an empty one
// both arrive here.
assert.equal(mentionsMe(null, me), false);
assert.equal(mentionsMe('', me), false);

// An account with no display name still matches on its username, and an empty
// display name is not a name that matches everything.
assert.equal(mentionsMe('@ann hello', { username: 'ann' }), true);
assert.equal(mentionsMe('@ hello', { username: 'ann', displayName: '' }), false);

console.log('mentions check ok');
