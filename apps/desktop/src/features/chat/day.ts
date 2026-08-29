/**
 * Which day a message was sent, in words.
 *
 * A conversation read weeks later is a wall of times with no dates on it: the
 * clock says 09:14 and nothing says whether that was this morning or in March.
 * The divider between two days is what carries that, so the label only has to
 * name the day well enough to place it - "Today", "Yesterday", the weekday for
 * the week just gone, and the full date once a week has passed and the weekday
 * has stopped being unambiguous.
 *
 * Every timestamp on the wire is UTC (`toISOString()` on the services' side),
 * and everything here reads it in the reader's own zone: a message sent at 20:00
 * in Berlin is 23:30 to somebody in Kolkata, under that reader's day, and both
 * of them see their own clock. Nothing is ever rendered in the sender's zone or
 * in UTC - which is also why days are local days, so a message sent at 00:30
 * here belongs under today's divider even where the server called it yesterday.
 * `Android`'s `Day.kt` is the same rule against `LocalDate`; if one changes, so
 * does the other.
 */

import { serverNow } from '../../services/server-clock';

/** Local midnight of the day `iso` falls in, as epoch milliseconds. */
function startOfDay(iso: string | Date): number {
  const at = new Date(iso);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** Whether two timestamps fall on the same local day. */
export function sameDay(a: string, b: string): boolean {
  return startOfDay(a) === startOfDay(b);
}

/**
 * The divider's words for the day `iso` falls in.
 *
 * "Now" is the *server's* clock, not this machine's: a laptop whose clock is a
 * day out would otherwise file yesterday's conversation under "Today" and
 * today's under "Tomorrow", which reads as broken software rather than as a
 * wrong clock. See `services/server-clock.ts`.
 */
export function dayLabel(iso: string, now: Date = new Date(serverNow())): string {
  const days = Math.round((startOfDay(now) - startOfDay(iso)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const at = new Date(iso);
  // Inside the week just gone a weekday names the day on its own; past that it
  // would name two different days, so the date takes over.
  if (days > 1 && days < 7) return at.toLocaleDateString([], { weekday: 'long' });
  // `dateStyle` rather than a field list, so the order is the reader's own:
  // "22 August 2026" here, "August 22, 2026" there.
  return at.toLocaleDateString([], { dateStyle: 'long' });
}

/**
 * The clock time on a bubble, in whatever the reader's system says that is.
 *
 * `numeric` rather than `2-digit` on the hour is the whole point: a locale on a
 * 24-hour clock pads it anyway ("09:14"), and one on a 12-hour clock does not
 * ("9:14 AM"), which is what those readers' phones and every other app show.
 * Forcing two digits produced "09:14 AM", which is neither.
 */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
