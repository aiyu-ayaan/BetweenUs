/**
 * What the attachment sweep will and will not collect.
 *
 * The query is the policy, so this asserts on the query rather than on rows in
 * a database: the two arms, and which way round the grace period runs. An
 * inverted comparison here would delete every upload the moment it landed,
 * which is the failure worth one file of arithmetic.
 */
import assert from 'node:assert/strict';
import { sweepWhere } from './attachment-sweeper';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-08-16T12:00:00.000Z');

const where = sweepWhere(now, 24 * HOUR);
const [unclaimed, deleted] = where.OR;

// An unclaimed row is collected only once it is *older* than the grace period.
assert.equal(unclaimed?.messageId, null);
assert.deepEqual(unclaimed?.createdAt, { lte: new Date('2026-08-15T12:00:00.000Z') });
assert.ok(
  unclaimed!.createdAt.lte < now,
  'the cutoff is in the past: an upload from a minute ago must survive',
);

// A claimed row goes with its message, with no grace period of its own.
assert.deepEqual(deleted, { message: { deletedAt: { not: null } } });
assert.equal(Object.keys(deleted ?? {}).length, 1, 'nothing else narrows the deleted-message arm');

// A shorter grace means a later cutoff, not an earlier one.
const brief = sweepWhere(now, 1 * HOUR).OR[0]!;
assert.ok(brief.createdAt.lte > unclaimed!.createdAt.lte);

console.log('attachment-sweeper: ok');
