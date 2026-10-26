/**
 * How long a push is worth delivering.
 *
 * Every push used to live for a day. That is right for a message - the badge on
 * the next launch says it better than a late buzz - and wrong for the ones that
 * are about *now*. A ring held by FCM for a phone that was off is a phone that
 * starts ringing hours later for a call nobody is on, and a decline that arrives
 * late is worse: the phone files the channel under "said no" and stays silent
 * for the next real call.
 */
import type { PushData } from '@betweenus/shared-types';

/** What a message, a friend request and every other push has always had. */
export const DEFAULT_LIFETIME_SECONDS = 60 * 60 * 24;

/**
 * How long a ring rings, on every client. The clients stop their own ringer at
 * the same number, so a push that outlives it can only be a ring for a call
 * the caller has already given up on.
 */
export const RING_SECONDS = 45;

/** "Somebody dealt with it elsewhere." Meaningful for as long as the ring was. */
export const HANDLED_SECONDS = 120;

/**
 * A call somebody can still join. Long enough for a phone that is waking from
 * Doze, short enough that the announcement is not stale when it lands.
 */
export const ROSTER_LIVE_SECONDS = 120;

export function lifetimeSeconds(data: PushData): number {
  switch (data.type) {
    case 'call.ring':
      return RING_SECONDS;
    case 'call.handled':
      return HANDLED_SECONDS;
    case 'call.roster':
      // An empty roster takes a notification away rather than putting one up,
      // and a phone that was away should still find out the call is over.
      return data.count === '0' ? DEFAULT_LIFETIME_SECONDS : ROSTER_LIVE_SECONDS;
    default:
      return DEFAULT_LIFETIME_SECONDS;
  }
}
