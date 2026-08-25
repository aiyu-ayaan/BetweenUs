/**
 * Self-check for the Listen Together transport.
 *
 * Everything this guards is invisible when it breaks. A position stamped
 * against the wrong instant does not throw - it plays the music a second late
 * on one machine, which is exactly the thing this feature exists to prevent and
 * exactly the thing nobody can screenshot. An `ended` that is not idempotent
 * skips three tracks in a three-person call and looks like somebody else did
 * it. A queue with no ceiling is one person's afternoon in everybody's sidebar.
 *
 * Run with `pnpm --filter @betweenus/call-service check`.
 */
import assert from 'node:assert/strict';
import type { ListenSession, ListenTrack } from '@betweenus/shared-types';
import { MAX_QUEUE, apply, positionAt, sanitiseTrack } from './listen-session';

const T0 = 1_700_000_000_000;

function track(id: string, ref = 'dQw4w9WgXcQ', durationMs = 180_000): ListenTrack {
  return {
    id,
    provider: 'youtube',
    ref,
    title: `track ${id}`,
    durationMs,
    addedByUserId: 'ana',
    addedByUsername: 'ana',
  };
}

function start(): ListenSession {
  const session = apply(null, { kind: 'add', track: track('a') }, 'ana', T0);
  assert.ok(session);
  return session;
}

// --- Starting ---------------------------------------------------------------

// Adding the first track is what opens a session. There is no separate "start"
// because the person pressing it wants to hear something, not to open a room.
const first = start();
assert.equal(first.queue.length, 1);
assert.equal(first.index, 0);
assert.equal(first.paused, false);
assert.equal(first.positionMs, 0);
assert.equal(first.rev, 1);

// Anything but `add` against nothing stays nothing: a pause arriving after the
// last person closed the session must not resurrect it as an empty one.
assert.equal(apply(null, { kind: 'pause', positionMs: 0 }, 'ana', T0), null);
assert.equal(apply(null, { kind: 'skip', delta: 1 }, 'ana', T0), null);

// `playNow` adds and jumps in one action. Two messages could not do it: an add
// that arrived in between would move the index the play was aiming at, and the
// call would hear somebody else's track instead of the one that was pressed.
const playedNow = apply(
  apply(first, { kind: 'add', track: track('b') }, 'ana', T0),
  { kind: 'add', track: track('c'), playNow: true },
  'bo',
  T0 + 1_000,
);
assert.ok(playedNow);
assert.equal(playedNow.queue.length, 3);
assert.equal(playedNow.index, 2);
assert.equal(playedNow.positionMs, 0);
assert.equal(playedNow.paused, false);

// Without it the cursor stays where it was: a track queued while another plays
// does not interrupt it.
const appended = apply(first, { kind: 'add', track: track('d') }, 'bo', T0 + 1_000);
assert.ok(appended);
assert.equal(appended.index, 0);

// --- The clock, which is the whole feature ----------------------------------

// Playing: the position is where it was plus how long ago that was. This is the
// one line that lets a single message stay true without another one arriving.
assert.equal(positionAt(first, T0 + 5_000), 5_000);
assert.equal(positionAt(first, T0 + 90_000), 90_000);

// Paused: time passing changes nothing.
const paused = apply(first, { kind: 'pause', positionMs: 42_000 }, 'ben', T0 + 42_000)!;
assert.equal(paused.paused, true);
assert.equal(positionAt(paused, T0 + 42_000), 42_000);
assert.equal(positionAt(paused, T0 + 600_000), 42_000);

// Resuming from a pause carries on from where it stopped rather than restarting.
const resumed = apply(paused, { kind: 'play' }, 'ben', T0 + 100_000)!;
assert.equal(resumed.paused, false);
assert.equal(positionAt(resumed, T0 + 100_000), 42_000);
assert.equal(positionAt(resumed, T0 + 105_000), 47_000);

// A session left playing overnight reports the end of the track, not the middle
// of next Tuesday.
assert.equal(positionAt(first, T0 + 10 * 60 * 60 * 1000), 180_000);

