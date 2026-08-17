/**
 * Who is friends with whom, for the services that have to ask.
 *
 * It lives here rather than in `chat-service` because two services need the
 * same answer and neither owns it outright: chat-service holds the friend list
 * and its requests, and server-service has to refuse to add somebody you are
 * not friends with. Re-deriving "are these two friends" in the second service
 * would be a second implementation of an authorization rule, which is the
 * shape of every bug this kind of check exists to prevent.
 *
 * It moves into `user-service` with the rest of the social graph when the
 * schema is split - see the open item in development/TRACK.md.
 */
import { prisma } from './client';

/**
 * Lower id first, so one pair is one row however the request was made.
 *
 * The same rule `friends.service.ts` writes rows with. Getting it wrong here
 * does not throw - it silently finds nothing, which reads as "not friends" and
 * would quietly refuse every legitimate add.
 */
export function orderedPair(left: string, right: string): [string, string] {
  return left < right ? [left, right] : [right, left];
}

/**
 * True when these two have an accepted friendship.
 *
 * A pending request is not a friendship. Treating it as one would make "send a
 * request and add them anyway" the way past the check, which is the check
 * doing nothing.
 */
export async function areFriends(left: string, right: string): Promise<boolean> {
  if (left === right) return false;
  const [userAId, userBId] = orderedPair(left, right);

  const row = await prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { status: true },
  });
  return row?.status === 'ACCEPTED';
}

/** Every accepted friend of one account, as ids. */
export async function friendIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    select: { userAId: true, userBId: true },
  });
  return rows.map((row) => (row.userAId === userId ? row.userBId : row.userAId));
}
