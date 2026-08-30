/** Run with `tsx src/last-seen-visibility.check.ts`. Who may read whose last seen. */
import assert from 'node:assert/strict';
import type { LastSeenVisibility } from '@betweenus/shared-types';
import { maySeeLastSeen, readableLastSeen, toVisibility } from './last-seen-visibility';

/** A stranger who shares a server, asking about somebody with the given setting. */
const asks = (
  subject: LastSeenVisibility,
  asker: LastSeenVisibility = 'everyone',
  friends = false,
): boolean => maySeeLastSeen({ subject, asker, friends, self: false });

// --- the three tiers ---------------------------------------------------------

// "Everyone" is everyone who could already see the name; the audience check
// upstream is what makes that a smaller word than it looks.
assert.equal(asks('everyone'), true);
assert.equal(asks('everyone', 'everyone', true), true);

// "Friends" is an accepted friendship and nothing weaker. A server in common is
// not a friendship, which is the whole point of having the tier at all.
assert.equal(asks('friends', 'everyone', true), true);
assert.equal(asks('friends', 'everyone', false), false, 'a server-mate is not a friend');

assert.equal(asks('nobody'), false);
assert.equal(asks('nobody', 'everyone', true), false, 'nobody outranks a friendship');

// --- reciprocity -------------------------------------------------------------

// The rule that keeps the setting from being a one-way mirror: somebody who
// hides their own last seen does not get to read anybody else's, however
// generous that person has been.
assert.equal(asks('everyone', 'nobody'), false, 'a hider reads nobody');
assert.equal(asks('friends', 'nobody', true), false, 'not even a friend of theirs');
assert.equal(asks('nobody', 'nobody'), false);

// It is only `nobody` that disqualifies. Narrowing to friends is a limit on who
// reads you, not a forfeit of what you may read - which is also WhatsApp's rule.
assert.equal(asks('everyone', 'friends'), true, 'restricting to friends costs nothing');
assert.equal(asks('friends', 'friends', true), true);

// --- your own value is always yours ------------------------------------------

// Otherwise the settings page could not draw what the setting does, and an
// account set to `nobody` would be unable to see itself.
for (const setting of ['everyone', 'friends', 'nobody'] as LastSeenVisibility[]) {
  assert.equal(
    maySeeLastSeen({ subject: setting, asker: setting, friends: false, self: true }),
    true,
    `${setting}: your own last seen is yours to read`,
  );
}

// --- the batch answers the same way ------------------------------------------

const subjects = [
  { id: 'open', visibility: 'everyone' as LastSeenVisibility },
  { id: 'friendly', visibility: 'friends' as LastSeenVisibility },
  { id: 'closed', visibility: 'nobody' as LastSeenVisibility },
  { id: 'me', visibility: 'nobody' as LastSeenVisibility },
];

const seen = readableLastSeen('me', 'everyone', subjects, new Set(['friendly']));
assert.deepEqual([...seen].sort(), ['friendly', 'me', 'open']);

// The same batch asked by somebody who hides: nothing but themselves.
const hidden = readableLastSeen('me', 'nobody', subjects, new Set(['friendly']));
assert.deepEqual([...hidden], ['me'], 'a hider gets only their own back');

// An empty batch is an empty answer rather than a crash or a wildcard.
assert.equal(readableLastSeen('me', 'everyone', [], new Set()).size, 0);

// --- the column's spelling ---------------------------------------------------

assert.equal(toVisibility('EVERYONE'), 'everyone');
assert.equal(toVisibility('FRIENDS'), 'friends');
assert.equal(toVisibility('NOBODY'), 'nobody');

// A value this build does not know is read as the widest, which is what the
// column defaults to - a narrower guess would silently hide people who never
// asked to be hidden.
assert.equal(toVisibility(null), 'everyone');
assert.equal(toVisibility(undefined), 'everyone');
assert.equal(toVisibility('SOMETHING_NEWER'), 'everyone');

console.log('last-seen-visibility.check.ts ok');
