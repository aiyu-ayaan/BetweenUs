/**
 * Listen Together: the shared transport, as one pure function.
 *
 * A listening session is a queue, a cursor into it, and an answer to "where is
 * the needle right now". The last of those is the only interesting part,
 * because "right now" is different on every machine in the call.
 *
 * The trick is that the session never stores a position. It stores a position
 * *and the instant it was true* - `positionMs` at `atServerMs` - so a client
 * that receives one message can work out the position at any later moment
 * without another message arriving. Playing is `positionMs + elapsed`; paused
 * is `positionMs`. One state, good until somebody presses something.
 *
 * Everything here is pure and takes `nowMs`, so the whole of it is testable
 * without a socket, a clock or a call. See `listen-session.check.ts` - the
 * failures this guards against are the ones that only appear as "the music is
 * two seconds behind on your machine and neither of us can prove it".
 *
 * Note what is *not* here: no persistence, no database, no history. A session
 * lives in memory beside the roster and dies with the call, which is what it
 * is - the queue three people built while they worked has no meaning tomorrow.
 *
 * ponytail: in process, exactly like `CallGateway.calls`. Two call-service
 * replicas would each hold half a session, and the upgrade path is the same
 * one - the roster in Redis, this state beside it.
 */
import type { ListenSession, ListenTrack } from '@betweenus/shared-types';

/**
 * How long a queue may get.
 *
 * Not a resource limit - a hundred entries is a few kilobytes. It is a limit on
 * what one person can do to everybody else's screen, because the queue is
 * broadcast to the whole call and every entry carries a title somebody chose.
 */
export const MAX_QUEUE = 100;

/** Titles are drawn in other people's windows, so they are bounded here. */
export const MAX_TITLE = 200;

/** What a client asked for, once the gateway has decided who asked. */
export type ListenAction =
  | { kind: 'add'; track: ListenTrack }
  | { kind: 'remove'; trackId: string }
  | { kind: 'play'; index?: number }
  | { kind: 'pause'; positionMs: number }
  | { kind: 'seek'; positionMs: number }
  | { kind: 'skip'; delta: number }
  | { kind: 'ended'; trackId: string }
  | { kind: 'duration'; trackId: string; durationMs: number }
  | { kind: 'stop' };

/**
 * Where the needle is at `nowMs`.
 *
 * Clamped to the track's length once one is known, so a session left playing
 * while everybody was away does not report a position in the next hour.
 */
export function positionAt(session: ListenSession, nowMs: number): number {
  const elapsed = session.paused ? 0 : Math.max(0, nowMs - session.atServerMs);
  const raw = session.positionMs + elapsed;
  const track = session.queue[session.index];
  const duration = track?.durationMs ?? 0;
  return duration > 0 ? Math.min(raw, duration) : Math.max(0, raw);
}

/**
 * Re-stamps a session at `nowMs` without changing what it is doing.
 *
 * Every mutation goes through this first. Skipping it is the bug that made a
 * session freeze on a title change: writing a new `atServerMs` while leaving
 * `positionMs` as it was an hour ago rewinds the track by an hour, and doing it
 * the other way - a new position under an old stamp - runs it forward by one.
 */
function restamp(session: ListenSession, nowMs: number): ListenSession {
  return { ...session, positionMs: positionAt(session, nowMs), atServerMs: nowMs };
}

/** Trims what a client supplied down to what may be shown to other people. */
export function sanitiseTrack(track: ListenTrack): ListenTrack | null {
  if (track.provider !== 'youtube') return null;
  // The provider's own alphabet. Anything else is either a typo or an attempt
  // to put a URL of somebody's choosing into an iframe in everybody's window.
  if (!/^[A-Za-z0-9_-]{6,24}$/.test(track.ref)) return null;
  return {
    ...track,
    title: track.title.slice(0, MAX_TITLE),
    durationMs: clampDuration(track.durationMs),
  };
}

function clampDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  // Twelve hours. Long enough for the longest thing anybody queues on purpose,
  // short enough that a nonsense number cannot make the seek bar meaningless.
  return Math.min(Math.round(durationMs), 12 * 60 * 60 * 1000);
}

function clampPosition(session: ListenSession, positionMs: number): number {
  if (!Number.isFinite(positionMs) || positionMs < 0) return 0;
  const duration = session.queue[session.index]?.durationMs ?? 0;
  return duration > 0 ? Math.min(Math.round(positionMs), duration) : Math.round(positionMs);
}

/**
 * Moves the cursor, and says what that means for the transport.
 *
 * Running off the end stops at the end rather than closing the session: the
 * queue is a thing two people built together, and the last track finishing is
 * not a reason to throw it away. Running off the front is a rewind to the start
 * of the first track, which is what pressing "previous" twice means everywhere.
 */
