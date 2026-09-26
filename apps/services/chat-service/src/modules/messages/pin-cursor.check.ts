import assert from 'node:assert/strict';
import {
  PIN_PAGE_DEFAULT,
  PIN_PAGE_MAX,
  decodePinCursor,
  encodePinCursor,
  pinPage,
  pinPageSize,
} from './pin-cursor';

const id = '3f1c2b8a-1111-4222-8333-444455556666';
const at = new Date('2026-05-01T10:00:00.123Z');

const round = decodePinCursor(encodePinCursor({ pinnedAt: at, id }));
assert.ok(round);
assert.equal(round.pinnedAt.getTime(), at.getTime());
assert.equal(round.id, id);

assert.equal(decodePinCursor('nonsense'), null);
assert.equal(decodePinCursor(''), null);
assert.equal(decodePinCursor(Buffer.from('12.not-a-uuid').toString('base64url')), null);
assert.equal(decodePinCursor(Buffer.from(`abc.${id}`).toString('base64url')), null);

assert.equal(pinPageSize(undefined), PIN_PAGE_DEFAULT);
assert.equal(pinPageSize(0), 1);
assert.equal(pinPageSize(5000), PIN_PAGE_MAX);
assert.equal(pinPageSize(Number.NaN), PIN_PAGE_DEFAULT);

const row = (n: number) => ({ id, n, pinnedAt: new Date(1000 * n) });
const rows = [row(5), row(4), row(3)];
const first = pinPage(rows, 2);
assert.equal(first.items.length, 2);
assert.ok(first.nextCursor, 'an extra row means another page');
assert.equal(decodePinCursor(first.nextCursor)?.pinnedAt.getTime(), 4000, 'cursor is the last kept row');
const last = pinPage(rows, 3);
assert.equal(last.nextCursor, null, 'exactly a full page and no extra row ends the list');
assert.equal(pinPage([], 3).nextCursor, null);

console.log('pin-cursor.check.ts ok');
