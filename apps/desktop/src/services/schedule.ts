/**
 * Scheduled messages and reminders: the rules, with no storage and no timers.
 *
 * Both features are **local to the device**, and that is a decision about the
 * encryption rather than a shortcut. The server can only ever hold a message
 * as ciphertext, so there were two ways to send one later:
 *
 * - seal it now and have the server release it at the time - a new server
 *   capability (a queue of messages nobody has sent yet), sealed under an
 *   epoch that may have rotated by the time it goes out, and to members who
 *   may have left; or
 * - keep the words here, and seal and send them at the time through the
 *   ordinary send path - under whatever key the channel has *then*, to
 *   whoever is in it *then*.
 *
 * This is the second. The price is that the device has to be running at the
 * due time: the desktop app open or in the tray, a browser tab open, or - on
 * Android - WorkManager waking the app. A device that was off, asleep or
 * offline at the time sends on its next chance and says so: the message goes,
 * and the person who scheduled it is told it went late (see [LATE_GRACE_MS]).
 * A reminder is the same bargain with a notification in place of a send.
 *
 * Nothing here reads a clock. Every function takes `now`, so the check beside
 * this file can pin one; the store passes `serverNow()`, which is the server's
 * clock as best this machine can tell - a laptop whose clock is an hour out
 * would otherwise send "in 30 minutes" half an hour ago. Wall-clock presets
 * ("tomorrow at 9") are resolved in this machine's own time zone, with the
 * `Date` setters, so a daylight-saving change between now and then lands on
 * 9:00 rather than 8:00 or 10:00.
 *
 * Android's `Scheduling.kt` is this file, rule for rule.
 */
import type { MessageReply } from '@betweenus/shared-types';

/** A message waiting on this device to be sealed and sent at `dueAt`. */
export interface ScheduledMessage {
  kind: 'message';
  id: string;
  channelId: string;
  /** Null for a direct message. Carried for the emoji lookup and for opening it. */
  serverId: string | null;
  /** What the channel was called when this was written, for the list. */
  channelName: string;
  text: string;
  replyTo?: MessageReply;
  /** Epoch milliseconds, on the server's clock. */
  dueAt: number;
  createdAt: number;
  /** Failed sends so far. Zero until the first one. */
  attempts: number;
  /**
   * When the next attempt is, after a failure that is worth retrying. Null
   * either because nothing has failed or because the last failure was final -
   * `error` says which.
   */
  retryAt: number | null;
  error: string | null;
}

/** A "remind me about this message" on this device. */
export interface Reminder {
  kind: 'reminder';
  id: string;
  channelId: string;
  serverId: string | null;
  channelName: string;
  messageId: string;
  /** Who wrote the message, as they were named at the time. */
  author: string;
  /** The first line or so of it - kept on this device, never sent anywhere. */
  excerpt: string;
  dueAt: number;
  createdAt: number;
}

export type Scheduled = ScheduledMessage | Reminder;

/**
 * How late a send or a reminder may be before it is called late.
 *
 * Five minutes. Inside it the timer was merely slow - a throttled background
 * tab, a laptop lid opened a moment after the time - and nobody needs telling.
 * Past it the device was off or asleep at the time, and the person who asked
 * for 9:00 is told that it went at 11:40 instead.
 */
export const LATE_GRACE_MS = 5 * 60_000;

/** The soonest a custom time may be. Anything closer is "send". */
export const MIN_LEAD_MS = 60_000;

/**
 * The furthest ahead anything may be set. A year: past that a device-held
 * schedule is a promise about a machine nobody can make.
 */
export const MAX_AHEAD_MS = 366 * 24 * 60 * 60_000;

/**
 * The longest the scheduler sleeps between looks.
 *
 * A timer set for three days is a timer that a laptop sleep, a clock
 * correction or a suspended tab can quietly break; waking once a minute to
 * compare against the clock costs nothing and cannot drift.
 */
