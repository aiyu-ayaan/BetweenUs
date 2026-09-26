import assert from 'node:assert/strict';
import {
  SEARCH_HIT_CAP,
  matchMessages,
  mergeHits,
  normaliseTerm,
  walkOlder,
  walkStatus,
  type WalkPage,
  type WalkProgress,
} from './search-walk';

interface Msg {
  id: string;
  content: string;
  createdAt: string;
  deletedAt?: string | null;
}
const msg = (n: number, content: string, deletedAt: string | null = null): Msg => ({
  id: `m${String(n).padStart(4, '0')}`,
  content,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
  deletedAt,
});

// --- term -------------------------------------------------------------------
assert.equal(normaliseTerm(' A '), null, 'one character is too short');
assert.equal(normaliseTerm(' Hi '), 'hi');

// --- matching ---------------------------------------------------------------
const found = matchMessages(
  [msg(1, 'Hello there'), msg(2, 'nothing'), msg(3, 'HELLO again'), msg(4, 'hello', '2026-01-02')],
  'hello',
);
assert.deepEqual(found.map((m) => m.id), ['m0003', 'm0001'], 'newest first, deleted excluded');

// --- merge ------------------------------------------------------------------
const merged = mergeHits([msg(3, 'x')], [msg(3, 'x'), msg(1, 'x'), msg(2, 'x')]);
assert.deepEqual(merged.map((m) => m.id), ['m0003', 'm0002', 'm0001'], 'no repeats, newest first');
const many = Array.from({ length: SEARCH_HIT_CAP + 50 }, (_, i) => msg(i, 'x'));
assert.equal(mergeHits([], many).length, SEARCH_HIT_CAP, 'hits are capped');
assert.equal(mergeHits([], many)[0]?.id, msg(SEARCH_HIT_CAP + 49, 'x').id, 'the newest survive the cap');

// --- walking ----------------------------------------------------------------
// A channel of 10 pages, 5 messages each, cursor "pN" -> page N (older as N grows).
function channel(pages: number, size: number): (cursor: string) => Promise<WalkPage<Msg>> {
  return async (cursor) => {
    const n = Number(cursor.slice(1));
    const items = Array.from({ length: size }, (_, i) =>
      msg((pages - n) * size + i, (pages - n) * size + i === 7 ? 'needle here' : 'hay'),
    );
    return { items, nextCursor: n + 1 < pages ? `p${n + 1}` : null };
  };
}

{
  const seen: WalkProgress<Msg>[] = [];
  const result = await walkOlder({
    term: 'needle',
    cursor: 'p0',
    fetchPage: channel(4, 5),
    onProgress: (p) => seen.push(p),
    isStopped: () => false,
  });
  assert.equal(result.stop, 'end');
  assert.equal(result.scanned, 20);
  assert.equal(seen.length, 4, 'one progress report per page');
  assert.equal(seen.flatMap((p) => p.hits).length, 1, 'the one match is reported once');
  assert.ok(seen[0] && seen[3] && seen[3].oldestAt! < seen[0].oldestAt!, 'reach moves back in time');
  assert.equal(result.cursor, null);
}

{
  // The cap is a hard bound: 10 pages of 5 with a cap of 12 reads 3 pages.
  const result = await walkOlder({
    term: 'zzz',
    cursor: 'p0',
    fetchPage: channel(10, 5),
    onProgress: () => undefined,
    isStopped: () => false,
    maxMessages: 12,
  });
  assert.equal(result.stop, 'cap');
  assert.equal(result.scanned, 15);
  assert.equal(result.cursor, 'p3', 'a further run continues where this one stopped');
}

{
  // Stop between pages.
  let calls = 0;
  const result = await walkOlder({
    term: 'zzz',
    cursor: 'p0',
    fetchPage: async (c) => {
      calls += 1;
      return channel(10, 5)(c);
    },
    onProgress: () => undefined,
    isStopped: () => calls >= 2,
  });
  assert.equal(result.stop, 'stopped');
  assert.equal(calls, 2);
}

{
  // A stop while a page is in flight drops that page.
  let stopped = false;
  const reported: number[] = [];
  const result = await walkOlder({
    term: 'hay',
    cursor: 'p0',
    fetchPage: async (c) => {
      stopped = true;
      return channel(3, 5)(c);
    },
    onProgress: (p) => reported.push(p.scanned),
    isStopped: () => stopped,
  });
  assert.equal(result.stop, 'stopped');
  assert.deepEqual(reported, [], 'nothing from a discarded page reaches the list');
}

{
  const result = await walkOlder({
    term: 'x',
    cursor: 'p0',
    fetchPage: async () => {
      throw new Error('offline');
    },
    onProgress: () => undefined,
    isStopped: () => false,
  });
  assert.equal(result.stop, 'error');
  assert.equal(result.cursor, 'p0', 'the failed page can be retried');
}

assert.match(walkStatus(null, 40, '3 Jan'), /back to 3 Jan/);
assert.match(walkStatus('end', 40, null), /whole conversation/);
assert.match(walkStatus('cap', 1000, '3 Jan'), /1000/);

console.log('search-walk.check.ts ok');
