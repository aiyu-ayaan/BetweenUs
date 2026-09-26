import assert from 'node:assert/strict';
import type { MessageEditVersion } from '@betweenus/shared-types';
import { editedMarkerLabel, hasEditHistory, openVersions, versionTime } from './edit-history';

// The marker is a control only when there is something behind it.
assert.equal(hasEditHistory({ editedAt: null, editCount: 2 }), false);
assert.equal(hasEditHistory({ editedAt: 'x', editCount: 0 }), false);
// A message from a build older than the count: plain text, as before.
assert.equal(hasEditHistory({ editedAt: 'x' }), false);
assert.equal(hasEditHistory({ editedAt: 'x', editCount: 1 }), true);

assert.equal(editedMarkerLabel(undefined), 'Edited');
assert.equal(editedMarkerLabel(1), 'Edited, 1 earlier version. Show history');
assert.equal(editedMarkerLabel(3), 'Edited, 3 earlier versions. Show history');

const items: MessageEditVersion[] = [
  { id: 'a', content: 'sealed-a', writtenAt: '2026-09-01T11:00:00.000Z', replacedAt: '2026-09-01T12:00:00.000Z' },
  { id: 'b', content: 'sealed-b', writtenAt: '2026-09-01T10:00:00.000Z', replacedAt: '2026-09-01T11:00:00.000Z' },
  { id: 'c', content: 'sealed-c', writtenAt: '2026-09-01T09:00:00.000Z', replacedAt: '2026-09-01T10:00:00.000Z' },
];
const opened = await openVersions(items, async (content) => {
  if (content === 'sealed-b') return null; // key missing
  if (content === 'sealed-c') throw new Error('bad tag');
  return `plain ${content}`;
});
// Order kept, and an unreadable version stays in the list so the count holds.
assert.deepEqual(
  opened.map((version) => [version.id, version.readable, version.text]),
  [
    ['a', true, 'plain sealed-a'],
    ['b', false, ''],
    ['c', false, ''],
  ],
);
assert.deepEqual(await openVersions([], async () => 'x'), []);
assert.equal(versionTime('not a date'), '');
assert.ok(versionTime('2026-09-01T10:00:00.000Z', 'en-GB').length > 0);
console.log('edit-history.check ok');