export const MAX_SLEEP_MS = 60_000;

/** Attempts at a scheduled message before it stops trying on its own. */
export const MAX_ATTEMPTS = 8;

/** The hour "tomorrow" and "Monday" mean. */
export const MORNING_HOUR = 9;

export type SendPreset = 'in-30-minutes' | 'in-1-hour' | 'tomorrow-morning' | 'monday-morning';
export type RemindPreset = 'in-20-minutes' | 'in-1-hour' | 'in-3-hours' | 'tomorrow-morning';
export type Preset = SendPreset | RemindPreset;

export const SEND_PRESETS: ReadonlyArray<{ preset: SendPreset; label: string }> = [
  { preset: 'in-30-minutes', label: 'In 30 minutes' },
  { preset: 'in-1-hour', label: 'In 1 hour' },
  { preset: 'tomorrow-morning', label: 'Tomorrow morning' },
  { preset: 'monday-morning', label: 'Monday morning' },
];

export const REMIND_PRESETS: ReadonlyArray<{ preset: RemindPreset; label: string }> = [
  { preset: 'in-20-minutes', label: 'In 20 minutes' },
  { preset: 'in-1-hour', label: 'In 1 hour' },
  { preset: 'in-3-hours', label: 'In 3 hours' },
  { preset: 'tomorrow-morning', label: 'Tomorrow morning' },
];

/** `now` plus some minutes, rounded up to the whole minute so the label is clean. */
function inMinutes(now: Date, minutes: number): number {
  const at = now.getTime() + minutes * 60_000;
  return Math.ceil(at / 60_000) * 60_000;
}

/** A local wall-clock time `days` from today's date. DST-safe: the setters do it. */
function atLocal(now: Date, days: number, hour: number): number {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0, 0);
  return at.getTime();
}

/** When a preset lands, from `now`, in this machine's time zone. */
export function resolvePreset(preset: Preset, now: Date): number {
  switch (preset) {
    case 'in-20-minutes':
      return inMinutes(now, 20);
    case 'in-30-minutes':
      return inMinutes(now, 30);
    case 'in-1-hour':
      return inMinutes(now, 60);
    case 'in-3-hours':
      return inMinutes(now, 180);
    case 'tomorrow-morning':
      return atLocal(now, 1, MORNING_HOUR);
    case 'monday-morning': {
      // The *next* Monday: on a Monday that is a week away, because "Monday
      // morning" said on Monday afternoon does not mean six hours ago.
      const day = now.getDay(); // 0 is Sunday
      const ahead = ((1 - day + 7) % 7) || 7;
      return atLocal(now, ahead, MORNING_HOUR);
    }
  }
}

export type DueCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'past' | 'too-far'; message: string };

/** Whether a chosen time is one this device can honour. */
export function checkDue(dueAt: number, now: number): DueCheck {
  if (!Number.isFinite(dueAt)) {
    return { ok: false, reason: 'invalid', message: 'Pick a date and a time' };
  }
  if (dueAt < now + MIN_LEAD_MS) {
    return { ok: false, reason: 'past', message: 'Pick a time at least a minute from now' };
  }
  if (dueAt > now + MAX_AHEAD_MS) {
    return { ok: false, reason: 'too-far', message: 'Pick a time within the next year' };
  }
  return { ok: true };
}

/**
 * An `<input type="datetime-local">` value, as epoch milliseconds in this
 * machine's zone. The input's value has no zone in it - "2026-09-23T09:00" is
 * nine on this clock - which is why `Date.parse` is not used: it is specified
 * to read that form as local, but older engines read it as UTC.
 */
export function parseLocalDateTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  // `new Date(2026, 1, 31)` is quietly the 3rd of March; a date that rolled
  // over was not a date.
  if (at.getMonth() !== month - 1 || at.getDate() !== day) return null;
  return at.getTime();
}

