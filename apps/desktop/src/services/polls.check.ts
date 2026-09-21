/** Self-check: `pnpm --filter @betweenus/desktop check`. The poll card's numbers and the composer's rules. */
import assert from 'node:assert/strict';
import type { MessagePoll } from '@betweenus/shared-types';
import { nextBallot, pollDeadline, pollPreview, pollView, readyPoll } from './polls';

const now = Date.parse('2026-09-22T12:00:00.000Z');

const poll: MessagePoll = {
  optionCount: 3,
  multiChoice: true,
  closesAt: null,
  closedAt: null,
  closedBy: null,
  tallies: [
    { option: 0, userIds: ['me', 'ada'] },
    { option: 1, userIds: ['me'] },
    { option: 2, userIds: [] },
  ],
};

const view = pollView(poll, ['Pizza', 'Ramen', 'Salad'], 'me', now);
assert.equal(view.voters, 2, 'two people, three ballots');
assert.deepEqual(
  view.bars.map((bar) => [bar.label, bar.count, bar.percent, bar.mine, bar.leading]),
  [
    ['Pizza', 2, 100, true, true],
    ['Ramen', 1, 50, true, false],
    ['Salad', 0, 0, false, false],
  ],
);
assert.deepEqual(view.mine, [0, 1]);
assert.equal(view.closed, false);

// Nobody has voted: no leader, no division by zero.
const empty = pollView({ ...poll, tallies: [] }, ['a', 'b', 'c'], 'me', now);
assert.ok(empty.bars.every((bar) => bar.percent === 0 && !bar.leading && bar.count === 0));

// Fewer labels than the server counts: the gap is named, not dropped.
assert.equal(pollView(poll, ['Pizza'], 'me', now).bars[2]?.label, 'Option 3');

// Clicking: single choice moves or retracts, multi choice toggles one.
assert.deepEqual(nextBallot({ mine: [], multiChoice: false }, 1), [1]);
assert.deepEqual(nextBallot({ mine: [1], multiChoice: false }, 2), [2]);
assert.deepEqual(nextBallot({ mine: [1], multiChoice: false }, 1), []);
assert.deepEqual(nextBallot({ mine: [2], multiChoice: true }, 0), [0, 2]);
assert.deepEqual(nextBallot({ mine: [0, 2], multiChoice: true }, 2), [0]);

// The composer.
assert.deepEqual(readyPoll({ question: ' Lunch? ', options: ['Pizza', ' Ramen ', ''] }), {
  ok: true,
  question: 'Lunch?',
  options: ['Pizza', 'Ramen'],
});
assert.equal(readyPoll({ question: '', options: ['a', 'b'] }).ok, false);
assert.equal(readyPoll({ question: 'q', options: ['a', ''] }).ok, false, 'one option is not a poll');
assert.equal(readyPoll({ question: 'q', options: ['Yes', 'yes'] }).ok, false, 'duplicates');
assert.equal(readyPoll({ question: 'q', options: Array.from({ length: 11 }, (_, i) => `${i}`) }).ok, false);
assert.equal(readyPoll({ question: 'q', options: ['a', 'x'.repeat(81)] }).ok, false);

// Deadlines.
assert.equal(pollDeadline({ closesAt: null, closedAt: null }, now), null);
assert.equal(pollDeadline({ closesAt: null, closedAt: '2026-09-22T11:00:00.000Z' }, now), 'Closed');
assert.equal(pollDeadline({ closesAt: '2026-09-22T11:59:00.000Z', closedAt: null }, now), 'Closed');
assert.equal(pollDeadline({ closesAt: '2026-09-22T12:30:00.000Z', closedAt: null }, now), 'Closes in 30m');
assert.equal(pollDeadline({ closesAt: '2026-09-22T15:00:00.000Z', closedAt: null }, now), 'Closes in 3h');
assert.equal(pollDeadline({ closesAt: '2026-09-29T12:00:00.000Z', closedAt: null }, now), 'Closes in 7d');

assert.equal(pollPreview('Lunch?'), 'Poll: Lunch?');

console.log('polls check ok');
