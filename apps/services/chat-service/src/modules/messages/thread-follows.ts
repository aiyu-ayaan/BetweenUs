/**
 * Who follows a thread, and how far each of them has read.
 *
 * Follows are a row per (account, root): the account started the thread (wrote
 * its root), replied in it, or asked to follow it. The server learns nothing
 * here it did not already hold - it stores every reply's author and
 * `threadRootId` anyway - and the unread count is a count of reply *rows*
 * after a timestamp, never of anything sealed inside them.
 *
 * The decisions live in the pure functions at the top, so they can be asserted
 * on without a database; the helpers below them only read and write the rows
 * those decisions name. Nothing here imports the messages service, which
 * imports this file.
 */
import { prisma, resolveChannelAccess } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { PERMISSIONS } from '@betweenus/permissions';
import type { ThreadFollowState } from '@betweenus/shared-types';

// --- The rules ---------------------------------------------------------------

/** What a reply does to one account's follow row, or null to leave it alone. */
export type FollowChange = { following: true; lastReadAt?: Date } | null;

/**
 * How a reply moves the follow of one person.
 *
 * - The replier follows, whatever they said before: answering a thread is the
 *   clearest way of saying you care about it, which is how every chat app
 *   treats it. Their marker moves to their own reply - they have plainly read
 *   up to what they just wrote.
 * - The root's author follows the first time anybody replies, but an explicit
 *   unfollow (a row with `following = false`) is remembered and respected.
 * - Anybody else is untouched.
 */
export function followChangeFor(
  role: 'replier' | 'rootAuthor',
  existing: { following: boolean } | null,
  replyAt: Date,
): FollowChange {
  if (role === 'replier') return { following: true, lastReadAt: replyAt };
  if (existing) return null;
  return { following: true };
}

/**
 * The marker after reading up to `candidate`. Never backwards: a device that
 * was behind reporting an older reply must not re-open what another device
 * already read.
 */
export function advancedMarker(current: Date | null, candidate: Date): Date {
  return current && current.getTime() >= candidate.getTime() ? current : candidate;
}

/**
 * Which reply rows count as unread for one reader: live replies in the thread,
 * from somebody else, after the marker. Your own replies are never news.
 */
export function unreadWhere(
  rootId: string,
  userId: string,
  lastReadAt: Date | null,
): {
  threadRootId: string;
  deletedAt: null;
  authorId: { not: string };
  createdAt?: { gt: Date };
} {
  return {
    threadRootId: rootId,
    deletedAt: null,
    authorId: { not: userId },
    ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
  };
}

// --- The rows ----------------------------------------------------------------

/** The root facts a follow state is drawn with. */
export interface RootFacts {
  id: string;
  channelId: string;
  channel: { serverId: string | null };
  /** Set when this "root" is really a reply, which can have no thread. */
  threadRootId?: string | null;
}

/** Builds one reader's state for one thread from its row (or its absence). */
export async function followStateOf(
  userId: string,
  root: RootFacts,
  row: { following: boolean; lastReadAt: Date | null } | null,
): Promise<ThreadFollowState> {
  const following = row?.following ?? false;
  const lastReadAt = row?.lastReadAt ?? null;
  const unreadCount = following
    ? await prisma.message.count({ where: unreadWhere(root.id, userId, lastReadAt) })
    : 0;
  return {
    rootId: root.id,
    channelId: root.channelId,
    serverId: root.channel.serverId,
    following,
    lastReadAt: lastReadAt ? lastReadAt.toISOString() : null,
    unreadCount,
  };
}

/** The root of a thread, with what a follow state needs. Null when it is gone. */
export function findRootFacts(rootId: string): Promise<RootFacts | null> {
  return prisma.message.findUnique({
    where: { id: rootId },
    select: {
      id: true,
      channelId: true,
      threadRootId: true,
      channel: { select: { serverId: true } },
    },
  });
}

/**
 * Applies what a new reply does to the follows of its thread: the replier and
 * the root's author. Called after the reply row exists and before the root's
 * summary is refreshed, so the fan-out that follows sees the new rows.
 */
export async function recordThreadReply(reply: {
  authorId: string;
  threadRootId: string;
  createdAt: Date;
}): Promise<void> {
  const root = await prisma.message.findUnique({
    where: { id: reply.threadRootId },
    select: { authorId: true, kind: true },
  });

  await prisma.threadFollow.upsert({
    where: { userId_rootId: { userId: reply.authorId, rootId: reply.threadRootId } },
    create: {
      userId: reply.authorId,
      rootId: reply.threadRootId,
      following: true,
      lastReadAt: reply.createdAt,
    },
    update: { following: true, lastReadAt: reply.createdAt },
  });

  // A webhook post's author is the account that created the webhook, which
  // did not say anything here and should not be signed up for the replies.
  if (!root || root.kind !== 'USER' || root.authorId === reply.authorId) return;
  const existing = await prisma.threadFollow.findUnique({
    where: { userId_rootId: { userId: root.authorId, rootId: reply.threadRootId } },
    select: { following: true },
  });
  const change = followChangeFor('rootAuthor', existing, reply.createdAt);
  if (!change) return;
  await prisma.threadFollow.upsert({
    where: { userId_rootId: { userId: root.authorId, rootId: reply.threadRootId } },
    create: { userId: root.authorId, rootId: reply.threadRootId, following: true },
    // Lost a race with an explicit choice made a moment ago: that one stands.
    update: {},
  });
}

/**
 * Tells everyone following these threads what their unread count is now.
 *
 * Run whenever the replies under a root change - a send, a delete, an expiry -
 * which is exactly when `refreshThreadSummaries` runs. Only followers who can
 * still see the channel hear about it: a follow outlives a lost permission,
 * and it must not keep whispering about a channel its owner was shut out of.
 */
export async function publishThreadFollows(events: EventBus, rootId: string): Promise<void> {
  const root = await findRootFacts(rootId);
  if (!root) return;
  const rows = await prisma.threadFollow.findMany({
    where: { rootId, following: true },
    select: { userId: true, following: true, lastReadAt: true },
  });
  for (const row of rows) {
    const access = await resolveChannelAccess(row.userId, root.channelId);
    if (!access || !access.permissions.includes(PERMISSIONS.VIEW_CHANNEL)) continue;
    const thread = await followStateOf(row.userId, root, row);
    await events.publish(EVENTS.THREAD_FOLLOW_CHANGED, { userId: row.userId, thread });
  }
}
