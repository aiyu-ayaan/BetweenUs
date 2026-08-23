/**
 * How often one person may ring another.
 *
 * A ring is the loudest thing this app can do to somebody: it takes a phone
 * out of Doze, lights the screen over the lock and plays a ringtone. Every
 * other push obeys a mute the recipient set; this one is allowed past the
 * quiet ones on purpose, because it was aimed at them by a person.
 *
 * So the recipient's preferences cannot be the only brake, and the brake here
 * is the simplest one that works: the same pair cannot ring again until the
 * ring they already sent has stopped mattering. Declining is honoured on the
 * client - a declined channel stays quiet until the call ends - and this is
 * what stops somebody simply pressing the button forty times.
 *
 * Pure, and tested, because a cooldown that is wrong in either direction is
 * invisible: too short and it is not a cooldown, too long and calling somebody
 * back after they hung up silently does nothing.
 */

/**
 * Seconds. Long enough that pressing the button again is a decision rather
 * than a reflex, short enough that ringing back after a missed call works.
 */
export const RING_COOLDOWN_MS = 30_000;

/** The key a pair of people share. Direction matters: a ring back is not a repeat. */
export function ringKey(callerId: string, targetId: string): string {
  return `${callerId}>${targetId}`;
}

/**
 * Whether this ring may go, given when the last one did.
 *
 * `undefined` is "never rung", which is always allowed. `now` is passed in so
 * the decision is a function of its inputs rather than of the clock.
 */
export function ringIsAllowed(lastRingAt: number | undefined, now: number): boolean {
  if (lastRingAt === undefined) return true;
  return now - lastRingAt >= RING_COOLDOWN_MS;
}