/** The reverse, for filling the input with a time already chosen. */
export function toLocalDateTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * When something is due, in words: "Today at 9:00 AM", "Tomorrow at 9:00 AM",
 * the weekday inside the coming week, the date past it. Local days, like the
 * message list's dividers (`features/chat/day.ts`).
 */
export function dueLabel(dueAt: number, now: Date): string {
  const at = new Date(dueAt);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOf = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(at) - startOf(now)) / 86_400_000);
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  if (days === -1) return `Yesterday at ${time}`;
  if (days > 1 && days < 7) {
    return `${at.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  }
  return `${at.toLocaleDateString([], { dateStyle: 'medium' })} at ${time}`;
}

/** When the scheduler should next act on an item, or null for never on its own. */
export function fireAt(item: Scheduled): number | null {
  if (item.kind === 'reminder') return item.dueAt;
  if (item.error !== null && item.retryAt === null) return null;
  return item.retryAt ?? item.dueAt;
}

export type ScheduledState = 'waiting' | 'due' | 'late' | 'retrying' | 'failed';

/** Where an item stands at `now`, for the list and for the scheduler. */
export function stateOf(item: Scheduled, now: number): ScheduledState {
  if (item.kind === 'message' && item.error !== null) {
    if (item.retryAt === null) return 'failed';
    if (item.retryAt > now) return 'retrying';
  }
  if (item.dueAt > now) return 'waiting';
  return isLate(item.dueAt, now) ? 'late' : 'due';
}

/** Whether acting at `firedAt` on something due at `dueAt` is late enough to say so. */
export function isLate(dueAt: number, firedAt: number): boolean {
  return firedAt - dueAt > LATE_GRACE_MS;
}

/** Everything the scheduler should act on now, soonest first. */
export function readyAt<T extends Scheduled>(items: readonly T[], now: number): T[] {
  return items
    .filter((item) => {
      const at = fireAt(item);
      return at !== null && at <= now;
    })
    .sort((a, b) => (fireAt(a) ?? 0) - (fireAt(b) ?? 0));
}

/**
 * How long to sleep before looking again: until the soonest item, but never
 * more than [MAX_SLEEP_MS]. Null when there is nothing to wait for.
 */
export function nextWake(items: readonly Scheduled[], now: number): number | null {
  let soonest: number | null = null;
  for (const item of items) {
    const at = fireAt(item);
    if (at === null) continue;
    if (soonest === null || at < soonest) soonest = at;
  }
  if (soonest === null) return null;
  return Math.min(Math.max(soonest - now, 0), MAX_SLEEP_MS);
}

/**
 * Whether a failed send is worth trying again without being asked.
 *
 * `status` is the HTTP status, or null when there was no answer at all - which
 * is the offline case, and the one retrying is for. A 4xx is the server saying
 * no (the channel is gone, this account left it, the body was refused), and
 * asking again every few minutes would get the same answer.
 */
export function worthRetrying(status: number | null): boolean {
  if (status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

/** 30 s, 1 min, 2 min... up to 15 minutes between attempts. */
export function retryDelayMs(attempts: number): number {
  const step = 30_000 * 2 ** Math.max(attempts - 1, 0);
  return Math.min(step, 15 * 60_000);
}

/** What a scheduled message looks like after an attempt at it failed. */
export function afterFailure(
  item: ScheduledMessage,
  now: number,
  status: number | null,
  message: string,
): ScheduledMessage {
  const attempts = item.attempts + 1;
  const again = worthRetrying(status) && attempts < MAX_ATTEMPTS;
  return {
    ...item,
    attempts,
    retryAt: again ? now + retryDelayMs(attempts) : null,
    error: message,
  };
}

/** "Send now", and "try again" after a final failure: due immediately, slate clean. */
export function sendingNow(item: ScheduledMessage, now: number): ScheduledMessage {
  return { ...item, dueAt: now, attempts: 0, retryAt: null, error: null };
}

/** A new time for anything scheduled. A failed message starts over. */
export function rescheduled<T extends Scheduled>(item: T, dueAt: number): T {
  if (item.kind === 'reminder') return { ...item, dueAt };
  return { ...item, dueAt, attempts: 0, retryAt: null, error: null };
}

/**
 * Why the composer's contents cannot be scheduled, or null when they can.
 *
 * Text only. Files would have to be sealed and uploaded now - the server
 * holding a message's ciphertext before it is sent, which is exactly what this
 * design refuses - or kept on this device as whole files until the time, which
 * is a different feature. Text over the overflow limit is sent as a file, so
 * the same answer applies to it.
 */
export function scheduleBlocker(text: string, fileCount: number, overflowChars: number): string | null {
  if (fileCount > 0) return 'Only text can be scheduled - send the files now';
  if (text.trim().length === 0) return 'Write something to schedule';
  if (text.trim().length > overflowChars) {
    return `Scheduled messages are limited to ${overflowChars} characters`;
  }
  return null;
}

/** The first line or so of a message, for a reminder's list row and notification. */
export function excerptOf(text: string, max = 140): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Soonest first, which is the order every list of these is read in. */
export function bySoonest<T extends Scheduled>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.dueAt - b.dueAt);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Reads a stored item back, or null for anything that is not one.
 *
 * What comes off disk was written by an older build, or by nothing at all, and
 * one malformed row must not take the rest of the list down with it.
 */
export function parseScheduled(value: unknown): Scheduled | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const base =
    isString(row.id) &&
    isString(row.channelId) &&
    (row.serverId === null || isString(row.serverId)) &&
    isString(row.channelName) &&
    isNumber(row.dueAt) &&
    isNumber(row.createdAt);
  if (!base) return null;

  const common = {
    id: row.id as string,
    channelId: row.channelId as string,
    serverId: row.serverId as string | null,
    channelName: row.channelName as string,
    dueAt: row.dueAt as number,
    createdAt: row.createdAt as number,
  };

  if (row.kind === 'message') {
    if (!isString(row.text)) return null;
    const reply = row.replyTo as Record<string, unknown> | undefined;
    const replyTo =
      reply && isString(reply.id) && isString(reply.author) && isString(reply.preview)
        ? { id: reply.id, author: reply.author, preview: reply.preview }
        : undefined;
    return {
      kind: 'message',
      ...common,
      text: row.text,
      ...(replyTo ? { replyTo } : {}),
      attempts: isNumber(row.attempts) ? row.attempts : 0,
      retryAt: isNumber(row.retryAt) ? row.retryAt : null,
      error: isString(row.error) ? row.error : null,
    };
  }

  if (row.kind === 'reminder') {
    if (!isString(row.messageId) || !isString(row.author) || !isString(row.excerpt)) return null;
    return {
      kind: 'reminder',
      ...common,
      messageId: row.messageId,
      author: row.author,
      excerpt: row.excerpt,
    };
  }

  return null;
}

/** The notification a reminder raises. */
export function reminderNotice(reminder: Reminder, firedAt: number): { title: string; body: string } {
  const where = reminder.serverId ? `#${reminder.channelName}` : reminder.channelName;
  const late = isLate(reminder.dueAt, firedAt) ? ' (late - this device was away)' : '';
  return {
    title: `Reminder: ${reminder.author} in ${where}${late}`,
    body: reminder.excerpt || 'A message you asked to be reminded about',
  };
}

/** The notification a scheduled send raises, when it has something to say. */
export function sentNotice(
  item: ScheduledMessage,
  firedAt: number,
  now: Date,
): { title: string; body: string } | null {
  if (!isLate(item.dueAt, firedAt)) return null;
  const where = item.serverId ? `#${item.channelName}` : item.channelName;
  return {
    title: `Sent late to ${where}`,
    body: `Scheduled for ${dueLabel(item.dueAt, now)} - this device was away then. "${excerptOf(item.text, 80)}"`,
  };
}
