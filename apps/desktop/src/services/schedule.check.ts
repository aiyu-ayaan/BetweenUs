/** Run with `tsx src/services/schedule.check.ts`. Scheduled sends and reminders. */
import assert from 'node:assert/strict';
import {
  LATE_GRACE_MS,
  MAX_ATTEMPTS,
  MAX_SLEEP_MS,
  afterFailure,
  checkDue,
  dueLabel,
  excerptOf,
  fireAt,
  isLate,
  nextWake,
  parseLocalDateTime,
  parseScheduled,
  readyAt,
  reminderNotice,
  rescheduled,
  resolvePreset,
  retryDelayMs,
  scheduleBlocker,
  sendingNow,
  sentNotice,
  stateOf,
  toLocalDateTime,
  worthRetrying,
  type Reminder,
  type ScheduledMessage,
} from './schedule';

const MINUTE = 60_000;

/** A local time, so the cases read the way the person's own clock does. */
const local = (y: number, m: number, d: number, h = 0, min = 0): Date =>
  new Date(y, m - 1, d, h, min, 0, 0);

// Wednesday 23 September 2026, 14:07:30 on this machine's clock.
const now = local(2026, 9, 23, 14, 7);
now.setSeconds(30);

// --- presets -------------------------------------------------------------------

// Relative presets round up to the whole minute, so the label is "14:38", not
// "14:37:30" drawn as 14:37 - which would read as a minute early.
assert.equal(resolvePreset('in-30-minutes', now), local(2026, 9, 23, 14, 38).getTime());
assert.equal(resolvePreset('in-20-minutes', now), local(2026, 9, 23, 14, 28).getTime());
assert.equal(resolvePreset('in-1-hour', now), local(2026, 9, 23, 15, 8).getTime());
assert.equal(resolvePreset('in-3-hours', now), local(2026, 9, 23, 17, 8).getTime());

// Wall-clock presets are nine in the morning on this machine's clock.
assert.equal(resolvePreset('tomorrow-morning', now), local(2026, 9, 24, 9).getTime());
assert.equal(
  resolvePreset('tomorrow-morning', local(2026, 12, 31, 23, 50)),
  local(2027, 1, 1, 9).getTime(),
  'tomorrow crosses a month and a year',
);

// The next Monday - and on a Monday, the one after, never this morning.
assert.equal(resolvePreset('monday-morning', now), local(2026, 9, 28, 9).getTime());
assert.equal(
  resolvePreset('monday-morning', local(2026, 9, 28, 7, 0)),
  local(2026, 10, 5, 9).getTime(),
  'Monday morning said on a Monday is next week',
);
assert.equal(
  resolvePreset('monday-morning', local(2026, 9, 27, 22, 0)),
  local(2026, 9, 28, 9).getTime(),
  'said on a Sunday night, it is tomorrow',
);

// A day that is 23 or 25 hours long still lands at nine. Whatever zone this
// runs in, "tomorrow morning" is nine on the local clock, never 8 or 10.
for (const [y, m, d] of [
  [2026, 3, 28],
  [2026, 3, 7],
  [2026, 10, 24],
  [2026, 10, 31],
] as const) {
  const evening = local(y, m, d, 20);
  const next = new Date(resolvePreset('tomorrow-morning', evening));
  assert.equal(next.getHours(), 9, `across a possible DST change on ${y}-${m}-${d}`);
  assert.equal(next.getDate(), local(y, m, d + 1).getDate());
}

// --- choosing a time ---------------------------------------------------------

const t = now.getTime();
assert.deepEqual(checkDue(t + 5 * MINUTE, t), { ok: true });
assert.equal(checkDue(t + 30_000, t).ok, false, 'under a minute is "send", not a schedule');
assert.equal(checkDue(t - MINUTE, t).ok, false, 'the past is refused');
assert.equal(checkDue(Number.NaN, t).ok, false);
assert.equal(checkDue(t + 400 * 24 * 60 * MINUTE, t).ok, false, 'more than a year out is refused');
{
  const refused = checkDue(t - MINUTE, t);
  assert.ok(!refused.ok && refused.reason === 'past' && refused.message.length > 0);
}

