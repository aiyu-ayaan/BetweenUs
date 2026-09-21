/**
 * Scheduled messages and reminders, held and fired by this device.
 *
 * The rules are in `services/schedule.ts` and the disk is
 * `services/scheduled-store.ts`; this is the part with a clock in it. It wakes
 * at the soonest due time (and at least once a minute - see `MAX_SLEEP_MS`),
 * and when something is due:
 *
 * - a **message** is sealed and sent through `useChatStore.sendTextTo`, the
 *   same path the composer takes, under the channel's key *at that moment*. A
 *   failure the server did not refuse outright is tried again with backoff; a
 *   refusal is kept in the list as failed, for "send now" or "cancel".
 * - a **reminder** raises a local notification that opens the message.
 *
 * Either one fired more than `LATE_GRACE_MS` after its time - the app was
 * closed, the laptop asleep, the tab shut - still fires, on the next launch,
 * and says it is late. That is the chosen answer to "what if the device was
 * away": a message somebody meant to send is sent, and they are told when.
 *
 * Two tabs of the web client on the same account share one IndexedDB, so both
 * would see the same row come due. Each send takes a Web Lock on the row and
 * re-reads it from disk under the lock; the tab that gets there second finds
 * it already gone.
 */
import { create } from 'zustand';
import type { MessageReply } from '@betweenus/shared-types';
import { ApiError } from '../services/api';
import { serverNow } from '../services/server-clock';
import { notifySelf } from '../services/notifications';
import { scheduledStore } from '../services/scheduled-store';
import {
  afterFailure,
  bySoonest,
  excerptOf,
  nextWake,
  readyAt,
  reminderNotice,
  rescheduled,
  sendingNow,
  sentNotice,
  MAX_SLEEP_MS,
  type Reminder,
  type Scheduled,
  type ScheduledMessage,
} from '../services/schedule';
import { useChatStore } from './chat';

/** Where something scheduled lives, for the list and for opening it. */
export interface ScheduleTarget {
  channelId: string;
  serverId: string | null;
  channelName: string;
}

interface ScheduledState {
  /** Everything waiting on this device, soonest first. */
  items: Scheduled[];
  /** Messages being sealed and sent right now. */
  sending: string[];
  userId: string | null;

  /** Loads the account's list from disk and starts the clock. */
  start: (userId: string) => Promise<void>;
  /** Sign-out: stops the clock and forgets every unsent message and reminder. */
  signOut: () => Promise<void>;

  scheduleMessage: (
    target: ScheduleTarget,
    text: string,
    dueAt: number,
    replyTo?: MessageReply,
  ) => Promise<void>;
  remind: (
    target: ScheduleTarget,
    message: { id: string; author: string; text: string },
    dueAt: number,
  ) => Promise<void>;
  reschedule: (id: string, dueAt: number) => Promise<void>;
  /** Sends a scheduled message now - also how a failed one is tried again. */
  sendNow: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let firstLook: ReturnType<typeof setTimeout> | null = null;
let detach: (() => void) | null = null;
let channel: BroadcastChannel | null = null;

/**
 * Reminders that have gone off, by id, so a click on the notification can
 * still find the message after the reminder itself has been removed.
 */
const fired = new Map<string, Reminder>();

/**
 * How long after start-up the first look waits. Long enough for the vault to
 * open and the socket to connect - a send attempted before either fails, and
 * costs a retry for nothing.
 */
const FIRST_LOOK_MS = 4_000;

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Runs `work` holding a lock on one item, across every tab of this origin -
 * or skips it when another tab holds it. A runtime with no Web Locks has one
 * window, which is the case the lock was not needed for.
 */
async function exclusive(id: string, work: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) {
    await work();
    return;
  }
  await locks.request(`betweenus.scheduled.${id}`, { ifAvailable: true }, async (lock) => {
    if (lock) await work();
  });
}

/** Tells any other tab that the list on disk changed. */
function announce(): void {
  try {
    channel?.postMessage('changed');
  } catch {
    // A closed channel: there is nobody left to tell.
  }
}

