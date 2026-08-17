/**
 * Desktop notifications.
 *
 * The rule lives here rather than in the stores: notify when the user cannot
 * already see the thing, and when they have not said otherwise. "Otherwise" is
 * four things - the account's own switch, the channel's own level (everything,
 * mentions only, or nothing), its quiet hours, and a Do Not Disturb status. The first three come from notification-service,
 * so they follow the account to another machine; the fourth is live presence.
 *
 * The OS half - the notification itself, the taskbar flash, the tray, restoring
 * the window on a click - belongs to the Electron main process. In a plain
 * browser (`pnpm --filter @nexora/desktop dev` in a tab) the bridge is absent
 * and every call here is a no-op.
 */
import type {
  ChannelNotificationLevel,
  NotificationPreferences,
} from '@nexora/shared-types';
import { api } from './api';
import { usePresenceStore } from '../stores/presence';

/** True when this window is on screen and has keyboard focus. */
export function windowIsFocused(): boolean {
  return typeof document !== 'undefined' && !document.hidden && document.hasFocus();
}

const DEFAULTS: NotificationPreferences = {
  enabled: true,
  quietStartMinute: null,
  quietEndMinute: null,
  mutedChannelIds: [],
  mentionOnlyChannelIds: [],
  mutedUserIds: [],
};

// Held in a module rather than a store: the decision is taken inside a socket
// callback, where a hook cannot be read, and every component that needs the
// values reads them through `notificationPreferences()`.
let preferences: NotificationPreferences = DEFAULTS;
const listeners = new Set<(preferences: NotificationPreferences) => void>();

function publish(next: NotificationPreferences): NotificationPreferences {
  preferences = next;
  for (const listener of listeners) listener(next);
  return next;
}

export function notificationPreferences(): NotificationPreferences {
  return preferences;
}

/** Fires whenever preferences change, from this window or from a reload. */
export function onPreferencesChanged(
  listener: (preferences: NotificationPreferences) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Loaded once a session is up. A failure leaves the defaults in place. */
export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    return publish(await api.notificationPreferences());
  } catch {
    return preferences;
  }
}

export async function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  return publish(await api.updateNotificationPreferences(patch));
}

export function resetNotificationPreferences(): void {
  publish(DEFAULTS);
}

/** True when this account has muted that person, wherever they write. */
export function isUserMuted(userId: string): boolean {
  return preferences.mutedUserIds.includes(userId);
}

/**
 * Mutes or unmutes one person.
 *
 * A person rather than a place: muting five channels because one of them is
 * loud takes four channels away that were not the problem, and leaving is not
 * an option for a colleague. It follows the account, like every other
 * preference here, so it holds on the next machine.
 */
export async function setUserMuted(userId: string, muted: boolean): Promise<void> {
  const next = muted
    ? [...new Set([...preferences.mutedUserIds, userId])]
    : preferences.mutedUserIds.filter((id) => id !== userId);

  publish(await api.updateNotificationPreferences({ mutedUserIds: next }));
}

export function isChannelMuted(channelId: string): boolean {
  return preferences.mutedChannelIds.includes(channelId);
}

/**
 * What this channel's bell is set to.
 *
 * A mute wins over mentions-only, so the two lists cannot contradict each other
 * however they were written - a client that only knows about muting can add a
 * channel to that list and the answer is still "none".
 */
export function channelLevel(channelId: string): ChannelNotificationLevel {
  if (preferences.mutedChannelIds.includes(channelId)) return 'none';
  if (preferences.mentionOnlyChannelIds.includes(channelId)) return 'mentions';
  return 'all';
}

/** The order the bell cycles through, which is loudest to quietest. */
export const CHANNEL_LEVELS: ChannelNotificationLevel[] = ['all', 'mentions', 'none'];

export async function setChannelLevel(
  channelId: string,
  level: ChannelNotificationLevel,
): Promise<void> {
  const without = (list: string[]): string[] => list.filter((id) => id !== channelId);
  // Both lists are sent every time, so a channel is in exactly one of them and
  // a level that moved cannot leave its old entry behind.
  await updateNotificationPreferences({
    mutedChannelIds:
      level === 'none'
        ? [...new Set([...preferences.mutedChannelIds, channelId])]
        : without(preferences.mutedChannelIds),
    mentionOnlyChannelIds:
      level === 'mentions'
        ? [...new Set([...preferences.mentionOnlyChannelIds, channelId])]
        : without(preferences.mentionOnlyChannelIds),
  });
}

