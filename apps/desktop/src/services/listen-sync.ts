/**
 * Keeping two players in step, on two machines that disagree about the time.
 *
 * The gateway says where a track was and when. Turning that into "seek to here,
 * now" needs two things this file provides.
 *
 * **A shared clock.** Two machines' clocks differ by whatever their NTP daemons
 * last settled on - usually milliseconds, occasionally seconds, and on a laptop
 * that woke from sleep, whatever it feels like until the next sync. A session
 * that trusted `Date.now()` on both ends would be exactly as far out of step as
 * the clocks are, and neither person could tell why. So the client measures its
 * own offset against the gateway's clock, the way NTP does, and every position
 * is read on that.
 *
 * **A tolerance.** A player is not an oscillator: it buffers, it rebuffers, it
 * decodes at whatever rate the machine manages, and it drifts. Correcting every
 * few milliseconds of that would mean seeking constantly, and a seek is a gap
 * in the music - the cure being far worse than the disease. So drift is left
 * alone until it is large enough that a person would notice it, and then it is
 * fixed in one jump.
 *
 * What this deliberately does *not* do is nudge `playbackRate` to close small
 * gaps smoothly. It is the textbook answer and it does not work here: the
 * YouTube embed quantises playback rate to the handful of values in its own
 * menu, so a request for 1.04 is either refused or rounded to 1.25, which is a
 * chipmunk rather than a correction. See `youtube.ts`.
 */
import { listenPositionAt, type ListenSession } from '@betweenus/shared-types';

/**
 * How far out a player may drift before it is pulled back.
 *
 * A second and a half. Below that the two of you are listening to the same
 * thing and the difference is smaller than the gap between two speakers in one
 * room; above it, somebody says "this bit" and the other person has already
 * heard it. Tightening this does not make the feature better - it makes it seek
 * every few minutes, which is the one thing that is unambiguously worse than
 * being slightly out.
 */
export const DRIFT_TOLERANCE_MS = 1_500;

/** How often a client checks itself against the shared position. */
export const DRIFT_CHECK_MS = 5_000;

/** How often the clock offset is re-measured, on the call socket's own ping. */
export const CLOCK_SAMPLE_MS = 15_000;

/** How many measurements are kept when choosing the least-delayed one. */
export const CLOCK_SAMPLES = 8;

export interface ClockSample {
  /** `Date.now()` when the ping went out. */
  sentAtMs: number;
  /** `Date.now()` when the pong came back. */
  receivedAtMs: number;
  /** The gateway's own clock, as it stamped the pong. */
  serverMs: number;
}

/**
 * How far this machine's clock is behind the gateway's, from one measurement.
 *
 * The gateway stamped the pong somewhere between the ping leaving and the pong
 * arriving. With no way to know where in that window, the midpoint is the
 * estimate - which is exactly NTP's, and is wrong by at most half the asymmetry
 * of the round trip.
 */
export function offsetOf(sample: ClockSample): number {
  const roundTrip = sample.receivedAtMs - sample.sentAtMs;
  return sample.serverMs + roundTrip / 2 - sample.receivedAtMs;
}

/**
 * The best offset out of several measurements: the one from the fastest round
 * trip.
 *
 * Not the average. A slow round trip is slow because something queued, and a
 * queue is almost never symmetric - so a delayed sample is not noisier than a
 * fast one, it is *biased*, and averaging spreads that bias over the answer.
 * The least-delayed sample had the least room to be wrong. NTP picks the same
 * way, for the same reason.
 */
export function bestOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  let best = samples[0]!;
  for (const sample of samples) {
    if (sample.receivedAtMs - sample.sentAtMs < best.receivedAtMs - best.sentAtMs) best = sample;
  }
  return offsetOf(best);
}

/**
 * This client's read of the gateway's clock.
 *
 * Starts at zero offset, which is what an unmeasured clock is worth and is also
 * the right answer for the overwhelmingly common case of two machines that both
 * keep time. The first pong replaces it.
 */
export class ServerClock {
  private readonly samples: ClockSample[] = [];
  private offsetMs = 0;

  sample(sample: ClockSample): void {
    this.samples.push(sample);
    if (this.samples.length > CLOCK_SAMPLES) this.samples.shift();
    this.offsetMs = bestOffset(this.samples);
  }

  /** The gateway's clock, as best this client can tell. */
  now(): number {
    return Date.now() + this.offsetMs;
  }

  offset(): number {
    return this.offsetMs;
  }
}

/**
 * How far this player is from where the call says it should be.
 *
 * Positive means behind - the rest of the call has heard something this player
 * has not reached yet.
 */
export function driftOf(session: ListenSession, serverNowMs: number, actualMs: number): number {
  return listenPositionAt(session, serverNowMs) - actualMs;
}

/**
 * Where to seek to, or null to leave the player alone.
 *
 * The target is read at the moment of the decision rather than reused from the
 * drift measurement, because a seek is not instant and the track keeps moving
 * while it happens - seeking to where the call *was* is how a correction lands
 * a fraction behind and immediately needs another.
 */
export function correction(
  session: ListenSession,
  serverNowMs: number,
  actualMs: number,
): number | null {
  if (session.paused) {
    // Paused, everybody is at one number and there is no tolerance to spend:
    // two people staring at a stopped track that says different things is the
    // most obviously broken this can look.
    const target = session.positionMs;
    return Math.abs(target - actualMs) > 250 ? target : null;
  }
  const drift = driftOf(session, serverNowMs, actualMs);
  if (Math.abs(drift) <= DRIFT_TOLERANCE_MS) return null;
  return listenPositionAt(session, serverNowMs);
}

/** `4:07`, or `1:02:07` for the long ones. */
export function formatPosition(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
