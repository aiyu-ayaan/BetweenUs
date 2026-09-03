/**
 * The two status rules that are worth asserting rather than reading: who a
 * status is visible to, and what order the tray comes back in.
 *
 * The audience rule is an authorization rule with three callers - the tray,
 * the single-post gate and the media download - so it is one function and this
 * is the thing that says what it means. The ordering is not security, but it
 * is the difference between "the run you have not watched is under your thumb"
 * and a list that reshuffles itself every time somebody posts twice.
 */
import assert from 'node:assert/strict';
import type { StatusEntry } from '@betweenus/shared-types';
import { orderRuns, statusAudience } from './status.service';

const ada = 'ada';
const grace = 'grace';
const alan = 'alan';

// --- Audience -----------------------------------------------------------------

// A friend nobody has blocked can see it. That is the whole feature.
assert.deepEqual(statusAudience([ada, grace], new Set()), [ada, grace]);

// A block removes them, whichever side made it: `blockedIdsAround` returns
// both directions, and either one has to close the door. Relying on the block
// to have ended the friendship is not enough - unblocking does not restore
// one, so the two facts drift apart the moment somebody unblocks.
assert.deepEqual(statusAudience([ada, grace], new Set([grace])), [ada]);
assert.deepEqual(statusAudience([ada, grace], new Set([ada, grace])), []);

// Somebody who is not a friend was never in the list to be removed from it.
assert.deepEqual(statusAudience([], new Set([alan])), []);

// --- Tray order ---------------------------------------------------------------

const person = (id: string) => ({
  id,
  username: id,
  displayName: id,
  avatarUrl: null,
  coverUrl: null,
  about: '',
});

const post = (createdAt: string, seen: boolean): StatusEntry => ({
  id: `${createdAt}-${String(seen)}`,
  authorId: 'whoever',
  kind: 'TEXT',
  mediaUrl: null,
  caption: 'hello',
  background: '#0F172A',
  durationMs: null,
  createdAt,
  expiresAt: '2030-01-01T00:00:00.000Z',
  seen,
  viewCount: null,
});

// An unopened run outranks an opened one even when the opened one is newer.
// This is the case a plain sort by time gets wrong, and it is the common one:
// somebody you have already caught up with posts again while somebody you have
// not sits below them.
const ordered = orderRuns([
  { author: person(ada), statuses: [post('2026-09-03T10:00:00.000Z', true)] },
  { author: person(grace), statuses: [post('2026-09-03T09:00:00.000Z', false)] },
]);
assert.deepEqual(
  ordered.map((run) => run.author.id),
  [grace, ada],
);
assert.deepEqual(
  ordered.map((run) => run.unseen),
  [true, false],
);

// Inside one half, newest first.
assert.deepEqual(
  orderRuns([
    { author: person(ada), statuses: [post('2026-09-03T08:00:00.000Z', false)] },
    { author: person(grace), statuses: [post('2026-09-03T09:00:00.000Z', false)] },
  ]).map((run) => run.author.id),
  [grace, ada],
);

// A run is unseen while *any* post in it is: catching up on the first two of
// somebody's three does not take their ring away.
const run = orderRuns([
  {
    author: person(alan),
    statuses: [
      post('2026-09-03T07:00:00.000Z', true),
      post('2026-09-03T08:00:00.000Z', true),
      post('2026-09-03T09:00:00.000Z', false),
    ],
  },
])[0]!;
assert.equal(run.unseen, true);
// The run is built oldest-first, so its newest post is what dates it.
assert.equal(run.latestAt, '2026-09-03T09:00:00.000Z');

console.log('status check ok');
