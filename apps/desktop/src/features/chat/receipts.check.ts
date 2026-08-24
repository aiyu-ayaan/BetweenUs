/** Run with `tsx src/features/chat/receipts.check.ts`. Read receipts from markers. */
import assert from 'node:assert/strict';
import type { ChannelReadReceipt } from '@betweenus/shared-types';
import { anchorReceipts, seenBy, seenByLabel, type ReceiptMessage } from './receipts';

const reader = (name: string, readAt: string): ChannelReadReceipt => ({
  user: { id: name, username: name, displayName: name, avatarUrl: null },
  readAt,
});

const message = (id: string, createdAt: string, authorId: string): ReceiptMessage => ({
  id,
  createdAt,
  authorId,
});

const mine = [
  message('m1', '2026-01-01T10:00:00.000Z', 'me'),
  message('m2', '2026-01-01T10:05:00.000Z', 'me'),
  message('m3', '2026-01-01T10:10:00.000Z', 'me'),
];

// --- seenBy ------------------------------------------------------------------

const readers = [
  reader('ana', '2026-01-01T10:06:00.000Z'),
  reader('bo', '2026-01-01T10:11:00.000Z'),
];

assert.deepEqual(
  seenBy(mine[0], readers).map((r) => r.user.id),
  ['ana', 'bo'],
  'both markers are past the first message',
);
assert.deepEqual(
  seenBy(mine[2], readers).map((r) => r.user.id),
  ['bo'],
  'only the marker past the newest message counts',
);
// The marker landing on the same millisecond counts: it was read, not missed.
assert.equal(seenBy(mine[1], [reader('cy', mine[1].createdAt)]).length, 1);

// --- anchorReceipts ----------------------------------------------------------

const anchors = anchorReceipts(mine, readers, 'me');
assert.deepEqual(Object.keys(anchors).sort(), ['m2', 'm3']);
assert.deepEqual(anchors.m2.map((r) => r.user.id), ['ana'], 'ana stops at the second');
assert.deepEqual(anchors.m3.map((r) => r.user.id), ['bo'], 'bo reached the newest');
assert.equal(anchors.m1, undefined, 'nobody is drawn twice');

// A marker older than anything on screen anchors nowhere.
assert.deepEqual(anchorReceipts(mine, [reader('old', '2026-01-01T09:00:00.000Z')], 'me'), {});

// Somebody else's messages never carry a receipt, and neither does a signed-out
// client that has no idea which messages are its own.
const theirs = [message('t1', '2026-01-01T10:00:00.000Z', 'them')];
assert.deepEqual(anchorReceipts(theirs, readers, 'me'), {});
assert.deepEqual(anchorReceipts(mine, readers, undefined), {});

// Out-of-order input must not change the answer: the list is sorted first.
const shuffled = [mine[2], mine[0], mine[1]];
assert.deepEqual(Object.keys(anchorReceipts(shuffled, readers, 'me')).sort(), ['m2', 'm3']);

// --- seenByLabel -------------------------------------------------------------

assert.equal(seenByLabel([]), 'Not seen yet');
assert.equal(seenByLabel([reader('Ana', '2026-01-01T10:06:00.000Z')]), 'Seen by Ana');
assert.equal(seenByLabel(readers.slice(0, 2)), 'Seen by ana and bo');
assert.equal(
  seenByLabel([...readers, reader('cy', '2026-01-01T10:12:00.000Z')]),
  'Seen by ana, bo and 1 other',
);

console.log('receipts.check.ts ok');
