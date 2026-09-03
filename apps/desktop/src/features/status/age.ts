/**
 * How long ago a status was posted, in words.
 *
 * Its own function rather than `lastSeenLabel`: a status is never more than a
 * day old, so every branch that one has for weekdays and dates is unreachable
 * here, and the branches this one needs - minutes, then hours - are the ones
 * that reduce to "today at 7:07 PM" there. A reader glancing at a story tray
 * wants "12m ago", not the clock.
 *
 * `Android`'s `StatusAge.kt` is the same rule; if one changes, so does the
 * other.
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export function statusAge(iso: string, now: Date = new Date()): string {
  const posted = new Date(iso).getTime();
  if (Number.isNaN(posted)) return '';

  const elapsed = now.getTime() - posted;
  // A clock that is a little behind the server's puts a fresh post in the
  // future. "just now" is the honest answer; "-1m ago" is not.
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;

  const hours = Math.floor(elapsed / HOUR_MS);
  // Nothing here lives past 24 hours, so hours is where it stops. A post that
  // is somehow older is expired and about to be swept; saying "24h ago" is
  // better than a "1d ago" branch that exists for rows nobody can see.
  return `${hours}h ago`;
}
