/**
 * Desktop notifications.
 *
 * The rule lives here rather than in the stores: notify when the user cannot
 * already see the thing, and when they have not said otherwise. "Otherwise" is
 * four things - the account's own switch, its muted channels, its quiet hours,
 * and a Do Not Disturb status. The first three come from notification-service,
 * so they follow the account to another machine; the fourth is live presence.
 *
 * The OS half - the notification itself, the taskbar flash, the tray, restoring
 * the window on a click - belongs to the Electron main process. In a plain
 * browser (`pnpm --filter @nexora/desktop dev` in a tab) the bridge is absent
 * and every call here is a no-op.
 */
import type { NotificationPreferences } from '@nexora/shared-types';
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

export function isChannelMuted(channelId: string): boolean {
  return preferences.mutedChannelIds.includes(channelId);
}

export async function setChannelMuted(channelId: string, muted: boolean): Promise<void> {
  const current = preferences.mutedChannelIds;
  const next = muted
    ? [...new Set([...current, channelId])]
    : current.filter((id) => id !== channelId);
  await updateNotificationPreferences({ mutedChannelIds: next });
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

/** Everything that silences a notification, whatever it is about. */
function silenced(channelId: string): boolean {
  return (
    !preferences.enabled ||
    isChannelMuted(channelId) ||
    inQuietHours() ||
    usePresenceStore.getState().selfStatus === 'dnd'
  );
}

interface MessageNotification {
  channelId: string;
  channelName: string;
  author: string;
  /** Decrypted body, or null when this device holds no key for the channel. */
  text: string | null;
  /** Is this the channel currently open? */
  active: boolean;
}

export function notifyMessage(message: MessageNotification): void {
  if (message.active && windowIsFocused()) return;
  if (silenced(message.channelId)) return;

  window.nexora?.notify(
    `${message.author} in #${message.channelName}`,
    message.text ?? 'Sent an encrypted message',
    message.channelId,
  );
}

/** Someone joined a voice channel this user is not in - the "call" case. */
export function notifyVoiceJoin(channelId: string, channelName: string, who: string): void {
  if (silenced(channelId)) return;
  window.nexora?.notify(`${who} joined ${channelName}`, 'Voice channel', channelId);
}

/** Runs `handler` when the user clicks a notification. */
export function onNotificationActivate(handler: (channelId: string) => void): () => void {
  return window.nexora?.onNotificationActivate(handler) ?? ((): void => undefined);
}

/** Total unread, for the tray tooltip and the dock badge. */
export function publishUnreadCount(count: number): void {
  window.nexora?.setUnreadCount(count);
}
