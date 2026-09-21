/**
 * Which messages a thread may hang off, and what a root says about its thread.
 *
 * Both are invisible when wrong: a reply accepted under a root in another
 * channel is sealed under a key half its readers do not hold, and a summary
 * drawn on a reply puts an "N replies" chip on a message nobody can open a
 * thread from.
 */
import assert from 'node:assert/strict';
import { threadRootProblem, threadSummaryOf, type ThreadRootCandidate } from './threads';

const channel = 'channel-a';
const root: ThreadRootCandidate = {
  channelId: channel,
  kind: 'USER',
  threadRootId: null,
  viewOnce: false,
};

// --- Which roots take a reply -----------------------------------------------

assert.equal(threadRootProblem(root, channel), null, 'an ordinary message takes a thread');
assert.equal(
  threadRootProblem({ ...root, kind: 'WEBHOOK' }, channel),
  null,
  'a webhook post can be discussed like any other',
);
assert.equal(threadRootProblem(null, channel), 'MESSAGE_NOT_FOUND');
// Another channel answers exactly like a missing message, so a reply cannot be
// used to confirm that a message id exists somewhere the caller cannot see.
assert.equal(threadRootProblem(root, 'channel-b'), 'MESSAGE_NOT_FOUND');
// One level only.
assert.equal(
  threadRootProblem({ ...root, threadRootId: 'some-root' }, channel),
  'THREAD_NOT_ALLOWED',
);
// An arrival notice is addressed to nobody and has no body to answer.
assert.equal(threadRootProblem({ ...root, kind: 'MEMBER_JOIN' }, channel), 'THREAD_NOT_ALLOWED');
// A one-time message is destroyed once looked at; a thread under it would be
// destroyed with it without anybody in the thread choosing that.
assert.equal(threadRootProblem({ ...root, viewOnce: true }, channel), 'THREAD_NOT_ALLOWED');

// --- The summary on a root ----------------------------------------------------

const at = new Date('2026-09-22T12:00:00.000Z');
assert.equal(
  threadSummaryOf({ threadRootId: null, threadReplyCount: 0, threadLastReplyAt: null }),
  null,
);
assert.deepEqual(
  threadSummaryOf({ threadRootId: null, threadReplyCount: 3, threadLastReplyAt: at }),
  { replyCount: 3, lastReplyAt: '2026-09-22T12:00:00.000Z' },
);
// A reply never carries a summary, whatever its own columns say.
assert.equal(
  threadSummaryOf({ threadRootId: 'root', threadReplyCount: 2, threadLastReplyAt: at }),
  null,
);
// A row selected before the columns existed reads as "no thread".
assert.equal(threadSummaryOf({}), null);

console.log('threads: ok');
