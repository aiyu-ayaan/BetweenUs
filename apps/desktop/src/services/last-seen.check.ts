/** Run with `tsx src/services/last-seen.check.ts`. The line under a name. */
import assert from 'node:assert/strict';
import { lastSeenLabel, presenceLine, profilePresence } from './last-seen';

const now = new Date(2026, 7, 29, 15, 30); // Saturday 29 August 2026, 15:30 local
const at = (y: number, m: number, d: number, h = 12, min = 0): string =>
  new Date(y, m - 1, d, h, min).toISOString();

// --- nothing to say ----------------------------------------------------------

assert.equal(lastSeenLabel(null, now), null, 'never seen draws no line at all');
assert.equal(lastSeenLabel(undefined, now), null);
assert.equal(lastSeenLabel('not a date', now), null, 'a bad value is not a line');

// --- every line carries the time ---------------------------------------------

// This is the whole point of the line: "yesterday" alone does not answer the
// question anybody actually has about somebody who is not here.
for (const when of [
  at(2026, 8, 29, 9, 14),
  at(2026, 8, 28, 23, 55),
  at(2026, 8, 24, 8, 5),
  at(2026, 8, 22, 19, 7),
  at(2025, 3, 4, 6, 30),
]) {
  assert.match(lastSeenLabel(when, now) ?? '', / at /, `${when} must carry a clock time`);
}

// A clock a few minutes ahead of the server's is ordinary, and "last seen in
// four minutes" is not a sentence: it is clamped to now instead.
assert.equal(
  lastSeenLabel(at(2026, 8, 29, 15, 34), now),
  lastSeenLabel(at(2026, 8, 29, 15, 30), now),
  'a timestamp in the future reads as this moment, not as the future',
);

// --- today and yesterday name themselves -------------------------------------

assert.match(lastSeenLabel(at(2026, 8, 29, 9, 14), now) ?? '', /^last seen today at /);
assert.match(lastSeenLabel(at(2026, 8, 28, 23, 55), now) ?? '', /^last seen yesterday at /);
// Local midnight, not 24 hours: 00:05 today is today however few minutes ago.
assert.match(lastSeenLabel(at(2026, 8, 29, 0, 5), now) ?? '', /^last seen today at /);
assert.match(
  lastSeenLabel(at(2026, 8, 28, 20, 0), now) ?? '',
  /^last seen yesterday at /,
  'under 24 hours ago but on the previous local day is yesterday',
);

// --- the week just gone, then the date ---------------------------------------

assert.match(lastSeenLabel(at(2026, 8, 24), now) ?? '', /^last seen Monday at /);

// Seven days back is the same weekday as today, so it must not say "Saturday".
const week = lastSeenLabel(at(2026, 8, 22), now) ?? '';
assert.equal(week.includes('Saturday'), false, 'a week back must not read as a weekday');
assert.match(week, /August/, 'it names the date instead');
assert.match(week, / at /, 'and still says what time of day it was');

// A different year carries the year; this one does not need to.
assert.equal((lastSeenLabel(at(2026, 3, 4), now) ?? '').includes('2026'), false);
assert.equal((lastSeenLabel(at(2025, 3, 4), now) ?? '').includes('2025'), true);

// --- and the clock is the one on the reader's wall ----------------------------

// 19:07 in the reader's zone renders as the reader's own 7:07 PM, whatever zone
// it was sent from - every timestamp is UTC on the wire and local on the screen.
assert.match(lastSeenLabel(at(2026, 8, 28, 19, 7), now) ?? '', /yesterday at 7:07/);

// --- status wins over the timestamp ------------------------------------------

assert.equal(presenceLine('online', at(2026, 8, 24), now), 'online');
assert.equal(
  presenceLine('idle', at(2026, 8, 24), now),
  'online',
  'the dot says idle; the line says whether a message will be read',
);
assert.equal(presenceLine('dnd', null, now), 'online');
assert.match(presenceLine('offline', at(2026, 8, 28, 23, 55), now) ?? '', /^last seen yesterday/);
assert.equal(presenceLine('offline', null, now), null, 'offline and never seen is no line');

// --- a card always says something --------------------------------------------

// The bug this exists for: offline with no timestamp drew nothing at all, so a
// profile card opened on a new account - or on somebody whose last seen is
// hidden from you - had a blank where the status belongs and read as broken.
assert.equal(profilePresence('offline', null, now), 'Offline');
assert.equal(profilePresence('offline', undefined, now), 'Offline');
assert.equal(profilePresence('offline', 'not a date', now), 'Offline');

// With a timestamp it is the sentence, capitalised for a card.
assert.match(profilePresence('offline', at(2026, 8, 28, 23, 55), now), /^Last seen yesterday at /);

// And unlike the header, a card spells out which kind of "here" this is - the
// dot beside it is the only other thing that says.
assert.equal(profilePresence('online', null, now), 'Online');
assert.equal(profilePresence('idle', null, now), 'Idle');
assert.equal(profilePresence('dnd', null, now), 'Do not disturb');
assert.equal(profilePresence('invisible', null, now), 'Invisible');

// A status other than offline wins over any timestamp, exactly as in a header.
assert.equal(profilePresence('online', at(2026, 8, 24), now), 'Online');

// Never empty, for any combination. That is the whole contract.
for (const status of ['online', 'idle', 'dnd', 'invisible', 'offline'] as const) {
  for (const seen of [null, undefined, 'nonsense', at(2026, 8, 24)]) {
    assert.ok(profilePresence(status, seen, now).length > 0, `${status}/${seen} must say something`);
  }
}

console.log('last-seen: ok');