// A change that is not about the transport must not move the transport. This is
// the freeze bug: re-stamping without recomputing the position rewinds the
// track by however long it had been playing. A pasted link has neither a title
// nor a length until somebody's player says so, which is when this happens.
const pasted = apply(
  null,
  { kind: 'add', track: { ...track('a'), title: '', durationMs: 0 } },
  'ana',
  T0,
)!;
const named = apply(pasted, { kind: 'meta', trackId: 'a', title: 'Real Title', durationMs: 200_000 }, 'ben', T0 + 52_000)!;
assert.equal(positionAt(named, T0 + 52_000), 52_000);
assert.equal(named.queue[0]!.durationMs, 200_000);
assert.equal(named.queue[0]!.title, 'Real Title');

// --- Two people pressing things ---------------------------------------------

// Every change is ordered by the gateway, so a client can drop its own echo of
// an older state and keep the newer one somebody else caused.
assert.equal(resumed.rev > paused.rev, true);
assert.equal(paused.rev > first.rev, true);
assert.equal(named.byUserId, 'ben');
assert.equal(paused.byUserId, 'ben');
assert.equal(resumed.byUserId, 'ben');

// First answer holds. A second client reporting a different title is either a
// different regional cut or somebody relabelling a track in everybody else's
// queue after the fact - either way, not a correction worth taking.
assert.equal(
  apply(named, { kind: 'meta', trackId: 'a', title: 'Something Else' }, 'cat', T0 + 53_000)!.queue[0]!.title,
  'Real Title',
);
assert.equal(
  apply(named, { kind: 'meta', trackId: 'a', durationMs: 999_000 }, 'cat', T0 + 53_000)!.queue[0]!.durationMs,
  200_000,
);
// And metadata for a track nobody here has is about a queue somebody else holds.
assert.equal(apply(named, { kind: 'meta', trackId: 'nope', title: 'x' }, 'cat', T0 + 54_000), named);

// A change that changes nothing is not a change: no rev, so nobody's player is
// disturbed by a message that arrived late.
const again = apply(named, { kind: 'meta', trackId: 'a', durationMs: 200_000 }, 'cat', T0 + 55_000)!;
assert.equal(again.rev, named.rev);
assert.equal(again, named);

// --- The queue --------------------------------------------------------------

let queued = apply(first, { kind: 'add', track: track('b') }, 'ben', T0 + 1_000)!;
queued = apply(queued, { kind: 'add', track: track('c') }, 'ben', T0 + 2_000)!;
assert.equal(queued.queue.length, 3);
// Adding does not interrupt what is playing.
assert.equal(queued.index, 0);
assert.equal(positionAt(queued, T0 + 2_000), 2_000);

// Removing something further down the queue leaves the needle exactly alone.
const trimmed = apply(queued, { kind: 'remove', trackId: 'c' }, 'ana', T0 + 3_000)!;
assert.equal(trimmed.index, 0);
assert.equal(positionAt(trimmed, T0 + 3_000), 3_000);

// Removing something *above* the needle shifts the cursor with it, so the same
// track goes on playing rather than the list sliding out from under it.
const jumped = apply(queued, { kind: 'play', index: 2 }, 'ana', T0 + 4_000)!;
assert.equal(jumped.index, 2);
const shifted = apply(jumped, { kind: 'remove', trackId: 'a' }, 'ana', T0 + 5_000)!;
assert.equal(shifted.index, 1);
assert.equal(shifted.queue[shifted.index]!.id, 'c');

// Removing what is playing moves to whatever took its place.
const replaced = apply(queued, { kind: 'remove', trackId: 'a' }, 'ana', T0 + 6_000)!;
assert.equal(replaced.queue[replaced.index]!.id, 'b');
assert.equal(replaced.positionMs, 0);

// Emptying the queue closes the session: a cursor into nothing is not a state.
let draining: ListenSession | null = first;
draining = apply(draining, { kind: 'remove', trackId: 'a' }, 'ana', T0 + 7_000);
assert.equal(draining, null);

// The ceiling holds, and holds without throwing away the session.
let full: ListenSession = first;
for (let index = 0; index < MAX_QUEUE + 10; index += 1) {
  full = apply(full, { kind: 'add', track: track(`x${index}`) }, 'ana', T0)!;
}
assert.equal(full.queue.length, MAX_QUEUE);

// --- Skipping ---------------------------------------------------------------

// Back within the first few seconds is "the previous track"; later it is
// "start this one again", which is what every music player does.
const onSecond = apply(queued, { kind: 'play', index: 1 }, 'ana', T0 + 10_000)!;
assert.equal(apply(onSecond, { kind: 'skip', delta: -1 }, 'ana', T0 + 12_000)!.index, 0);
assert.equal(apply(onSecond, { kind: 'skip', delta: -1 }, 'ana', T0 + 20_000)!.index, 1);
assert.equal(positionAt(apply(onSecond, { kind: 'skip', delta: -1 }, 'ana', T0 + 20_000)!, T0 + 20_000), 0);