export const useScheduledStore = create<ScheduledState>((set, get) => {
  const replace = (items: Scheduled[]): void => set({ items: bySoonest(items) });

  const upsert = async (item: Scheduled): Promise<void> => {
    replace([...get().items.filter((existing) => existing.id !== item.id), item]);
    await scheduledStore.put(item).catch(() => undefined);
    announce();
    arm();
  };

  const drop = async (id: string): Promise<void> => {
    replace(get().items.filter((item) => item.id !== id));
    await scheduledStore.remove(id).catch(() => undefined);
    announce();
  };

  /** Sets the timer for the next look, or none when nothing is waiting. */
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!get().userId) return;

    const busy = new Set(get().sending);
    const isOnline = online();
    // Offline, a message cannot go and is not looked at until `online` fires -
    // but a reminder needs no network and still goes off on time.
    const candidates = get().items.filter(
      (item) => !busy.has(item.id) && (isOnline || item.kind === 'reminder'),
    );
    const delay = nextWake(candidates, serverNow());
    const waitingOffline = !isOnline && get().items.some((item) => item.kind === 'message');
    const wait = delay ?? (waitingOffline ? MAX_SLEEP_MS : null);
    if (wait === null) return;
    // A floor, so an item that keeps coming back due cannot spin the thread.
    timer = setTimeout(() => void look(), Math.max(wait, 250));
  };

  /** Acts on whatever is due. */
  const look = async (): Promise<void> => {
    if (!get().userId) return;
    const now = serverNow();
    const busy = new Set(get().sending);
    const due = readyAt(get().items, now).filter(
      (item) => !busy.has(item.id) && (online() || item.kind === 'reminder'),
    );
    await Promise.all(due.map((item) => fire(item)));
    arm();
  };

  const fire = (item: Scheduled): Promise<void> =>
    exclusive(item.id, async () => {
      // Another tab may have fired it and removed it a moment ago.
      if (!(await scheduledStore.has(item.id))) {
        replace(get().items.filter((existing) => existing.id !== item.id));
        return;
      }
      if (item.kind === 'reminder') {
        const notice = reminderNotice(item, serverNow());
        fired.set(item.id, item);
        notifySelf(notice.title, notice.body, `reminder:${item.id}`);
        await drop(item.id);
        return;
      }
      await send(item);
    });

  const send = async (item: ScheduledMessage): Promise<void> => {
    set({ sending: [...get().sending, item.id] });
    try {
      await useChatStore
        .getState()
        .sendTextTo(item.channelId, item.serverId, item.text, item.replyTo);
      const firedAt = serverNow();
      await drop(item.id);
      const notice = sentNotice(item, firedAt, new Date(firedAt));
      if (notice) notifySelf(notice.title, notice.body, `scheduled:${item.id}`);
    } catch (error) {
      // No HTTP status is the offline case, and so is a vault that has not
      // opened yet: both are worth another go.
      const status = error instanceof ApiError ? error.status || null : null;
      const message = error instanceof Error ? error.message : 'The message could not be sent';
      const next = afterFailure(item, serverNow(), status, message);
      if (get().items.some((existing) => existing.id === item.id)) {
        await upsert(next);
        if (next.retryAt === null) {
          const where = next.serverId ? `#${next.channelName}` : next.channelName;
          notifySelf(
            `Scheduled message to ${where} was not sent`,
            `${message}. "${excerptOf(next.text, 80)}"`,
            `scheduled:${next.id}`,
          );
        }
      }
    } finally {
      set({ sending: get().sending.filter((id) => id !== item.id) });
    }
  };

  return {
    items: [],
    sending: [],
    userId: null,

    start: async (userId) => {
      if (get().userId === userId) return;
      set({ userId });
      const items = await scheduledStore.load(userId).catch(() => []);
      if (get().userId !== userId) return;
      replace(items);

      detach?.();
      // Coming back online, or back to the window, is when a send that was
      // waiting for either can go - and when a laptop that slept through its
      // timer finds out.
      const wake = (): void => void look();
      const onVisible = (): void => {
        if (document.visibilityState === 'visible') void look();
      };
      window.addEventListener('online', wake);
      window.addEventListener('focus', wake);
      document.addEventListener('visibilitychange', onVisible);

      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('betweenus.scheduled');
        channel.onmessage = () => {
          const current = get().userId;
          if (!current) return;
          void scheduledStore
            .load(current)
            .then((fresh) => {
              if (get().userId === current) {
                replace(fresh);
                arm();
              }
            })
            .catch(() => undefined);
        };
      }

      detach = () => {
        window.removeEventListener('online', wake);
        window.removeEventListener('focus', wake);
        document.removeEventListener('visibilitychange', onVisible);
        channel?.close();
        channel = null;
      };

      if (firstLook) clearTimeout(firstLook);
      firstLook = setTimeout(() => void look(), FIRST_LOOK_MS);
    },

    signOut: async () => {
      if (timer) clearTimeout(timer);
      if (firstLook) clearTimeout(firstLook);
      timer = null;
      firstLook = null;
      detach?.();
      detach = null;
      fired.clear();
      set({ items: [], sending: [], userId: null });
      await scheduledStore.clear().catch(() => undefined);
    },

    scheduleMessage: async (target, text, dueAt, replyTo) => {
      const now = serverNow();
      await upsert({
        kind: 'message',
        id: newId(),
        channelId: target.channelId,
        serverId: target.serverId,
        channelName: target.channelName,
        text,
        ...(replyTo ? { replyTo } : {}),
        dueAt,
        createdAt: now,
        attempts: 0,
        retryAt: null,
        error: null,
      });
    },

    remind: async (target, message, dueAt) => {
      await upsert({
        kind: 'reminder',
        id: newId(),
        channelId: target.channelId,
        serverId: target.serverId,
        channelName: target.channelName,
        messageId: message.id,
        author: message.author,
        excerpt: excerptOf(message.text),
        dueAt,
        createdAt: serverNow(),
      });
    },

    reschedule: async (id, dueAt) => {
      const item = get().items.find((existing) => existing.id === id);
      if (!item) return;
      await upsert(rescheduled(item, dueAt));
    },

    sendNow: async (id) => {
      const item = get().items.find((existing) => existing.id === id);
      if (!item || item.kind !== 'message' || get().sending.includes(id)) return;
      await upsert(sendingNow(item, serverNow()));
      await look();
    },

    cancel: async (id) => {
      if (get().sending.includes(id)) return;
      await drop(id);
      arm();
    },
  };
});

