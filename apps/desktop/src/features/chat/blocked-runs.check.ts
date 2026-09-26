import assert from 'node:assert/strict';
import { blockedRunLabel, blockedRuns, runToReveal, type FoldableMessage } from './blocked-runs';

const say = (id: string, author: string, extra: Partial<FoldableMessage> = {}): FoldableMessage => ({
  id,
  author: { id: author },
  ...extra,
});

const blocked = new Set(['mallory']);

// Nobody blocked: nothing folds, and the list is not walked for it.
assert.equal(blockedRuns([say('1', 'mallory')], new Set()).size, 0);

// Two runs, broken by somebody else speaking - one row each, not one per message.
const list = [
  say('1', 'alice'),
  say('2', 'mallory'),
  say('3', 'mallory'),
  say('4', 'alice'),
  say('5', 'mallory'),
];
const runs = blockedRuns(list, blocked);
assert.equal(runs.has('1'), false, 'somebody not blocked is drawn as ever');
assert.deepEqual(runs.get('2'), { head: '2', count: 2 });
assert.equal(runs.get('3'), runs.get('2'), 'the second message belongs to the same run');
assert.deepEqual(runs.get('5'), { head: '5', count: 1 });

// A webhook the blocked person created is not them talking, and an arrival
// line is the channel talking - neither folds, and each breaks a run.
const mixed = blockedRuns(
  [
    say('a', 'mallory'),
    say('b', 'mallory', { webhook: { name: 'Bot' } }),
    say('c', 'mallory', { kind: 'MEMBER_JOIN' }),
    say('d', 'mallory', { webhook: null, kind: 'USER' }),
  ],
  blocked,
);
assert.equal(mixed.has('b'), false);
assert.equal(mixed.has('c'), false);
assert.deepEqual(mixed.get('a'), { head: 'a', count: 1 });
assert.deepEqual(mixed.get('d'), { head: 'd', count: 1 });

// A later message joining a run keeps its head, so a run that was revealed
// stays revealed as the person keeps talking.
const grown = blockedRuns([...list, say('6', 'mallory')], blocked);
assert.deepEqual(grown.get('6'), { head: '5', count: 2 });

// A jump to any message in a folded run opens that run; anything else is left.
assert.equal(runToReveal(runs, new Set(), '3'), '2');
assert.equal(runToReveal(runs, new Set(), '2'), '2');
assert.equal(runToReveal(runs, new Set(['2']), '3'), null);
assert.equal(runToReveal(runs, new Set(), '1'), null);

assert.equal(blockedRunLabel(1), 'Blocked message');
assert.equal(blockedRunLabel(3), '3 blocked messages');

console.log('blocked-runs.check.ts ok');
