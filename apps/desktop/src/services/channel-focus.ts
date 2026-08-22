/**
 * Telling the server which conversation is in front of this person.
 *
 * It exists for one thing: so a phone is not woken for a message its owner is
 * reading on this screen. `notification-service` asks presence-service who has
 * a channel focused before it fans a push out, and drops them - see
 * `push-suppression.md`.
 *
 * "Focused" is deliberately strict. A channel is reported only while it is the
 * open one *and* this window has the operating system's focus. A desktop left
 * open on #general behind a browser is not somebody reading #general, and
 * treating it as one would silently swallow their notifications for the rest of
 * the day - which is a far worse failure than one redundant buzz.
 *
 * The same module serves the browser build, because it is the same app. A tab
 * gets `visibilitychange` as well, which is the closer thing a tab has to being
 * looked at.
 */
import { useChatStore } from '../stores/chat';
import { presenceSocket } from './socket';

/**
 * Well inside presence-service's 90-second staleness window, so a focus that
 * is still true is never allowed to age out of Redis. The socket's own
 * heartbeat refreshes it too; this covers a client that reconnected onto a
 * different presence instance.
 */
const HEARTBEAT_MS = 60_000;

export function startChannelFocus(): () => void {
  /** What the server has been told, so nothing is said twice. */
  let reported: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const focused = (): boolean => document.hasFocus() && !document.hidden;

  const current = (): string | null => {
    if (!focused()) return null;
    return useChatStore.getState().activeChannelId;
  };

  const apply = (): void => {
    const next = current();
    if (next === reported) return;

    // Blur the old one explicitly rather than letting it expire. Ninety
    // seconds of a stale focus is ninety seconds of missed notifications for a
    // channel this window has already left.
    if (reported) presenceSocket.send({ type: 'channel.blur', channelId: reported });
    if (next) presenceSocket.send({ type: 'channel.focus', channelId: next });
    reported = next;
  };

  const unsubscribe = useChatStore.subscribe(apply);
  window.addEventListener('focus', apply);
  window.addEventListener('blur', apply);
  document.addEventListener('visibilitychange', apply);

  timer = setInterval(() => {
    // Re-sent rather than skipped when nothing has changed: this is the
    // heartbeat, and its whole job is to say the same thing again.
    if (reported) presenceSocket.send({ type: 'channel.focus', channelId: reported });
  }, HEARTBEAT_MS);

  apply();

  return () => {
    if (timer) clearInterval(timer);
    unsubscribe();
    window.removeEventListener('focus', apply);
    window.removeEventListener('blur', apply);
    document.removeEventListener('visibilitychange', apply);
    if (reported) presenceSocket.send({ type: 'channel.blur', channelId: reported });
    reported = null;
  };
}