/** The prefix a reminder's notification carries in place of a channel id. */
const REMINDER_TAG = 'reminder:';
const SCHEDULED_TAG = 'scheduled:';

/**
 * Handles a notification click that was about something scheduled, and says
 * whether it was. A reminder opens its message; a scheduled send opens the
 * channel it went to.
 */
export function followScheduledNotification(tag: string): boolean {
  if (tag.startsWith(REMINDER_TAG)) {
    const id = tag.slice(REMINDER_TAG.length);
    const reminder =
      fired.get(id) ??
      useScheduledStore
        .getState()
        .items.find((item): item is Reminder => item.kind === 'reminder' && item.id === id);
    fired.delete(id);
    if (reminder) void openMessage(reminder, reminder.messageId).catch(() => undefined);
    return true;
  }
  if (tag.startsWith(SCHEDULED_TAG)) {
    const id = tag.slice(SCHEDULED_TAG.length);
    const item = useScheduledStore.getState().items.find((existing) => existing.id === id);
    // A late send has already left the list; the list is where either kind is
    // explained, so that is what opens.
    if (item) void openMessage(item).catch(() => undefined);
    useChatStore.getState().showPanel('scheduled');
    return true;
  }
  return false;
}

/** How far back a reminder's message is looked for, in pages of history. */
const JUMP_PAGES = 5;

/**
 * Opens a channel wherever it lives, and - given a message - scrolls to it,
 * reading back a few pages of history if it is not in the newest one.
 */
export async function openMessage(
  target: { channelId: string; serverId: string | null },
  messageId?: string,
): Promise<void> {
  const chat = useChatStore.getState();
  if (target.serverId) {
    if (chat.view !== 'server' || chat.activeServerId !== target.serverId) {
      await chat.selectServer(target.serverId);
    }
  } else {
    chat.showHome();
  }
  await useChatStore.getState().selectChannel(target.channelId);
  if (!messageId) return;

  for (let page = 0; page < JUMP_PAGES; page += 1) {
    const state = useChatStore.getState();
    if (state.activeChannelId !== target.channelId) return;
    if (state.messages.some((message) => message.id === messageId)) break;
    if (!state.cursors[target.channelId]) break;
    await state.loadOlder();
  }
  useChatStore.getState().jumpToMessage(messageId);
}