export async function setChannelMuted(channelId: string, muted: boolean): Promise<void> {
  await setChannelLevel(channelId, muted ? 'none' : 'all');
}

/**
 * Quiet hours are minutes on the user's own clock, and a window is allowed to
 * wrap midnight - 22:00 to 08:00 is start 1320, end 480, which is "outside the
 * ordinary comparison" rather than an empty range.
 */
export function inQuietHours(now = new Date()): boolean {
  const { quietStartMinute: start, quietEndMinute: end } = preferences;
  if (start === null || end === null || start === end) return false;

  const minute = now.getHours() * 60 + now.getMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * Everything that silences a notification, whatever it is about.
 *
 * `mentioned` is what the middle level turns on: a channel set to mentions-only
 * is silent for everything else, and anything that is not a message at all -
 * somebody joining a voice channel - is never a mention and so is silent there
 * too, which is the point of setting a busy channel to mentions.
 */
function silenced(channelId: string, mentioned = false): boolean {
  if (
    !preferences.enabled ||
    inQuietHours() ||
    usePresenceStore.getState().selfStatus === 'dnd'
  ) {
    return true;
  }

  const level = channelLevel(channelId);
  if (level === 'none') return true;
  return level === 'mentions' && !mentioned;
}

interface MessageNotification {
  channelId: string;
  channelName: string;
  author: string;
  /** Who wrote it, for the per-person mute. The envelope carries this. */
  authorId?: string;
  /** Decrypted body, or null when this device holds no key for the channel. */
  text: string | null;
  /** Is this the channel currently open? */
  active: boolean;
  /** Decided by the window that decrypted it - see `mentions.ts`. */
  mentioned?: boolean;
}

export function notifyMessage(message: MessageNotification): void {
  // A muted person is silent even when they mention you: "wherever they write"
  // includes writing your name, and a mute that any mention could bypass would
  // be a mute the loud person controls.
  if (message.authorId && isUserMuted(message.authorId)) return;
  if (silenced(message.channelId, message.mentioned ?? false)) return;

  // Whether the window is really focused is the main process's answer, not
  // this one's - so `active` is passed along rather than resolved here.
  raise(
    `${message.author} in #${message.channelName}`,
    message.text ?? 'Sent an encrypted message',
    message.channelId,
    message.active,
  );
}

/** Someone joined a voice channel this user is not in - the "call" case. */
export function notifyVoiceJoin(channelId: string, channelName: string, who: string): void {
  if (silenced(channelId)) return;
  raise(`${who} joined ${channelName}`, 'Voice channel', channelId);
}

/** Handlers waiting on a click, in the web client. Electron keeps its own. */
const clickHandlers = new Set<(channelId: string) => void>();

/**
 * One notification, however this runtime raises one.
 *
 * Electron's main process owns it: only that side knows whether the window is
 * really focused, and only that side can flash a taskbar entry. A browser tab
 * has the Notifications API and nothing else - so it has to answer the focus
 * question itself, which it can, because a visible tab showing the channel the
 * message arrived in is exactly the case not worth interrupting.
 */
function raise(title: string, body: string, channelId?: string, active = false): void {
  const bridge = window.nexora;
  if (bridge) {
    bridge.notify(title, body, channelId, active);
    return;
  }

  if (typeof Notification === 'undefined') return;
  if (active && document.visibilityState === 'visible') return;

  // Asked for at the first notification worth raising rather than at sign-in:
  // a permission prompt on the way into the app is the one people refuse.
  if (Notification.permission === 'default') {
    void Notification.requestPermission();
    return;
  }
  if (Notification.permission !== 'granted') return;

  // `tag` collapses a run of messages in one channel into a single toast,
  // which is what the main process does with its own notifications.
  const note = new Notification(title, { body, tag: channelId });
  note.onclick = () => {
    window.focus();
    if (channelId) for (const handler of clickHandlers) handler(channelId);
    note.close();
  };
}

/** Runs `handler` when the user clicks a notification. */
export function onNotificationActivate(handler: (channelId: string) => void): () => void {
  const unsubscribe = window.nexora?.onNotificationActivate(handler);
  if (unsubscribe) return unsubscribe;
  clickHandlers.add(handler);
  return () => clickHandlers.delete(handler);
}

/** Total unread, for the tray tooltip and the dock badge. */
export function publishUnreadCount(count: number): void {
  const bridge = window.nexora;
  if (bridge) {
    bridge.setUnreadCount(count);
    return;
  }
  // A tab has no tray and no dock; the title is the only badge it owns.
  document.title = count > 0 ? `(${count}) Nexora` : 'Nexora';
}
