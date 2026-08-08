/**
 * Friends, and the direct message channels they unlock.
 *
 * This is user-level data and belongs in `user-service` once that exists - the
 * same deliberate shortcut the E2EE device directory takes, and recorded in
 * development/PLANNING.md. It lives in chat-service because a direct message is
 * a channel and chat-service already owns everything downstream of a channel id.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@nexora/database';
import type {
  DirectChannel,
  Friend,
  FriendshipStatus,
  UserSummary,
} from '@nexora/shared-types';

const SEARCH_LIMIT = 20;

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

@Injectable()
export class FriendsService {
  /**
   * Finds people by username or display name. Anyone is findable, because a
   * request cannot be sent to someone who cannot be found; what is gated is the
   * conversation, not the search.
   */
  async search(userId: string, query: string): Promise<UserSummary[]> {
    const term = query.trim();
    if (term.length < 2) return [];

    const rows = await prisma.user.findMany({
      where: {
        id: { not: userId },
        disabledAt: null,
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { displayName: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
      orderBy: { username: 'asc' },
      take: SEARCH_LIMIT,
    });
    return rows.map(toSummary);
  }

  /** Accepted friends and pending requests in both directions, one list. */
  async list(userId: string): Promise<Friend[]> {
    const rows = await prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      include: { userA: true, userB: true },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => {
      const other = row.userAId === userId ? row.userB : row.userA;
      const status = row.status as FriendshipStatus;
      return {
        user: toSummary(other),
        status,
        direction:
          status === 'ACCEPTED' ? null : row.requesterId === userId ? 'outgoing' : 'incoming',
        since: row.updatedAt.toISOString(),
      };
    });
  }

  /**
   * Sends a request, or accepts one that was already waiting - if they asked
   * first and you ask back, the obvious reading is yes.
   */
  async request(userId: string, username: string): Promise<Friend> {
    const target = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (!target || target.disabledAt !== null) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No such user' });
    }
    if (target.id === userId) {
      throw new BadRequestException({
        code: 'CANNOT_FRIEND_SELF',
        message: 'You are already your own company',
      });
    }

    const [userAId, userBId] = orderedPair(userId, target.id);
    const existing = await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    });

    if (existing?.status === 'ACCEPTED') return this.friendOf(userId, existing.id);
    if (existing) {
      // They asked first: treat the answering request as the acceptance.
      if (existing.requesterId !== userId) {
        await prisma.friendship.update({
          where: { id: existing.id },
          data: { status: 'ACCEPTED' },
        });
      }
      return this.friendOf(userId, existing.id);
    }

    const created = await prisma.friendship.create({
      data: { userAId, userBId, requesterId: userId, status: 'PENDING' },
    });
    return this.friendOf(userId, created.id);
  }

  /** Only the side that did not ask may accept. */
  async accept(userId: string, otherUserId: string): Promise<Friend> {
    const friendship = await this.require(userId, otherUserId);
    if (friendship.status === 'ACCEPTED') return this.friendOf(userId, friendship.id);
    if (friendship.requesterId === userId) {
      throw new ForbiddenException({
        code: 'CANNOT_ACCEPT_OWN_REQUEST',
        message: 'Wait for them to accept',
      });
    }

    await prisma.friendship.update({ where: { id: friendship.id }, data: { status: 'ACCEPTED' } });
    return this.friendOf(userId, friendship.id);
  }

  /** Declining, cancelling and unfriending are all "there is no relationship". */
  async remove(userId: string, otherUserId: string): Promise<void> {
    const friendship = await this.require(userId, otherUserId);
    await prisma.friendship.delete({ where: { id: friendship.id } });
  }

  /** Direct message channels this user is part of, most recent first. */
  async directChannels(userId: string): Promise<DirectChannel[]> {
    const channels = await prisma.channel.findMany({
      where: { type: 'DM', members: { some: { userId } } },
      include: { members: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return channels
      .map((channel) => {
        const other = channel.members.find((member) => member.userId !== userId);
        if (!other) return null;
        return {
          channelId: channel.id,
          participant: toSummary(other.user),
          createdAt: channel.createdAt.toISOString(),
        };
      })
      .filter((channel): channel is DirectChannel => channel !== null);
  }

  /**
   * Opens the conversation with a friend, or returns the one that is already
   * open. Friendship is the gate: without it the search endpoint would be a way
   * to put a message in front of anyone at all.
   */
  async openDirectChannel(userId: string, otherUserId: string): Promise<DirectChannel> {
    const friendship = await this.require(userId, otherUserId);
    if (friendship.status !== 'ACCEPTED') {
      throw new ForbiddenException({
        code: 'NOT_FRIENDS',
        message: 'You can only message an accepted friend',
      });
    }

    const existing = await prisma.channel.findFirst({
      where: {
        type: 'DM',
        AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherUserId } } }],
      },
      include: { members: { include: { user: true } } },
    });

    const channel =
      existing ??
      (await prisma.channel.create({
        data: {
          // A DM has no server, and its name is never shown - the other person's
          // name is what the client puts in the header.
          serverId: null,
          name: `dm-${userId.slice(0, 8)}-${otherUserId.slice(0, 8)}`,
          type: 'DM',
          isPrivate: true,
          members: { create: [{ userId }, { userId: otherUserId }] },
        },
        include: { members: { include: { user: true } } },
      }));

    const other = channel.members.find((member) => member.userId !== userId);
    if (!other) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    return {
      channelId: channel.id,
      participant: toSummary(other.user),
      createdAt: channel.createdAt.toISOString(),
    };
  }

  private async require(
    userId: string,
    otherUserId: string,
  ): Promise<{ id: string; status: string; requesterId: string }> {
    const [userAId, userBId] = orderedPair(userId, otherUserId);
    const friendship = await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      select: { id: true, status: true, requesterId: true },
    });
    if (!friendship) {
      throw new NotFoundException({
        code: 'FRIENDSHIP_NOT_FOUND',
        message: 'No request or friendship with that user',
      });
    }
    return friendship;
  }

  private async friendOf(userId: string, friendshipId: string): Promise<Friend> {
    const row = await prisma.friendship.findUniqueOrThrow({
      where: { id: friendshipId },
      include: { userA: true, userB: true },
    });
    const other = row.userAId === userId ? row.userB : row.userA;
    const status = row.status as FriendshipStatus;
    return {
      user: toSummary(other),
      status,
      direction: status === 'ACCEPTED' ? null : row.requesterId === userId ? 'outgoing' : 'incoming',
      since: row.updatedAt.toISOString(),
    };
  }
}

/** Lower id first, so one pair is one row however the request was made. */
function orderedPair(left: string, right: string): [string, string] {
  return left < right ? [left, right] : [right, left];
}

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
  };
}