function move(session: ListenSession, to: number, nowMs: number): ListenSession {
  if (to < 0) return { ...session, index: 0, positionMs: 0, atServerMs: nowMs, paused: false };
  if (to >= session.queue.length) {
    const last = session.queue.length - 1;
    return {
      ...session,
      index: last,
      positionMs: session.queue[last]?.durationMs ?? 0,
      atServerMs: nowMs,
      paused: true,
    };
  }
  return { ...session, index: to, positionMs: 0, atServerMs: nowMs, paused: false };
}

/**
 * Applies one action. Returns the new session, or null when there is no longer
 * one - which is what the call is told, and what closes everybody's player.
 *
 * `session` being null and the action being `add` is how a session starts:
 * there is no "open a session" button, because a person who wants to listen
 * together wants to play something, and asking them to do two things first is
 * a step that exists only for the benefit of the state machine.
 */
export function apply(
  session: ListenSession | null,
  action: ListenAction,
  actorUserId: string,
  nowMs: number,
): ListenSession | null {
  if (action.kind === 'stop') return null;

  if (!session) {
    if (action.kind !== 'add') return null;
    const track = sanitiseTrack(action.track);
    if (!track) return session;
    return {
      rev: 1,
      queue: [track],
      index: 0,
      paused: false,
      positionMs: 0,
      atServerMs: nowMs,
      byUserId: actorUserId,
    };
  }

  // Compared against the *stamped* session, not the one that came in: restamping
  // always makes a new object, so `next === session` was never true and every
  // late `duration` bumped the rev and made every client re-seek for nothing.
  const stamped = restamp(session, nowMs);
  const next = mutate(stamped, action, nowMs);
  if (!next) return null;
  // Unchanged means nobody is told: a `duration` for a track that already had
  // one, or an `ended` for a track that is no longer playing, is a message that
  // arrived late rather than a thing that happened.
  if (next === stamped) return session;
  return { ...next, rev: session.rev + 1, byUserId: actorUserId };
}

function mutate(
  session: ListenSession,
  action: ListenAction,
  nowMs: number,
): ListenSession | null {
  switch (action.kind) {
    case 'add': {
      const track = sanitiseTrack(action.track);
      if (!track) return session;
      if (session.queue.length >= MAX_QUEUE) return session;
      return { ...session, queue: [...session.queue, track] };
    }

    case 'remove': {
      const at = session.queue.findIndex((track) => track.id === action.trackId);
      if (at === -1) return session;
      const queue = session.queue.filter((track) => track.id !== action.trackId);
      // The last one out closes the session, which is the only way an empty
      // queue can be described: a cursor into nothing is not a state.
      if (queue.length === 0) return null;
      if (at > session.index) return { ...session, queue };
      // Removing something before the cursor shifts the cursor with it, so the
      // track playing goes on playing - it is the same track, at the same
      // position, one place further up the list.
      if (at < session.index) return { ...session, queue, index: session.index - 1 };
      // Removing what is playing moves to whatever took its place, or to the
      // new end of the queue when it was the last entry.
      return move({ ...session, queue }, Math.min(session.index, queue.length - 1), nowMs);
    }

    case 'play': {
      if (action.index === undefined) return { ...session, paused: false };
      if (action.index < 0 || action.index >= session.queue.length) return session;
      // Jumping to the track already playing is a resume, not a restart: a
      // double-click on the current row should not lose everybody's place.
      if (action.index === session.index) return { ...session, paused: false };
      return move(session, action.index, nowMs);
    }

    case 'pause':
      return { ...session, paused: true, positionMs: clampPosition(session, action.positionMs) };

    case 'seek':
      return { ...session, positionMs: clampPosition(session, action.positionMs) };

    case 'skip': {
      const delta = Math.trunc(action.delta);
      if (delta === 0) return session;
      // Skipping back within the first few seconds of a track means "the
      // previous one"; later it means "start this one again", which is what
      // every music player does and what everybody's hands already expect.
      if (delta < 0 && positionAt(session, nowMs) > 3000) return move(session, session.index, nowMs);
      return move(session, session.index + delta, nowMs);
    }

    case 'ended': {
      // Late, or from a client whose player ran ahead. Everybody sends this;
      // only the first one that is about the track actually playing counts.
      if (session.queue[session.index]?.id !== action.trackId) return session;
      if (session.paused) return session;
      return move(session, session.index + 1, nowMs);
    }

    case 'duration': {
      const durationMs = clampDuration(action.durationMs);
      if (durationMs === 0) return session;
      const at = session.queue.findIndex((track) => track.id === action.trackId);
      if (at === -1 || session.queue[at]!.durationMs === durationMs) return session;
      const queue = [...session.queue];
      queue[at] = { ...queue[at]!, durationMs };
      return { ...session, queue };
    }

    default:
      return session;
  }
}
