/**
 * The rules a thread lives by, kept out of the service so they can be asserted
 * on without a database.
 *
 * A thread is a pointer and nothing else: a reply carries `threadRootId`, the
 * root carries a count and a timestamp, and every body in it is sealed with
 * the channel key exactly like a message in the timeline. The server can tell
 * that a thread exists and how busy it is - which is the same class of fact as
 * "somebody sent a message at 09:14" - and never what was said in it.
 */
import { hasBody, type MessageKind, type MessageThreadSummary } from '@betweenus/shared-types';

/** What the service knows about a would-be root when a reply names it. */
export interface ThreadRootCandidate {
  channelId: string;
  kind: MessageKind;
  /** Set when the candidate is itself a thread reply. */
  threadRootId: string | null;
  viewOnce: boolean;
}

/**
 * Why a reply cannot hang off this root, or null when it can.
 *
 * A discriminated code rather than a boolean, because each refusal is a
 * different mistake a client can make and the error shape carries the code.
 *
 * - The root must exist and be in the channel the reply is sent to: a thread
 *   in one channel hanging off a message in another would be sealed under a
 *   key half its readers do not hold. Answered as "not found" either way, so
 *   a message id in a channel the caller cannot see is not confirmed.
 * - One level: a reply is never itself a root. Nested threads are a tree
 *   nobody can read on a phone.
 * - Not a server-written row (an arrival notice): there is nothing to answer.
 * - Not a one-time message: it is destroyed once everybody has looked, and a
 *   conversation under it would go with it without anybody choosing that.
 *
 * A tombstoned root is deliberately allowed. Deleting a message is not
 * deleting the conversation somebody else started under it; the thread stays
 * reachable and the root reads "original message deleted".
 */
export function threadRootProblem(
  root: ThreadRootCandidate | null,
  channelId: string,
): 'MESSAGE_NOT_FOUND' | 'THREAD_NOT_ALLOWED' | null {
  if (!root || root.channelId !== channelId) return 'MESSAGE_NOT_FOUND';
  if (root.threadRootId !== null) return 'THREAD_NOT_ALLOWED';
  if (!hasBody(root.kind)) return 'THREAD_NOT_ALLOWED';
  if (root.viewOnce) return 'THREAD_NOT_ALLOWED';
  return null;
}

/**
 * The summary a root carries, from its two columns. Null when there is no
 * thread to speak of, which is also what a reply always gets.
 */
export function threadSummaryOf(row: {
  threadRootId?: string | null;
  threadReplyCount?: number;
  threadLastReplyAt?: Date | null;
}): MessageThreadSummary | null {
  if (row.threadRootId) return null;
  const replyCount = row.threadReplyCount ?? 0;
  if (replyCount <= 0) return null;
  return {
    replyCount,
    lastReplyAt: row.threadLastReplyAt ? row.threadLastReplyAt.toISOString() : null,
  };
}
