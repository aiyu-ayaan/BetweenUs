/**
 * The small rules a thread is drawn by, kept out of the components so they can
 * be asserted on without a DOM.
 *
 * A thread is a side conversation under one root message. Its replies are
 * ordinary sealed messages the server keeps out of the channel's timeline; the
 * root carries a "N replies · last reply X ago" summary. None of this is the
 * quote reply, which is a snapshot inside the envelope of a message that stays
 * in the timeline.
 *
 * Android's `ThreadRules.kt` is the same rule; if one changes, so does the
 * other.
 */
import type { Message, MessageThreadSummary, ThreadFollowState } from '@betweenus/shared-types';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Whether a message belongs in a thread panel rather than the timeline. */
export function isThreadReply(message: Pick<Message, 'threadRootId'>): boolean {
  return Boolean(message.threadRootId);
}

/** "just now", "5m ago", "3h ago", "2d ago" - short, because it sits in a chip. */
export function replyAge(iso: string, now: Date = new Date()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  const elapsed = now.getTime() - at;
  // A clock a little behind the server's puts a fresh reply in the future.
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

/**
 * The chip under a root, or null when there is no thread to point at.
 *
 * Null for a summary that counts nothing: every reply deleted is a thread that
 * has nothing left to open, and a "0 replies" chip is a button to an empty
 * panel.
 */
export function threadChipLabel(
  summary: MessageThreadSummary | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!summary || summary.replyCount <= 0) return null;
  const count = summary.replyCount === 1 ? '1 reply' : `${summary.replyCount} replies`;
  if (!summary.lastReplyAt) return count;
  const age = replyAge(summary.lastReplyAt, now);
  return age ? `${count} · last reply ${age}` : count;
}

/**
 * Whether this account is *in* a thread: it wrote the root, or has replied.
 *
 * The desktop half of the rule the push fan-out uses. A thread reply to
 * somebody in the thread is a notification; to anybody else it is one only
 * when it mentions them.
 */
export function takesPartIn(
  selfId: string | undefined,
  rootAuthorId: string | undefined,
  replyAuthorIds: string[],
): boolean {
  if (!selfId) return false;
  return rootAuthorId === selfId || replyAuthorIds.includes(selfId);
}

/**
 * The follow states a list holds, keyed by root. Only threads being followed:
 * an unfollowed one has no dot to draw and no place in the followed list.
 */
export function followMap(list: ThreadFollowState[]): Record<string, ThreadFollowState> {
  const out: Record<string, ThreadFollowState> = {};
  for (const item of list) if (item.following) out[item.rootId] = item;
  return out;
}

/** The map after one state arrived: kept while followed, dropped once not. */
export function withFollow(
  map: Record<string, ThreadFollowState>,
  state: ThreadFollowState,
): Record<string, ThreadFollowState> {
  if (state.following) return { ...map, [state.rootId]: state };
  if (!(state.rootId in map)) return map;
  const rest = { ...map };
  delete rest[state.rootId];
  return rest;
}

/**
 * What the chip's unread badge says, or null for no badge: a followed thread
 * with replies this account has not seen. Capped, because it sits in a chip.
 */
export function threadUnreadBadge(state: ThreadFollowState | undefined): string | null {
  if (!state?.following || state.unreadCount <= 0) return null;
  return state.unreadCount > 99 ? '99+' : String(state.unreadCount);
}
