/**
 * Which notification is standing for which conversation.
 *
 * One per channel: a run of messages in a conversation is one thing to look at,
 * not six. The main process used to get that from nothing at all - it created a
 * notification and forgot it, and the OS collapsed whatever it collapsed - which
 * was enough while the only way a notification ended was somebody clicking it,
 * and stopped being enough the moment reading the conversation on another
 * device became a reason for it to go away.
 *
 * Kept as its own module over a `close()`-shaped interface rather than over
 * Electron's `Notification`, because the interesting part is the bookkeeping and
 * the bookkeeping is where the leaks are: a map that grows for the life of the
 * app, or an entry replaced by a newer notification and then deleted by the
 * older one's own close event.
 */

/** All this needs of a notification: it can be closed. */
export interface Closable {
  close(): void;
}

export class NotificationRegistry {
  private readonly standing = new Map<string, Closable>();

  /**
   * A new notification for a channel replaces the one standing for it.
   *
   * The old one is closed rather than left beside it, because two toasts for
   * one conversation is the thing per-channel collapsing exists to prevent.
   */
  post(channelId: string, notification: Closable): void {
    this.close(channelId);
    this.standing.set(channelId, notification);
  }

  /** Takes a channel's notification away. Silent when there is none. */
  close(channelId: string): void {
    const previous = this.standing.get(channelId);
    if (!previous) return;
    this.standing.delete(channelId);
    previous.close();
  }

  /**
   * The OS closed one itself - the person dismissed it, or it timed out.
   *
   * Identity-checked, and that is the whole reason this is a method rather than
   * a `delete`. A close event arrives *after* the notification that replaced it
   * was already registered, so deleting by key alone would drop the live entry
   * and leave the app unable to dismiss the notification actually on screen.
   */
  forget(channelId: string, notification: Closable): void {
    if (this.standing.get(channelId) === notification) this.standing.delete(channelId);
  }

  /** How many are being held. For the check; nothing else asks. */
  get size(): number {
    return this.standing.size;
  }
}