// The picker's value is local wall-clock time, and it goes back and forth.
assert.equal(parseLocalDateTime('2026-09-24T09:00'), local(2026, 9, 24, 9).getTime());
assert.equal(toLocalDateTime(local(2026, 9, 24, 9, 5).getTime()), '2026-09-24T09:05');
assert.equal(parseLocalDateTime(toLocalDateTime(t)), local(2026, 9, 23, 14, 7).getTime());
assert.equal(parseLocalDateTime(''), null);
assert.equal(parseLocalDateTime('2026-02-31T09:00'), null, 'a date that rolls over is not a date');
assert.equal(parseLocalDateTime('tomorrow'), null);

// --- the words ---------------------------------------------------------------

assert.ok(dueLabel(local(2026, 9, 23, 18).getTime(), now).startsWith('Today at '));
assert.ok(dueLabel(local(2026, 9, 24, 9).getTime(), now).startsWith('Tomorrow at '));
assert.ok(dueLabel(local(2026, 9, 22, 9).getTime(), now).startsWith('Yesterday at '));
assert.ok(!dueLabel(local(2026, 9, 26, 9).getTime(), now).startsWith('Today'));
assert.ok(dueLabel(local(2026, 11, 2, 9).getTime(), now).includes('2026'), 'past a week, the date');

// --- where an item stands ----------------------------------------------------

const message = (patch: Partial<ScheduledMessage> = {}): ScheduledMessage => ({
  kind: 'message',
  id: 's1',
  channelId: 'c1',
  serverId: 'v1',
  channelName: 'general',
  text: 'good morning',
  dueAt: t + 10 * MINUTE,
  createdAt: t,
  attempts: 0,
  retryAt: null,
  error: null,
  ...patch,
});

const reminder = (patch: Partial<Reminder> = {}): Reminder => ({
  kind: 'reminder',
  id: 'r1',
  channelId: 'c1',
  serverId: null,
  channelName: 'Ada',
  messageId: 'm1',
  author: 'Ada',
  excerpt: 'the numbers are in',
  dueAt: t + 20 * MINUTE,
  createdAt: t,
  ...patch,
});

assert.equal(stateOf(message(), t), 'waiting');
assert.equal(stateOf(message({ dueAt: t }), t), 'due');
assert.equal(stateOf(message({ dueAt: t - LATE_GRACE_MS }), t), 'due', 'the grace is inclusive');
assert.equal(stateOf(message({ dueAt: t - LATE_GRACE_MS - 1 }), t), 'late');
assert.equal(stateOf(message({ error: 'offline', retryAt: t + MINUTE }), t), 'retrying');
assert.equal(stateOf(message({ error: 'gone', retryAt: null }), t), 'failed');
assert.equal(stateOf(reminder({ dueAt: t - 2 * 60 * MINUTE }), t), 'late');

// A device that was off at 9:00 and wakes at 11:40 is late; one whose timer
// ran a few seconds slow is not.
assert.equal(isLate(t, t + 30_000), false);
assert.equal(isLate(t, t + 2 * 60 * MINUTE), true);

// --- what the scheduler acts on, and when it looks again ------------------------

{
  const items = [
    message({ id: 'later', dueAt: t + 60 * MINUTE }),
    message({ id: 'overdue', dueAt: t - 3 * 60 * MINUTE }),
    message({ id: 'now', dueAt: t }),
    message({ id: 'failed', dueAt: t - MINUTE, error: 'gone', retryAt: null }),
    message({ id: 'backing-off', dueAt: t - MINUTE, error: 'offline', retryAt: t + MINUTE }),
    reminder({ id: 'reminder-due', dueAt: t - MINUTE }),
  ];
  assert.deepEqual(
    readyAt(items, t).map((item) => item.id),
    ['overdue', 'reminder-due', 'now'],
    'overdue first, and never a final failure or one still backing off',
  );

  // A failure that is final is never acted on again on its own.
  assert.equal(fireAt(message({ error: 'gone', retryAt: null })), null);

  assert.equal(nextWake([], t), null, 'nothing scheduled, no timer');
  assert.equal(nextWake([message({ error: 'gone', retryAt: null })], t), null);
  assert.equal(nextWake([message({ dueAt: t + 20_000 })], t), 20_000);
  assert.equal(nextWake([message({ dueAt: t - 1 })], t), 0, 'overdue wakes at once');
  assert.equal(
    nextWake([message({ dueAt: t + 3 * 24 * 60 * MINUTE })], t),
    MAX_SLEEP_MS,
    'a far-off time is looked at again within a minute, never trusted to one long timer',
  );
}

