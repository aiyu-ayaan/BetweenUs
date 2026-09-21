/**
 * Self-check: how a sidebar layout request becomes positions, and what the
 * pipe lets through to get there.
 *
 * `applyChannelLayout` is shared with the desktop client, which draws its
 * result optimistically before the server has answered. So the rules checked
 * here are the rules both ends apply, and a change that broke one would make
 * the sidebar jump the moment the realtime refetch landed.
 *
 * Run with: pnpm --filter @betweenus/server-service check
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { applyChannelLayout, sortByPosition } from '@betweenus/shared-types';
import { ChannelLayoutDto, CreateChannelCategoryDto } from './dto';
import { normalizeCategoryName } from './servers.service';

interface Row {
  id: string;
  position?: number;
  createdAt: string;
  categoryId?: string | null;
}

const at = (minute: number): string => `2026-09-22T10:${String(minute).padStart(2, '0')}:00.000Z`;

const categories: Row[] = [
  { id: 'cat-a', position: 0, createdAt: at(0) },
  { id: 'cat-b', position: 1, createdAt: at(1) },
];

// Every channel that predates categories: position 0, no category. The order
// has to be the order it was always drawn in - creation.
const legacy: Row[] = [
  { id: 'c3', position: 0, createdAt: at(3), categoryId: null },
  { id: 'c1', position: 0, createdAt: at(1), categoryId: null },
  { id: 'c2', position: 0, createdAt: at(2), categoryId: null },
];
assert.deepEqual(
  sortByPosition(legacy).map((row) => row.id),
  ['c1', 'c2', 'c3'],
  'untouched channels draw in creation order',
);

const ids = (rows: Row[], categoryId: string | null): string[] =>
  sortByPosition(rows.filter((row) => (row.categoryId ?? null) === categoryId)).map((row) => row.id);

// A full layout: two channels filed under a category, one left loose.
{
  const next = applyChannelLayout(categories, legacy, {
    channels: [
      { id: 'c2', categoryId: null },
      { id: 'c3', categoryId: 'cat-a' },
      { id: 'c1', categoryId: 'cat-a' },
    ],
  });
  assert.deepEqual(ids(next.channels, null), ['c2']);
  assert.deepEqual(ids(next.channels, 'cat-a'), ['c3', 'c1'], 'request order within a category');
  assert.deepEqual(
    next.channels.map((row) => row.position),
    [0, 1, 0],
    'positions restart at 0 inside every category',
  );
}

// Categories reorder on their own, and a partial list keeps the rest after it.
{
  const three = [...categories, { id: 'cat-c', position: 2, createdAt: at(2) }];
  const next = applyChannelLayout(three, legacy, { categoryIds: ['cat-c'] });
  assert.deepEqual(sortByPosition(next.categories).map((row) => row.id), ['cat-c', 'cat-a', 'cat-b']);
  // No channel was named, so none moved.
  assert.deepEqual(ids(next.channels, null), ['c1', 'c2', 'c3']);
}

// A manager who cannot see a private channel cannot name it; it has to keep
// its category and fall in behind whatever the request did name.
{
  const channels: Row[] = [
    { id: 'public-1', position: 0, createdAt: at(1), categoryId: 'cat-a' },
    { id: 'hidden', position: 1, createdAt: at(2), categoryId: 'cat-a' },
    { id: 'public-2', position: 2, createdAt: at(3), categoryId: 'cat-a' },
  ];
  const next = applyChannelLayout(categories, channels, {
    channels: [
      { id: 'public-2', categoryId: 'cat-a' },
      { id: 'public-1', categoryId: 'cat-a' },
    ],
  });
  assert.deepEqual(ids(next.channels, 'cat-a'), ['public-2', 'public-1', 'hidden']);
}

// Unknown categories are ignored by the pure function (the service refuses
// them first), and a channel named twice keeps its first placement.
{
  const next = applyChannelLayout(categories, legacy, {
    channels: [
      { id: 'c1', categoryId: 'nowhere' },
      { id: 'c2', categoryId: 'cat-b' },
      { id: 'c2', categoryId: null },
    ],
  });
  assert.equal(next.channels.find((row) => row.id === 'c1')?.categoryId, null);
  assert.equal(next.channels.find((row) => row.id === 'c2')?.categoryId, 'cat-b');
}

// Positions are compacted on every layout, so gaps left behind by deletes do
// not accumulate. The service only writes the rows whose values changed.
{
  const next = applyChannelLayout([], [{ id: 'x', position: 4, createdAt: at(0), categoryId: null }], {});
  assert.deepEqual(next.channels.map((row) => row.position), [0]);
}

// Category names.
assert.equal(normalizeCategoryName('  Voice   rooms  '), 'Voice rooms');
assert.equal(normalizeCategoryName('   '), 'Category');
assert.equal(normalizeCategoryName('x'.repeat(100)).length, 64);

// --- The pipe -----------------------------------------------------------------

/** What `packages/nest-common` passes to `ValidationPipe`. */
const OPTIONS = { whitelist: true, forbidNonWhitelisted: true } as const;

function flatten(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flatten(error.children ?? []),
  ]);
}

function layoutComplaints(body: Record<string, unknown>): string[] {
  return flatten(validateSync(plainToInstance(ChannelLayoutDto, body), OPTIONS));
}

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

assert.deepEqual(layoutComplaints({}), [], 'an empty layout is a no-op, not an error');
assert.deepEqual(
  layoutComplaints({
    categoryIds: [uuid(1), uuid(2)],
    channels: [
      { id: uuid(3), categoryId: uuid(1) },
      { id: uuid(4), categoryId: null },
    ],
  }),
  [],
  'nested entries survive forbidNonWhitelisted',
);
assert.ok(layoutComplaints({ channels: [{ id: uuid(3) }] }).length > 0, 'categoryId is required');
assert.ok(layoutComplaints({ channels: [{ id: 'nope', categoryId: null }] }).length > 0);
assert.ok(layoutComplaints({ categoryIds: ['nope'] }).length > 0);
assert.ok(
  layoutComplaints({ channels: [{ id: uuid(3), categoryId: null, position: 9 }] }).length > 0,
  'an unknown field on an entry is refused',
);

assert.deepEqual(
  flatten(validateSync(plainToInstance(CreateChannelCategoryDto, { name: 'Games' }), OPTIONS)),
  [],
);
assert.ok(
  flatten(validateSync(plainToInstance(CreateChannelCategoryDto, { name: '' }), OPTIONS)).length > 0,
);

console.log('channel-layout.check: ok');
