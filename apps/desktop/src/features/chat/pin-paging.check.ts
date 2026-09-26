import assert from 'node:assert/strict';
import { appendPinPage, refreshPinPages } from './pin-paging';

const pin = (id: string) => ({ id });
const ids = (list: { id: string }[]) => list.map((item) => item.id).join(',');

assert.equal(ids(appendPinPage([pin('a'), pin('b')], [pin('c'), pin('d')])), 'a,b,c,d');
assert.equal(ids(appendPinPage([pin('a'), pin('b')], [pin('b'), pin('c')])), 'a,b,c', 'a repeat is dropped');
const same = [pin('a')];
assert.equal(appendPinPage(same, [pin('a')]), same, 'nothing new keeps the same array');

// A reload with nothing scrolled just takes the new first page and its cursor.
const plain = refreshPinPages([pin('b'), pin('c')], 'x', { items: [pin('a'), pin('b')], nextCursor: 'y' });
assert.equal(ids(plain.pins), 'a,b');
assert.equal(plain.cursor, 'y');

// A reload after scrolling keeps the pages read and the cursor behind them.
const deep = refreshPinPages(
  [pin('b'), pin('c'), pin('d'), pin('e')],
  'end',
  { items: [pin('a'), pin('b')], nextCursor: 'y' },
);
assert.equal(ids(deep.pins), 'a,b,c,d,e', 'the new pin leads, nothing is dropped or doubled');
assert.equal(deep.cursor, 'end');

console.log('pin-paging.check.ts ok');
