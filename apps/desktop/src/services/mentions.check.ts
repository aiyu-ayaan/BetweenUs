/**
 * Self-check for mention detection: `tsx src/services/mentions.check.ts`.
 *
 * The failure that matters is a prefix match - `@ann` firing for `@anna` - a
 * mentions-only channel then being noisier than the channel it was meant to
 * quieten, which is a bug nobody reports because it looks like the feature not
 * working rather than a rule being wrong.
 */
import assert from 'node:assert/strict';
import { mentionsMe, roleNamesFor } from './mentions';

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

// A role this account holds addresses it; one it does not hold does not. The
// names come from the member row's `roleIds` resolved against the server's
// roles, so a role that exists but is held by somebody else never arrives here.
const staffer = { username: 'ann', displayName: 'Ann Wexford', roles: ['designers', 'Core Team'] };
assert.equal(mentionsMe('@designers can we look at this', staffer), true);
assert.equal(mentionsMe('@DESIGNERS please', staffer), true);
// A role name with a space is matched as written, exactly as a display name is.
assert.equal(mentionsMe('@Core Team standup', staffer), true);
// The boundary rule holds for roles too: a longer name is a different role.
assert.equal(mentionsMe('@designerships', staffer), false);
// A role held by somebody else is not a mention of me.
assert.equal(mentionsMe('@designers ping', me), false);
// No roles at all is the ordinary case and must not match everything.
assert.equal(mentionsMe('@designers ping', { username: 'ann', roles: [] }), false);

// Nothing to read is not a mention: an undecryptable message and an empty one
// both arrive here.
assert.equal(mentionsMe(null, me), false);
assert.equal(mentionsMe('', me), false);

// An account with no display name still matches on its username, and an empty
// display name is not a name that matches everything.
assert.equal(mentionsMe('@ann hello', { username: 'ann' }), true);
assert.equal(mentionsMe('@ hello', { username: 'ann', displayName: '' }), false);

// `roleNamesFor` is the join that decides whose roles count. Only the roles on
// this account's own member row, and only ones the server still has.
const roster = [
  { userId: 'u1', roleIds: ['r1', 'r3'] },
  { userId: 'u2', roleIds: ['r2'] },
];
const serverRoles = [
  { id: 'r1', name: 'designers' },
  { id: 'r2', name: 'ops' },
  { id: 'r3', name: 'Core Team' },
];
assert.deepEqual(roleNamesFor(roster, serverRoles, 'u1'), ['designers', 'Core Team']);
assert.deepEqual(roleNamesFor(roster, serverRoles, 'u2'), ['ops']);
// Somebody not on the roster yet, and nobody at all: nothing, not everything.
assert.deepEqual(roleNamesFor(roster, serverRoles, 'u3'), []);
assert.deepEqual(roleNamesFor(roster, serverRoles, null), []);
// A role id the server no longer has is dropped rather than carried as a blank.
assert.deepEqual(roleNamesFor([{ userId: 'u1', roleIds: ['gone'] }], serverRoles, 'u1'), []);
// And it composes with the rule above it - this is the whole path, joined.
assert.equal(
  mentionsMe('@Core Team standup', {
    username: 'ann',
    roles: roleNamesFor(roster, serverRoles, 'u1'),
  }),
  true,
);

console.log('mentions check ok');
