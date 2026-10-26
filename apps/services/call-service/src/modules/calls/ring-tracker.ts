/**
 * What became of each ring that is still out, so the person who rang can be told.
 *
 * A ring used to be fire-and-forget, and the caller was deliberately told
 * nothing: a call to somebody who had said no looked exactly like one to
 * somebody whose phone was off, and the caller sat in an empty call with no
 * way to know which. Four things can happen to a ring and this is the one place
 * that sees all of them - it hears the ring and the decline, it is told about
 * the join, and it holds the clock:
 *
 * - `ringing`    the ring went out.
 * - `declined`   the person said no, on any device.
 * - `answered`   the person joined the call.
 * - `unanswered` forty-five seconds passed and none of the above happened.
 *
 * Each ring ends exactly once. A decline after an answer, or a join after the
 * timeout, is not news and is dropped - which is also what makes it safe to
 * call `answered` on every join, whether or not anybody was ringing.
 *
 * ponytail: in memory, like the cooldown beside it. A restart forgets the rings
 * that were out, and their callers see "ringing" until they hang up.
 */
import type { CallRingState } from '@betweenus/shared-types';

/** The clients stop ringing at the same number. See `push/lifetime.ts`. */
export const RING_TIMEOUT_MS = 45_000;

/** A little over the clients' own timer, so a ring that was answered in its last second still counts. */
const GRACE_MS = 2_000;

export interface RingOutcome {
  channelId: string;
  callerId: string;
  targetId: string;
  targetName: string;
  state: CallRingState;
}

interface Pending {
  callerId: string;
  targetName: string;
  timer: ReturnType<typeof setTimeout>;
}

export class RingTracker {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly emit: (outcome: RingOutcome) => void,
    private readonly timeoutMs: number = RING_TIMEOUT_MS + GRACE_MS,
  ) {}

  private key(channelId: string, targetId: string): string {
    return `${channelId}>${targetId}`;
  }

  /** A ring went out. A second ring to the same person replaces the first. */
  start(channelId: string, callerId: string, targetId: string, targetName: string): void {
    const key = this.key(channelId, targetId);
    const previous = this.pending.get(key);
    if (previous) clearTimeout(previous.timer);

    const timer = setTimeout(() => this.end(channelId, targetId, 'unanswered'), this.timeoutMs);
    // A pending ring must not be the thing keeping a process alive.
    timer.unref?.();
    this.pending.set(key, { callerId, targetName, timer });
    this.emit({ channelId, callerId, targetId, targetName, state: 'ringing' });
  }

  /** The person being rung said no. */
  declined(channelId: string, targetId: string): void {
    this.end(channelId, targetId, 'declined');
  }

  /** Somebody joined the call. Harmless if nobody was ringing them. */
  joined(channelId: string, userId: string): void {
    this.end(channelId, userId, 'answered');
  }

  /** How many rings are still out. For the check, and for nothing else. */
  get outstanding(): number {
    return this.pending.size;
  }

  private end(channelId: string, targetId: string, state: Exclude<CallRingState, 'ringing'>): void {
    const key = this.key(channelId, targetId);
    const ring = this.pending.get(key);
    if (!ring) return;
    clearTimeout(ring.timer);
    this.pending.delete(key);
    this.emit({
      channelId,
      callerId: ring.callerId,
      targetId,
      targetName: ring.targetName,
      state,
    });
  }
}
