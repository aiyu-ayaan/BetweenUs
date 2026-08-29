/** Run with `tsx src/features/chat/day.check.ts`. The message list's date dividers. */
import assert from 'node:assert/strict';
import { clockTime, dayLabel, sameDay } from './day';

/** A local timestamp, so the cases read as the reader's own clock does. */
const at = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

const now = new Date(2026, 7, 29, 15, 30); // Saturday 29 August 2026

// --- the two days that get names ---------------------------------------------

assert.equal(dayLabel(at(2026, 8, 29, 9, 14), now), 'Today');
assert.equal(dayLabel(at(2026, 8, 29, 0, 5), now), 'Today', 'just past midnight is still today');
assert.equal(dayLabel(at(2026, 8, 28, 23, 55), now), 'Yesterday');

// --- the week just gone ------------------------------------------------------

// A weekday only names one day while less than a week has passed.
assert.equal(dayLabel(at(2026, 8, 24), now), 'Monday');
assert.equal(dayLabel(at(2026, 8, 23), now), 'Sunday');

// --- and past that, the date -------------------------------------------------

// Seven days back is the same weekday as today, so it must not say "Saturday".
const week = dayLabel(at(2026, 8, 22), now);
assert.equal(week.includes('Saturday'), false, 'a week back must not read as a weekday');
assert.equal(week.includes('2026'), true, 'a week back carries the year');
assert.equal(dayLabel(at(2025, 3, 4), now).includes('2025'), true);

// --- where the dividers go ---------------------------------------------------

assert.equal(sameDay(at(2026, 8, 29, 0, 1), at(2026, 8, 29, 23, 59)), true);
// Two minutes apart, either side of midnight: one run of messages to the
// grouping rule, two days to the reader, and the divider is what says so.
assert.equal(sameDay(at(2026, 8, 28, 23, 59), at(2026, 8, 29, 0, 1)), false);

// --- the clock ---------------------------------------------------------------

// The locale decides 12 or 24 hour and the separator, so the shape is what is
// checked rather than the exact string: an hour, minutes always two digits, and
// nothing else but an optional AM/PM.
const noon = clockTime(at(2026, 8, 29, 14, 5));
assert.match(noon, /^\d{1,2}[:.]\d{2}(\s?[AaPp]\.?[Mm]\.?)?$/u, `unexpected clock time: ${noon}`);
// It is the reader's wall clock, whatever the locale writes it as.
assert.equal(noon.includes('05'), true, 'the minutes are the ones that were sent');

// --- the sender's zone is never the reader's ---------------------------------

// The wire carries UTC; everything here is read in the reader's own zone. A
// message sent at half past midnight local time is *yesterday* in UTC anywhere
// east of Greenwich, and it still belongs under today's divider.
const halfPastMidnight = new Date(2026, 7, 29, 0, 30);
const asSent = halfPastMidnight.toISOString();
assert.equal(dayLabel(asSent, now), 'Today', "the reader's day, not the wire's");
assert.equal(sameDay(asSent, at(2026, 8, 29, 23, 0)), true);
// And an instant is one instant however it is written down.
assert.equal(clockTime(asSent), clockTime(halfPastMidnight.toISOString()));

console.log('day.check.ts ok');
