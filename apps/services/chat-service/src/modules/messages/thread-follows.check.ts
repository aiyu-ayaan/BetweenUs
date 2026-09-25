/**
 * Who a reply signs up for its thread, how a read marker moves, and which rows
 * count as unread.
 *
 * All three fail quietly when wrong: an unfollow that the next reply undoes is
 * a setting that does not stick, a marker that moves backwards re-opens what
 * another device already read, and counting your own replies puts a badge on a
 * thread you just wrote in.
 */
import assert from 'node:assert/strict';
import { advancedMarker, followChangeFor, unreadWhere } from './thread-follows';

const at = new Date('2026-09-26T12:00:00.000Z');
const earlier = new Date('2026-09-26T11:00:00.000Z');

// --- Who a reply follows -------------------------------------------------------

// The replier follows, and has read up to what they wrote.
assert.deepEqual(followChangeFor('replier', null, at), { following: true, lastReadAt: at });
// Even after unfollowing: answering a thread is following it again.
assert.deepEqual(followChangeFor('replier', { following: false }, at), {
  following: true,
  lastReadAt: at,
});
// The root's author is signed up by the first reply, marker untouched so the
// reply is unread for them.
assert.deepEqual(followChangeFor('rootAuthor', null, at), { following: true });
// An explicit unfollow by the root's author stands.
assert.equal(followChangeFor('rootAuthor', { following: false }, at), null);
// Already following: nothing to write.
assert.equal(followChangeFor('rootAuthor', { following: true }, at), null);

// --- The read marker -----------------------------------------------------------

assert.equal(advancedMarker(null, at), at, 'the first read sets the marker');
assert.equal(advancedMarker(earlier, at), at, 'a newer reply moves it on');
assert.equal(advancedMarker(at, earlier), at, 'an older reply never moves it back');
assert.equal(advancedMarker(at, new Date(at)), at, 'the same reply is a no-op');

// --- What counts as unread -----------------------------------------------------

assert.deepEqual(unreadWhere('root', 'me', null), {
  threadRootId: 'root',
  deletedAt: null,
  authorId: { not: 'me' },
});
assert.deepEqual(unreadWhere('root', 'me', at), {
  threadRootId: 'root',
  deletedAt: null,
  authorId: { not: 'me' },
  createdAt: { gt: at },
});

console.log('thread-follows: ok');
