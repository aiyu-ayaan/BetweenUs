import assert from 'node:assert/strict';
import type { ThreadFollowState } from '@betweenus/shared-types';
import {
  followMap,
  isThreadReply,
  replyAge,
  takesPartIn,
  threadChipLabel,
  threadUnreadBadge,
  withFollow,
} from './thread';

const now = new Date('2026-09-22T12:00:00.000Z');
const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString();

// --- Which messages are thread replies ------------------------------------------
assert.equal(isThreadReply({ threadRootId: 'root' }), true);
assert.equal(isThreadReply({ threadRootId: null }), false);
// A message from a build older than threads has no field at all.
assert.equal(isThreadReply({}), false);

// --- The age in the chip ---------------------------------------------------------
assert.equal(replyAge(ago(10_000), now), 'just now');
assert.equal(replyAge(ago(-5_000), now), 'just now', 'a reply from a clock slightly ahead');
assert.equal(replyAge(ago(5 * 60_000), now), '5m ago');
assert.equal(replyAge(ago(3 * 3_600_000), now), '3h ago');
assert.equal(replyAge(ago(2 * 86_400_000), now), '2d ago');
assert.equal(replyAge('not a date', now), '');

// --- The chip ----------------------------------------------------------------------
assert.equal(threadChipLabel(null, now), null);
assert.equal(threadChipLabel(undefined, now), null);
assert.equal(threadChipLabel({ replyCount: 0, lastReplyAt: null }, now), null);
assert.equal(
  threadChipLabel({ replyCount: 1, lastReplyAt: ago(5 * 60_000) }, now),
  '1 reply · last reply 5m ago',
);
assert.equal(
  threadChipLabel({ replyCount: 12, lastReplyAt: ago(3 * 3_600_000) }, now),
  '12 replies · last reply 3h ago',
);
assert.equal(threadChipLabel({ replyCount: 2, lastReplyAt: null }, now), '2 replies');

// --- Who is in a thread ----------------------------------------------------------------
assert.equal(takesPartIn('me', 'me', []), true, 'the root author is in it');
assert.equal(takesPartIn('me', 'ada', ['grace', 'me']), true, 'so is anybody who replied');
assert.equal(takesPartIn('me', 'ada', ['grace']), false);
assert.equal(takesPartIn(undefined, undefined, []), false, 'nobody signed in is in nothing');

// --- Followed threads -------------------------------------------------------------
const state = (rootId: string, following: boolean, unreadCount: number): ThreadFollowState => ({
  rootId,
  channelId: 'channel',
  serverId: 'server',
  following,
  lastReadAt: null,
  unreadCount,
});
// Only followed threads are kept.
assert.deepEqual(Object.keys(followMap([state('a', true, 1), state('b', false, 0)])), ['a']);
// A new state replaces the old; an unfollow drops it.
const map = followMap([state('a', true, 1)]);
assert.equal(withFollow(map, state('a', true, 3)).a?.unreadCount, 3);
assert.deepEqual(withFollow(map, state('a', false, 0)), {});
assert.equal(withFollow(map, state('z', false, 0)), map, 'an unknown unfollow changes nothing');
assert.deepEqual(Object.keys(withFollow(map, state('b', true, 0))).sort(), ['a', 'b']);

// The badge: followed and unread only, capped for the chip.
assert.equal(threadUnreadBadge(undefined), null);
assert.equal(threadUnreadBadge(state('a', true, 0)), null);
assert.equal(threadUnreadBadge(state('a', false, 5)), null, 'not following means no badge');
assert.equal(threadUnreadBadge(state('a', true, 4)), '4');
assert.equal(threadUnreadBadge(state('a', true, 250)), '99+');

console.log('thread check ok');