// Running off the end stops at the end. It does not close the session: the
// queue two people built is not rubbish the moment the last track finishes.
const atEnd = apply(queued, { kind: 'skip', delta: 9 }, 'ana', T0 + 30_000)!;
assert.equal(atEnd.index, queued.queue.length - 1);
assert.equal(atEnd.paused, true);

// Running off the front rewinds rather than wrapping round to the end.
const atStart = apply(queued, { kind: 'skip', delta: -9 }, 'ana', T0 + 30_000)!;
assert.equal(atStart.index, 0);
assert.equal(atStart.paused, false);

// --- `ended`, which every client sends --------------------------------------

// Three people in the call means three of these. The first advances; the rest
// are about a track that is no longer playing and do nothing. Without this the
// three-person call skips three tracks and everybody blames somebody else.
const done = apply(queued, { kind: 'ended', trackId: 'a' }, 'ana', T0 + 180_000)!;
assert.equal(done.index, 1);
const twice = apply(done, { kind: 'ended', trackId: 'a' }, 'ben', T0 + 180_100)!;
assert.equal(twice.index, 1);
assert.equal(twice.rev, done.rev);
const thrice = apply(twice, { kind: 'ended', trackId: 'a' }, 'cat', T0 + 180_200)!;
assert.equal(thrice.index, 1);

// A paused session does not advance on a late `ended`.
const pausedThenEnded = apply(
  apply(queued, { kind: 'pause', positionMs: 179_000 }, 'ana', T0 + 179_000)!,
  { kind: 'ended', trackId: 'a' },
  'ben',
  T0 + 180_000,
)!;
assert.equal(pausedThenEnded.index, 0);

// --- Seeking ----------------------------------------------------------------

const sought = apply(queued, { kind: 'seek', positionMs: 60_000 }, 'ben', T0 + 30_000)!;
assert.equal(positionAt(sought, T0 + 30_000), 60_000);
assert.equal(sought.paused, false);
// Still running from there.
assert.equal(positionAt(sought, T0 + 35_000), 65_000);
// Past the end of a track whose length is known is clamped to the end, and
// negative nonsense is clamped to the start.
assert.equal(apply(queued, { kind: 'seek', positionMs: 9_999_999 }, 'ben', T0)!.positionMs, 180_000);
assert.equal(apply(queued, { kind: 'seek', positionMs: -5_000 }, 'ben', T0)!.positionMs, 0);
assert.equal(apply(queued, { kind: 'seek', positionMs: Number.NaN }, 'ben', T0)!.positionMs, 0);

// --- Stopping ---------------------------------------------------------------

assert.equal(apply(queued, { kind: 'stop' }, 'ana', T0), null);

// --- What may be put in front of other people -------------------------------

// The ref goes into an iframe URL in everybody's window, so it is checked
// against the provider's own alphabet rather than trusted.
assert.equal(sanitiseTrack(track('a', 'dQw4w9WgXcQ'))?.ref, 'dQw4w9WgXcQ');
assert.equal(sanitiseTrack(track('a', '../../evil')), null);
assert.equal(sanitiseTrack(track('a', 'a')), null);
assert.equal(sanitiseTrack(track('a', 'x'.repeat(64))), null);
assert.equal(sanitiseTrack({ ...track('a'), provider: 'spotify' as never }), null);

// A title is drawn in other people's windows, so it is bounded.
assert.equal(sanitiseTrack({ ...track('a'), title: 'x'.repeat(5_000) })!.title.length, 200);

// A duration nobody can justify makes the seek bar meaningless for everybody.
assert.equal(sanitiseTrack({ ...track('a'), durationMs: -1 })!.durationMs, 0);
assert.equal(sanitiseTrack({ ...track('a'), durationMs: Number.POSITIVE_INFINITY })!.durationMs, 0);
assert.equal(sanitiseTrack({ ...track('a'), durationMs: 1e12 })!.durationMs, 12 * 60 * 60 * 1000);

// And a rejected track never becomes a session.
assert.equal(apply(null, { kind: 'add', track: track('a', '!!') }, 'ana', T0), null);

console.log('call-service listen-session self-check passed');
