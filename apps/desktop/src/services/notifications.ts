/**
 * Desktop notifications.
 *
 * The rule lives here rather than in the stores: notify when the user cannot
 * already see the thing. A message in the channel that is on screen with the
 * window focused needs no notification; anything else does.
 *
 * The OS half - the notification itself, the taskbar flash, restoring the
 * window on a click - belongs to the Electron main process. In a plain browser
 * (`pnpm --filter @nexora/desktop dev` in a tab) the bridge is absent and every
 * call here is a no-op.
 */

/** True when this window is on screen and has keyboard focus. */
export function windowIsFocused(): boolean {
  return typeof document !== 'undefined' && !document.hidden && document.hasFocus();
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

  window.nexora?.notify(
    `${message.author} in #${message.channelName}`,
    message.text ?? 'Sent an encrypted message',
    message.channelId,
  );
}

/** Someone joined a voice channel this user is not in - the "call" case. */
export function notifyVoiceJoin(channelId: string, channelName: string, who: string): void {
  window.nexora?.notify(`${who} joined ${channelName}`, 'Voice channel', channelId);
}

/** Runs `handler` when the user clicks a notification. */
export function onNotificationActivate(handler: (channelId: string) => void): () => void {
  return window.nexora?.onNotificationActivate(handler) ?? ((): void => undefined);
}
