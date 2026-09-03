import assert from 'node:assert/strict';
import { ChatView, GROUP_WITHIN_MS, groupsWith } from './ChatView';
import type { DecryptedMessage } from '../../stores/chat';

assert.equal(typeof ChatView, 'function', 'ChatView should be a function component');

// --- when one message continues another's run --------------------------------
//
// Grouping decides whether a message draws a name and a face of its own, so
// getting it wrong is not cosmetic: a message wrongly grouped is a message from
// nobody, and one wrongly split is somebody's name repeated down the screen.

const base = new Date('2026-09-03T18:04:00.000Z').getTime();

function message(over: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return {
    id: 'm1',
    channelId: 'c1',
    kind: 'USER',
    content: 'hi',
    author: { id: 'u1', username: 'mobile', displayName: 'mobile', avatarUrl: null },
    createdAt: new Date(base).toISOString(),
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    pinnedAt: null,
    reactions: [],
    expiresAt: null,
    viewOnce: false,
    viewedBy: [],
    attachments: [],
    ...over,
  } as DecryptedMessage;
}

const at = (ms: number, over: Partial<DecryptedMessage> = {}): DecryptedMessage =>
  message({ createdAt: new Date(base + ms).toISOString(), ...over });

// The ordinary run: same person, moments apart.
assert.equal(groupsWith(at(0), at(1000)), true);
assert.equal(groupsWith(undefined, at(0)), false, 'the first message starts a run');

// --- the bug this was extracted for ------------------------------------------
//
// An arrival line sits in the same list as the bubbles and carries the arriving
// person as its author. "mobile is here." followed by mobile's own "Hi" matched
// on author id, grouped, and drew neither a name nor a picture - a message from
// nobody, directly under a line naming them.
const arrival = at(0, { kind: 'MEMBER_JOIN', content: '' });
assert.equal(
  groupsWith(arrival, at(1000)),
  false,
  'a message never continues the arrival line above it',
);
// And the reverse, for completeness: an arrival is a line of its own whatever
// came before it.
assert.equal(groupsWith(at(0), at(1000, { kind: 'MEMBER_JOIN', content: '' })), false);

// --- the things that always break a run --------------------------------------

assert.equal(
  groupsWith(at(0), at(1000, { author: { ...message().author, id: 'u2' } })),
  false,
  'two people are two runs',
);
assert.equal(groupsWith(at(0), at(GROUP_WITHIN_MS + 1)), false, 'a long gap is two runs');
assert.equal(groupsWith(at(0), at(GROUP_WITHIN_MS - 1)), true, 'and a short one is not');

// A day boundary always breaks it: a divider sits between the two bubbles, and a
// run reading across it visibly is not one. Two minutes apart, either side of
// midnight - so this fails if the rule is only the time gap.
//
// Built in local time rather than written as UTC instants, because `sameDay`
// compares local dates - which is right, since the divider follows the reader's
// clock and not the server's. A pair of UTC strings straddling 00:00Z is the
// same local day everywhere east of Greenwich, and the assertion passed or
// failed depending on who ran it.
const before = message({ createdAt: new Date(2026, 8, 3, 23, 59).toISOString() });
const after = message({ createdAt: new Date(2026, 8, 4, 0, 1).toISOString() });
assert.equal(groupsWith(before, after), false, 'midnight breaks a run a gap would not');

// --- webhooks ----------------------------------------------------------------
//
// A webhook posts as the account that opened it, so two different robots - and a
// robot and the person who set it up - all share an author id.

const hook = (id: string, ms: number): DecryptedMessage =>
  at(ms, { kind: 'WEBHOOK', webhook: { id, name: 'Deploys', avatarUrl: null } });

assert.equal(groupsWith(hook('w1', 0), hook('w1', 1000)), true, 'one webhook is one run');
assert.equal(groupsWith(hook('w1', 0), hook('w2', 1000)), false, 'two webhooks are two runs');
assert.equal(
  groupsWith(hook('w1', 0), at(1000)),
  false,
  'a person does not continue their own robot',
);
assert.equal(
  groupsWith(at(0), hook('w1', 1000)),
  false,
  'nor the robot the person, which drew one name over both',
);

console.log('ChatView.check.ts ok');
