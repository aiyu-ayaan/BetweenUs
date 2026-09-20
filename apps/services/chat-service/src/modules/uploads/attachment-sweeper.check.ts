/**
 * What the attachment sweep will and will not collect.
 *
 * The query is the policy, so this asserts on the query rather than on rows in
 * a database: the three arms, and which way round the grace period runs. An
 * inverted comparison here would delete every upload the moment it landed,
 * which is the failure worth one file of arithmetic.
 */
import assert from 'node:assert/strict';
import { sweepWhere } from './attachment-sweeper';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-08-16T12:00:00.000Z');

const where = sweepWhere(now, 24 * HOUR);
const [unsent, orphaned, cascaded] = where.OR;

// An upload nobody sent is collected only once it is *older* than the grace.
assert.equal(unsent?.state, 'PENDING');
assert.deepEqual(unsent?.stateAt, { lte: new Date('2026-08-15T12:00:00.000Z') });
assert.ok(
  unsent!.stateAt.lte < now,
  'the cutoff is in the past: an upload from a minute ago must survive',
);

// A blob whose message is gone goes at once, with no grace period of its own.
assert.deepEqual(orphaned, { state: 'ORPHANED' });
assert.equal(Object.keys(orphaned ?? {}).length, 1, 'nothing else narrows the orphaned arm');

// The cascade arm, which is the one that is easy to leave out and is the
// difference between the state column being an improvement and being a leak.
// A channel, server or account deletion nulls `messageId` through the foreign
// key and runs no application code, so the row keeps the LINKED it was given
// when its message was written and nothing else would ever collect it.
assert.deepEqual(cascaded, { state: 'LINKED', messageId: null });

// The grace is measured from `stateAt`, not `createdAt`. A blob orphaned today
// must not be kept because it was uploaded a year ago, and one claimed and
// then released must not be collected on the strength of its upload date.
assert.ok(!('createdAt' in (unsent as object)), 'the clock is stateAt, not createdAt');

// A shorter grace means a later cutoff, not an earlier one.
const brief = sweepWhere(now, 1 * HOUR).OR[0]!;
assert.ok(brief.stateAt.lte > unsent!.stateAt.lte);

console.log('attachment-sweeper: ok');
