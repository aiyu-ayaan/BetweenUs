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
 * Days are the reader's local days, not UTC ones: a message sent at 00:30 here
 * belongs under today's divider even where the server called it yesterday.
 * `Android`'s `Day.kt` is the same rule against `LocalDate`; if one changes, so
 * does the other.
 */

/** Local midnight of the day `iso` falls in, as epoch milliseconds. */
function startOfDay(iso: string | Date): number {
  const at = new Date(iso);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** Whether two timestamps fall on the same local day. */
export function sameDay(a: string, b: string): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** The divider's words for the day `iso` falls in. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(iso)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const at = new Date(iso);
  // Inside the week just gone a weekday names the day on its own; past that it
  // would name two different days, so the date takes over.
  if (days > 1 && days < 7) return at.toLocaleDateString([], { weekday: 'long' });
  return at.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}
