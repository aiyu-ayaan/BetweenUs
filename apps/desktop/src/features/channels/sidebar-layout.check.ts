/**
 * Self-check: the sidebar arrangement that drag, keyboard and menu all share.
 *
 * Run with: pnpm --filter @betweenus/desktop check
 */
import assert from 'node:assert/strict';
import type { Channel, ChannelCategory } from '@betweenus/shared-types';
import {
  buildSections,
  collapsedSummary,
  layoutFrom,
  moveCategory,
  moveCategoryBefore,
  moveChannel,
  moveChannelBefore,
  moveChannelToEnd,
  parseCollapsed,
  sameLayout,
  stepCategory,
  stepChannel,
} from './sidebar-layout';

const at = (n: number): string => `2026-09-22T10:0${n}:00.000Z`;
const channel = (id: string, n: number, categoryId: string | null, position = 0): Channel => ({
  id,
  serverId: 's',
  name: id,
  type: 'TEXT',
  topic: null,
  isPrivate: false,
  categoryId,
  position,
  createdAt: at(n),
});
const category = (id: string, position: number): ChannelCategory => ({
  id,
  serverId: 's',
  name: id,
  position,
  createdAt: at(position),
});

const cats = [category('A', 0), category('B', 1)];
const chans = [
  channel('c1', 1, null),
  channel('c2', 2, 'A', 0),
  channel('c3', 3, 'A', 1),
  channel('c4', 4, 'B'),
];
const names = (sections: ReturnType<typeof buildSections>): string[] =>
  sections.map((s) => `${s.category?.id ?? '-'}:${s.channels.map((c) => c.id).join(',')}`);

const sections = buildSections(cats, chans);
assert.deepEqual(names(sections), ['-:c1', 'A:c2,c3', 'B:c4'], 'loose first, then categories in order');

// A channel pointing at a category we do not hold is drawn loose, not lost.
assert.deepEqual(names(buildSections(cats, [channel('x', 1, 'gone')])), ['-:x', 'A:', 'B:']);

// Between categories, and to a chosen index.
assert.deepEqual(names(moveChannel(sections, 'c1', 'A', 1)), ['-:', 'A:c2,c1,c3', 'B:c4']);
assert.deepEqual(names(moveChannel(sections, 'c3', 'A', 0)), ['-:c1', 'A:c3,c2', 'B:c4']);
assert.deepEqual(names(moveChannel(sections, 'c2', null, 9)), ['-:c1,c2', 'A:c3', 'B:c4'], 'index clamps');

// Drop semantics: onto a row lands before it; onto a heading lands last.
assert.deepEqual(names(moveChannelBefore(sections, 'c1', 'c3')), ['-:', 'A:c2,c1,c3', 'B:c4']);
assert.deepEqual(names(moveChannelBefore(sections, 'c2', 'c3')), ['-:c1', 'A:c2,c3', 'B:c4'], 'dropping just before the next is a no-op');
assert.deepEqual(names(moveChannelBefore(sections, 'c3', 'c2')), ['-:c1', 'A:c3,c2', 'B:c4']);
assert.deepEqual(names(moveChannelToEnd(sections, 'c1', 'B')), ['-:', 'A:c2,c3', 'B:c4,c1']);
assert.deepEqual(names(moveCategoryBefore(sections, 'B', 'A')), ['-:c1', 'B:c4', 'A:c2,c3']);
assert.ok(sameLayout(moveCategoryBefore(sections, 'A', 'B'), sections));

// Keyboard: swap inside, cross at the edge, stop at the ends.
assert.deepEqual(names(stepChannel(sections, 'c3', -1)), ['-:c1', 'A:c3,c2', 'B:c4']);
assert.deepEqual(names(stepChannel(sections, 'c2', -1)), ['-:c1,c2', 'A:c3', 'B:c4'], 'up out joins the bottom above');
assert.deepEqual(names(stepChannel(sections, 'c3', 1)), ['-:c1', 'A:c2', 'B:c3,c4'], 'down out joins the top below');
assert.ok(sameLayout(stepChannel(sections, 'c1', -1), sections), 'the very top does not move');
assert.ok(sameLayout(stepChannel(sections, 'c4', 1), sections), 'the very bottom does not move');

// Categories move as headings; the loose section is not one.
assert.deepEqual(names(moveCategory(sections, 'B', 0)), ['-:c1', 'B:c4', 'A:c2,c3']);
assert.deepEqual(names(stepCategory(sections, 'A', 1)), ['-:c1', 'B:c4', 'A:c2,c3']);
assert.ok(sameLayout(stepCategory(sections, 'A', -1), sections));
assert.ok(sameLayout(stepCategory(sections, 'unknown', 1), sections));

// The request names everything in order.
assert.deepEqual(layoutFrom(moveChannel(sections, 'c1', 'B', 0)), {
  categoryIds: ['A', 'B'],
  channels: [
    { id: 'c2', categoryId: 'A' },
    { id: 'c3', categoryId: 'A' },
    { id: 'c1', categoryId: 'B' },
    { id: 'c4', categoryId: 'B' },
  ],
});

// Folded categories keep their unread and "you are here".
const a = sections[1];
assert.ok(a);
assert.deepEqual(collapsedSummary(a, { c2: 2, c3: 1, c4: 9 }, 'c3'), { unread: 3, containsActive: true });
assert.deepEqual(collapsedSummary(a, {}, null), { unread: 0, containsActive: false });

// Local collapse storage: junk means "nothing folded", never a broken sidebar.
assert.deepEqual([...parseCollapsed('["A","B"]')], ['A', 'B']);
assert.equal(parseCollapsed('not json').size, 0);
assert.equal(parseCollapsed('{"a":1}').size, 0);
assert.deepEqual([...parseCollapsed('["A",3,null]')], ['A']);
assert.equal(parseCollapsed(null).size, 0);

console.log('sidebar-layout.check: ok');
