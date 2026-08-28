/**
 * Who has refused whom, for the services that have to ask.
 *
 * It lives beside `friendship.ts` and for the same reason: more than one
 * service needs the answer, and a second implementation of an authorization
 * rule is the shape of every bug this kind of check exists to prevent.
 * chat-service gates a direct message on it, and `resolveChannelAccess` gates
 * everything downstream of a channel id on it.
 */
import { prisma } from './client';

/**
 * True when either side has blocked the other.
 *
 * Deliberately symmetric even though the rows are not. A block is one person's
 * decision, but its effect is on the conversation, which has two ends: if only
 * the blocker's side went quiet, the person they blocked would still be putting
 * messages in front of them.
 */
export async function isBlockedBetween(left: string, right: string): Promise<boolean> {
  if (left === right) return false;
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: left, blockedId: right },
        { blockerId: right, blockedId: left },
      ],
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Everyone this account should not see and who should not see it: the people it
 * blocked and the people who blocked it, as one set of ids.
 *
 * One query rather than two, and a `Set` rather than an array, because the
 * callers are filters over a list - a user search, a friend list - and they ask
 * once per row.
 */
export async function blockedIdsAround(userId: string): Promise<Set<string>> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(
    rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)),
  );
}

/** Only the people this account blocked, newest first - the list it manages. */
export async function blockedIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: { createdAt: 'desc' },
    select: { blockedId: true },
  });
  return rows.map((row) => row.blockedId);
}
