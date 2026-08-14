/**
 * One call per account, across every device it is signed in on.
 *
 * A peer id is per socket - two windows really are two ends of two different
 * peer connections - but a *person* may only be in one call at a time, so
 * joining on a second device has to take the call off the first rather than put
 * the same person in the room twice with two live microphones.
 *
 * Kept out of the gateway and generic over the socket type so it can be checked
 * without a WebSocket server, which is the only part of this rule that can go
 * quietly wrong: a scan that finds nobody looks exactly like a rule that is off.
 */

/**
 * Every connection of `userId` currently in a call, except `except`.
 *
 * Rosters are scanned rather than a second index kept per user: there is one
 * small set per live call in this process, and the caller is about to drop each
 * result from the set it was found in - which is why this returns an array
 * rather than iterating lazily over collections that are about to change.
 *
 * ponytail: in-process, like the rosters themselves. It stops being true the
 * moment there are two call-service replicas, and it is fixed by exactly the
 * move that fixes the roster - keeping both in Redis.
 */
export function otherDevicesInCall<S>(
  calls: Iterable<Set<S>>,
  userIdOf: (socket: S) => string | undefined,
  userId: string,
  except: S,
): S[] {
  const found: S[] = [];
  for (const members of calls) {
    for (const member of members) {
      if (member === except) continue;
      if (userIdOf(member) === userId) found.push(member);
    }
  }
  return found;
}