// --- failure and retry -----------------------------------------------------------

assert.equal(worthRetrying(null), true, 'no answer at all is the offline case');
assert.equal(worthRetrying(503), true);
assert.equal(worthRetrying(429), true);
assert.equal(worthRetrying(403), false, 'a refusal is final');
assert.equal(worthRetrying(404), false);

assert.equal(retryDelayMs(1), 30_000);
assert.equal(retryDelayMs(2), 60_000);
assert.equal(retryDelayMs(3), 120_000);
assert.equal(retryDelayMs(30), 15 * MINUTE, 'backoff is capped');

{
  const offline = afterFailure(message({ dueAt: t }), t, null, 'offline');
  assert.equal(offline.attempts, 1);
  assert.equal(offline.retryAt, t + 30_000);
  assert.equal(stateOf(offline, t), 'retrying');

  const refused = afterFailure(message({ dueAt: t }), t, 403, 'You left that channel');
  assert.equal(refused.retryAt, null);
  assert.equal(stateOf(refused, t), 'failed');
  assert.equal(refused.error, 'You left that channel');

  const exhausted = afterFailure(message({ attempts: MAX_ATTEMPTS - 1 }), t, null, 'offline');
  assert.equal(exhausted.retryAt, null, 'it stops on its own eventually');

  const again = sendingNow(refused, t + MINUTE);
  assert.equal(again.dueAt, t + MINUTE);
  assert.equal(again.error, null);
  assert.equal(again.attempts, 0);
  assert.equal(stateOf(again, t + MINUTE), 'due');

  const moved = rescheduled(refused, t + 60 * MINUTE);
  assert.equal(moved.error, null, 'a new time is a fresh start');
  assert.equal(stateOf(moved, t), 'waiting');
  assert.equal(rescheduled(reminder(), t + 5).dueAt, t + 5);
}

// --- what can be scheduled -------------------------------------------------------

assert.equal(scheduleBlocker('hello', 0, 2000), null);
assert.ok(scheduleBlocker('hello', 1, 2000), 'files are sent now or not at all');
assert.ok(scheduleBlocker('   ', 0, 2000));
assert.ok(scheduleBlocker('x'.repeat(2001), 0, 2000), 'overflow text would become a file');

assert.equal(excerptOf('  one\n two  '), 'one two');
assert.equal(excerptOf('x'.repeat(200), 10).length, 10);

// --- notices -----------------------------------------------------------------------

{
  const onTime = sentNotice(message({ dueAt: t }), t + 10_000, now);
  assert.equal(onTime, null, 'a send on time says nothing');
  const late = sentNotice(message({ dueAt: t - 3 * 60 * MINUTE }), t, now);
  assert.ok(late && late.title.includes('late') && late.title.includes('#general'));

  const notice = reminderNotice(reminder(), t + 20 * MINUTE);
  assert.ok(notice.title.includes('Ada'));
  assert.equal(notice.body, 'the numbers are in');
  assert.ok(!notice.title.includes('late'));
  assert.ok(reminderNotice(reminder(), t + 5 * 60 * MINUTE).title.includes('late'));
}

// --- what comes back off disk --------------------------------------------------------

assert.deepEqual(parseScheduled(JSON.parse(JSON.stringify(message()))), message());
assert.deepEqual(parseScheduled(JSON.parse(JSON.stringify(reminder()))), reminder());
{
  const withReply = message({ replyTo: { id: 'm0', author: 'Ada', preview: 'hi' } });
  assert.deepEqual(parseScheduled(JSON.parse(JSON.stringify(withReply))), withReply);
}
assert.equal(parseScheduled(null), null);
assert.equal(parseScheduled('message'), null);
assert.equal(parseScheduled({ ...message(), kind: 'poll' }), null);
assert.equal(parseScheduled({ ...message(), dueAt: 'soon' }), null);
assert.equal(parseScheduled({ ...reminder(), messageId: 4 }), null);

console.log('schedule: ok');
