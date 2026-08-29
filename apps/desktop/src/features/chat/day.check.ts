/** Run with `tsx src/features/chat/day.check.ts`. The message list's date dividers. */
import assert from 'node:assert/strict';
import { dayLabel, sameDay } from './day';

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

console.log('day.check.ts ok');
