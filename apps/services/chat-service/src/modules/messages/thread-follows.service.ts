import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, resolveChannelAccess } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { PERMISSIONS } from '@betweenus/permissions';
import type { FollowedThread, ThreadFollowState } from '@betweenus/shared-types';
import { MESSAGE_INCLUDE, MessagesService, toMessage } from './messages.service';
import {
  advancedMarker,
  findRootFacts,
  followStateOf,
  type RootFacts,
} from './thread-follows';

/** The most followed threads one list returns, most recently active first. */
const LIST_LIMIT = 100;

/**
 * Following threads, and reading them.
 *
 * Every route resolves the caller's access to the thread's channel through
 * `resolveChannelAccess` (by way of `MessagesService.requireChannelAccess`), and
 * a thread in a channel the caller cannot see answers the same 404 as one that
 * does not exist.
 */
@Injectable()
export class ThreadFollowsService {
  constructor(
    private readonly messages: MessagesService,
    private readonly events: EventBus,
  ) {}

  /**
   * The threads this account follows, with each root and its unread count.
   * `serverId` narrows it to one server's channels; absent, it is every
   * thread the account follows anywhere, direct messages included.
   *
   * A follow in a channel the caller can no longer see, or under a root
   * older than their own history cut-off, is left out rather than deleted -
   * it comes back if the access does.
   */
  async list(userId: string, serverId?: string): Promise<FollowedThread[]> {
    const rows = await prisma.threadFollow.findMany({
      where: {
        userId,
        following: true,
        ...(serverId ? { root: { channel: { serverId } } } : {}),
      },
      include: {
        root: { include: { ...MESSAGE_INCLUDE, channel: { select: { serverId: true } } } },
      },
      orderBy: { root: { threadLastReplyAt: { sort: 'desc', nulls: 'last' } } },
      take: LIST_LIMIT,
    });

    const visible = new Map<string, boolean>();
    const out: FollowedThread[] = [];
    for (const row of rows) {
      const channelId = row.root.channelId;
      if (!visible.has(channelId)) {
        const access = await resolveChannelAccess(userId, channelId);
        visible.set(
          channelId,
          Boolean(access && access.permissions.includes(PERMISSIONS.VIEW_CHANNEL)),
        );
      }
      if (!visible.get(channelId)) continue;
      const floor = await this.messages.historyFloor(userId, channelId);
      if (floor && row.root.createdAt.getTime() <= floor.getTime()) continue;

      const state = await followStateOf(userId, row.root, row);
      out.push({ ...state, root: toMessage(row.root) });
    }
    return out;
  }

  /**
   * Follows or stops following one thread. Idempotent either way, and an
   * unfollow is kept as a row so the root's author is not signed back up by
   * the next reply. Following does not move the read marker: whatever was
   * unread stays unread.
   */
  async setFollowing(userId: string, rootId: string, following: boolean): Promise<ThreadFollowState> {
    const root = await this.requireRoot(userId, rootId);
    const row = await prisma.threadFollow.upsert({
      where: { userId_rootId: { userId, rootId } },
      create: { userId, rootId, following },
      update: { following },
      select: { following: true, lastReadAt: true },
    });
    return this.announce(userId, root, row);
  }

  /**
   * Moves the caller's marker in one thread up to `messageId`, which must be a
   * reply in that thread. Never backwards. A thread the caller does not
   * follow has no marker to move and answers its (unfollowed) state: reading
   * a thread is not asking to be told about it.
   */
  async markRead(userId: string, rootId: string, messageId: string): Promise<ThreadFollowState> {
    const root = await this.requireRoot(userId, rootId);
    const reply = await prisma.message.findFirst({
      where: { id: messageId, threadRootId: rootId },
      select: { createdAt: true },
    });
    if (!reply) {
      throw new BadRequestException({
        code: 'NOT_A_THREAD_REPLY',
        message: 'That message is not a reply in this thread',
      });
    }

    const existing = await prisma.threadFollow.findUnique({
      where: { userId_rootId: { userId, rootId } },
      select: { following: true, lastReadAt: true },
    });
    if (!existing) return followStateOf(userId, root, null);

    const next = advancedMarker(existing.lastReadAt, reply.createdAt);
    if (existing.lastReadAt && next.getTime() === existing.lastReadAt.getTime()) {
      return followStateOf(userId, root, existing);
    }
    const row = await prisma.threadFollow.update({
      where: { userId_rootId: { userId, rootId } },
      data: { lastReadAt: next },
      select: { following: true, lastReadAt: true },
    });
    return this.announce(userId, root, row);
  }

  /** Works the state out, tells the caller's other devices, and returns it. */
  private async announce(
    userId: string,
    root: RootFacts,
    row: { following: boolean; lastReadAt: Date | null },
  ): Promise<ThreadFollowState> {
    const thread = await followStateOf(userId, root, row);
    await this.events.publish(EVENTS.THREAD_FOLLOW_CHANGED, { userId, thread });
    return thread;
  }

  /**
   * A message that can be a thread root, in a channel the caller can see.
   * A reply, or a message in a hidden channel, is "not found" either way.
   */
  private async requireRoot(userId: string, rootId: string): Promise<RootFacts> {
    const root = await findRootFacts(rootId);
    if (!root || root.threadRootId) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    const access = await resolveChannelAccess(userId, root.channelId);
    if (!access || !access.permissions.includes(PERMISSIONS.VIEW_CHANNEL)) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    return root;
  }
}
