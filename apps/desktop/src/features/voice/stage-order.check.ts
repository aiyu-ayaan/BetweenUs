/**
 * Self-check for the two rules that decide where a face sits on the call stage.
 *
 * Run with `pnpm --filter @betweenus/desktop check`. The complaint these rules
 * answer - "it keeps swapping the person who is talking" - is invisible in a
 * screenshot and obvious in a call, so it is pinned down here instead.
 */
import assert from 'node:assert/strict';
import { PAGE_SIZE, PROMOTION_MS, orderStage, splitStage } from './stage-order';

const NOW = 1_000_000;

const tile = (key: string, spokeAgo: number, isLocal = false): {
  key: string;
  isLocal: boolean;
  lastSpokeAt: number;
} => ({ key, isLocal, lastSpokeAt: spokeAgo === Infinity ? 0 : NOW - spokeAgo });

// Two people, the other one talking: the order is the order it arrived in, and
// stays that way. This is the reported bug.
const pair = [tile('me', 0, true), tile('them', 200)];
assert.deepEqual(orderStage(pair, NOW), pair);

// Still one page with nine other people on it - nobody moves.
const roomful = [tile('me', Infinity, true), ...Array.from({ length: PAGE_SIZE }, (_, i) => tile(`p${i}`, i * 100))];
assert.deepEqual(orderStage(roomful, NOW), roomful);

// One person past a full page: now a promotion has somewhere to promote to, so
// the recent speaker leads and a stale one does not.
const crowd = [
  ...Array.from({ length: PAGE_SIZE }, (_, i) => tile(`p${i}`, PROMOTION_MS * 2)),
  tile('late', 500),
];
assert.equal(orderStage(crowd, NOW)[0]?.key, 'late');
// A promotion that has lapsed leaves the order alone.
const lapsed = [
  ...Array.from({ length: PAGE_SIZE }, (_, i) => tile(`p${i}`, PROMOTION_MS * 2)),
  tile('quiet', PROMOTION_MS + 1),
];
assert.deepEqual(orderStage(lapsed, NOW), lapsed);

// The grid is the other people; you are the floating window.
const split = splitStage(pair, null);
assert.equal(split.self?.key, 'me');
assert.deepEqual(split.grid.map((t) => t.key), ['them']);
assert.equal(split.hero, null);
assert.deepEqual(split.strip, []);

// Alone: your own camera is all there is, so it takes the stage rather than
// leaving an empty grid with a thumbnail over it.
const alone = splitStage([tile('me', 0, true)], null);
assert.deepEqual(alone.grid.map((t) => t.key), ['me']);
assert.equal(alone.self?.key, 'me');

// A pin puts one face on the stage and everybody else in the strip - and the
// pinned person is not also in the strip.
const trio = [tile('me', 0, true), tile('a', 100), tile('b', 100)];
const pinnedOther = splitStage(trio, 'b');
assert.equal(pinnedOther.hero?.key, 'b');
assert.deepEqual(pinnedOther.strip.map((t) => t.key), ['a']);

// Pinning yourself works too, and does not put you in the strip either.
const pinnedSelf = splitStage(trio, 'me');
assert.equal(pinnedSelf.hero?.key, 'me');
assert.deepEqual(pinnedSelf.strip.map((t) => t.key), ['a', 'b']);

// A pin on somebody who has left is no pin at all - the stage falls back to the
// grid instead of holding an empty hero.
assert.equal(splitStage(trio, 'gone').hero, null);

console.log('stage-order self-check passed');
