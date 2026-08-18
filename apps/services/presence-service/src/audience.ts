/**
 * Who is entitled to hear a given piece of presence.
 *
 * Every presence event used to go to every connected socket: a stranger going
 * idle, somebody typing in a channel on a server you are not in, a voice roster
 * for a room you cannot see. That is a privacy problem before it is a traffic
 * problem - the online list was effectively the whole deployment's user
 * directory, and a typing event named a channel id and a username to people
 * with no business knowing either.
 *
 * Two questions answer all of it, and both are symmetric, which is what makes
 * them cheap: the set of people who may hear about a *user* is the same set
 * that user may hear about, so an event is scoped once rather than once per
 * recipient.
 *
 * ponytail: a small TTL cache, not an invalidation scheme. Joining a server
 * means the new member's dot appears to the others within the TTL rather than
 * instantly, which is the same order of delay as the heartbeat that maintains
 * the online set in the first place.
 */
import { prisma } from '@betweenus/database';

/** How long an answer is reused. Long enough to matter, short enough to be dull. */
const TTL_MS = 30_000;

interface Cached {
  at: number;
  ids: Set<string>;
}

const userCache = new Map<string, Cached>();
const channelCache = new Map<string, Cached>();

function fresh(entry: Cached | undefined): Set<string> | null {
  if (!entry) return null;
  return Date.now() - entry.at < TTL_MS ? entry.ids : null;
}

/**
 * Everybody who shares a server with this user, plus their accepted friends,
 * plus the user themselves.
 *
 * A friendship counts on its own because a direct message is not on any server:
 * without it, two friends with no server in common would each see the other as
 * permanently offline.
 */
export async function audienceOfUser(userId: string): Promise<Set<string>> {
  const cached = fresh(userCache.get(userId));
  if (cached) return cached;

  const memberships = await prisma.serverMember.findMany({
    where: { userId },
    select: { serverId: true },
  });
  const serverIds = memberships.map((row) => row.serverId);

  const [peers, friendships] = await Promise.all([
    serverIds.length > 0
      ? prisma.serverMember.findMany({
          where: { serverId: { in: serverIds } },
          select: { userId: true },
        })
      : Promise.resolve([] as { userId: string }[]),
    prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userBId: true },
    }),
  ]);

  const ids = new Set<string>([userId]);
  for (const peer of peers) ids.add(peer.userId);
  for (const friendship of friendships) {
    ids.add(friendship.userAId);
    ids.add(friendship.userBId);
  }

  userCache.set(userId, { at: Date.now(), ids });
  return ids;
}

/**
 * Everybody entitled to know what happens in a channel: its allowlist when it
 * is private or a direct message, and the server's membership when it is not.
 *
 * A missing channel answers with nobody rather than everybody. An event about a
 * channel that does not exist is not an event anybody needs.
 */
export async function audienceOfChannel(channelId: string): Promise<Set<string>> {
  const cached = fresh(channelCache.get(channelId));
  if (cached) return cached;

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      serverId: true,
      isPrivate: true,
      members: { select: { userId: true } },
    },
  });

  const ids = new Set<string>();
  if (!channel) {
    channelCache.set(channelId, { at: Date.now(), ids });
    return ids;
  }

  if (channel.serverId === null || channel.isPrivate) {
    // A DM has exactly its two participants; a private channel has its
    // allowlist, and server membership grants nothing on top of it.
    for (const member of channel.members) ids.add(member.userId);
  } else {
    const members = await prisma.serverMember.findMany({
      where: { serverId: channel.serverId },
      select: { userId: true },
    });
    for (const member of members) ids.add(member.userId);
  }

  channelCache.set(channelId, { at: Date.now(), ids });
  return ids;
}

/** Called when membership changes underneath the cache, and by the tests. */
export function forgetAudiences(): void {
  userCache.clear();
  channelCache.clear();
}
