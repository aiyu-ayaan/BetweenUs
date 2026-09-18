/** Run with `tsx src/features/chat/MentionSuggest.check.ts`. */
import assert from 'node:assert/strict';
import { filterMentionOptions, MentionSuggest } from './MentionSuggest';
import type { ServerMember } from '@betweenus/shared-types';

assert.equal(typeof MentionSuggest, 'function', 'MentionSuggest should be a function component');

const createMember = (
  id: string,
  username: string,
  displayName: string,
  avatarUrl: string | null = null,
): ServerMember => ({
  id,
  userId: `u_${id}`,
  username,
  displayName,
  avatarUrl,
  role: 'MEMBER',
  permissions: [],
  grantedPermissions: [],
  deniedPermissions: [],
  roleIds: [],
  colour: null,
  about: '',
  coverUrl: null,
  joinedAt: '2026-01-01T00:00:00.000Z',
});

const mockMembers: ServerMember[] = [
  createMember('1', 'alice', 'Alice Cooper'),
  createMember('2', 'bob', 'Bob Builder'),
];

// 1. Empty term in non-direct channel returns broadcasts and all members
const initial = filterMentionOptions('', mockMembers, false);
assert.equal(initial.length, 4, 'Empty query in server channel should return 2 broadcasts + 2 members');
assert.equal(initial[0]?.username, 'everyone');
assert.equal(initial[0]?.kind, 'broadcast');
assert.equal(initial[1]?.username, 'here');
assert.equal(initial[1]?.kind, 'broadcast');
assert.equal(initial[2]?.username, 'alice');
assert.equal(initial[2]?.kind, 'member');
assert.equal(initial[3]?.username, 'bob');
assert.equal(initial[3]?.kind, 'member');

// 2. Query matching member username
const filteredUser = filterMentionOptions('ali', mockMembers, false);
assert.equal(filteredUser.length, 1);
assert.equal(filteredUser[0]?.username, 'alice');
assert.equal(filteredUser[0]?.name, 'Alice Cooper');
assert.equal(filteredUser[0]?.subtitle, '@alice');

// Case insensitivity
const upperFiltered = filterMentionOptions('ALICE', mockMembers, false);
assert.equal(upperFiltered.length, 1);
assert.equal(upperFiltered[0]?.username, 'alice');

// Query with leading @
const atFiltered = filterMentionOptions('@ali', mockMembers, false);
assert.equal(atFiltered.length, 1);
assert.equal(atFiltered[0]?.username, 'alice');

// 3. Direct channel suppresses broadcasts
const direct = filterMentionOptions('', mockMembers, true);
assert.equal(direct.length, 2);
assert.ok(!direct.some((m) => m.kind === 'broadcast'), 'Direct channel must suppress broadcasts');
assert.equal(direct[0]?.username, 'alice');
assert.equal(direct[1]?.username, 'bob');

// Broadcast query in direct channel should still be empty
const directBroadcast = filterMentionOptions('everyone', mockMembers, true);
assert.equal(directBroadcast.length, 0, 'Broadcasts should never match in direct channels');

// 4. Ranking (exact > prefix > substring)
const rankingMembers: ServerMember[] = [
  createMember('1', 'superdan', 'Super Dan'),       // substring match on username & displayName
  createMember('2', 'dan', 'Dan The Man'),          // exact match on username
  createMember('3', 'daniel', 'Daniel Fast'),       // prefix match on username
  createMember('4', 'dante', 'Dante Alighieri'),    // prefix match on username (alphabetically after Daniel)
  createMember('5', 'jordan', 'Jordan Sparks'),     // substring match on username
];

const ranked = filterMentionOptions('dan', rankingMembers, true);
// Expect order:
// 1. 'dan' (exact match)
// 2. 'daniel' (prefix match, Daniel Fast before Dante Alighieri)
// 3. 'dante' (prefix match)
// 4. 'jordan' (substring match, Jordan Sparks before Super Dan)
// 5. 'superdan' (substring match)
assert.equal(ranked[0]?.username, 'dan', 'Exact match should be ranked first');
assert.equal(ranked[1]?.username, 'daniel', 'Prefix match Daniel should precede Dante');
assert.equal(ranked[2]?.username, 'dante', 'Prefix match Dante should precede substring matches');
assert.equal(ranked[3]?.username, 'jordan', 'Substring match Jordan should precede Super Dan');
assert.equal(ranked[4]?.username, 'superdan', 'Substring match Super Dan should be last');

// Exact match on displayName
const exactDisplayMembers: ServerMember[] = [
  createMember('1', 'user1', 'Dan'),
  createMember('2', 'dan2', 'Other Dan'),
];
const displayRanked = filterMentionOptions('dan', exactDisplayMembers, true);
assert.equal(displayRanked[0]?.username, 'user1', 'Exact match on displayName should be rank 0');

// 5. Broadcast filtering
const broadcastOnly = filterMentionOptions('every', mockMembers, false);
assert.equal(broadcastOnly.length, 1);
assert.equal(broadcastOnly[0]?.username, 'everyone');

const hereOnly = filterMentionOptions('here', mockMembers, false);
assert.equal(hereOnly.length, 1);
assert.equal(hereOnly[0]?.username, 'here');

// 6. Capped at 10 items
const manyMembers: ServerMember[] = Array.from({ length: 15 }, (_, i) =>
  createMember(`${i + 10}`, `user_${String(i).padStart(2, '0')}`, `User ${String(i).padStart(2, '0')}`),
);
const capped = filterMentionOptions('', manyMembers, false);
assert.equal(capped.length, 10, 'Results must be capped at 10 suggestions');
// In non-direct channel: 2 broadcasts + 8 members
assert.equal(capped[0]?.username, 'everyone');
assert.equal(capped[1]?.username, 'here');
assert.equal(capped[2]?.username, 'user_00');
assert.equal(capped[9]?.username, 'user_07');

console.log('MentionSuggest.check.ts ok');
