import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { prisma, type ChannelAccess } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { PERMISSIONS, type Permission } from '@betweenus/permissions';
import type { Message } from '@betweenus/shared-types';
import { MESSAGE_INCLUDE, MessagesService, toMessage } from './messages.service';
import { judgeBallot, pollIsClosed, type PollState } from './poll-rules';

/** A poll message, the caller's access to its channel, and the state a ballot is judged by. */
interface PollTarget {
  id: string;
  authorId: string;
  access: ChannelAccess;
  poll: PollState;
}

/**
 * The poll referee.
 *
 * It lives in chat-service rather than in call-service, where Play Together's
 * referee is, because a poll is a message: it is sent down the same route,
 * stored in the same row, deleted, pinned and expired with it, and fanned out
 * by the same `message.updated` event its reactions already use. What it
 * borrows from call-service is the *shape* - the client sends a number, the
 * server checks the number against rules it can evaluate without reading
 * anything, and every client draws the count that comes back rather than one
 * it worked out itself.
 */
@Injectable()
export class PollsService {
  constructor(
    private readonly messages: MessagesService,
    private readonly events: EventBus,
  ) {}

  /**
   * Replaces the caller's ballot with `options`. An empty list takes the vote
   * back; the same list twice is a no-op that still answers with the tally.
   *
   * Voting is speaking in the channel, so it takes `SEND_MESSAGE` - the same
   * permission a reaction does.
   */
  async vote(userId: string, messageId: string, options: number[]): Promise<Message> {
    const target = await this.requirePoll(userId, messageId, PERMISSIONS.SEND_MESSAGE);

    const judged = judgeBallot(target.poll, options, new Date());
    if (!judged.ok) {
      const body = { code: judged.code, message: judged.message };
      throw judged.code === 'POLL_CLOSED'
        ? new ConflictException(body)
        : new BadRequestException(body);
    }

    // The whole ballot is replaced in one transaction, so a reader never sees
    // somebody who switched from A to B counted under both or under neither.
    // `skipDuplicates` covers two devices casting the same ballot at once: the
    // unique index is what stops an option being counted twice for one person.
    await prisma.$transaction([
      prisma.pollVote.deleteMany({ where: { messageId: target.id, userId } }),
      prisma.pollVote.createMany({
        data: judged.value.map((option) => ({ messageId: target.id, userId, option })),
        skipDuplicates: true,
      }),
    ]);

    return this.broadcast(target.id);
  }

  /**
   * Stops voting early. The author may always close their own poll; anybody
   * else needs `MANAGE_MESSAGE`, which is what a moderator holds. In a direct
   * message there is no role to hold, so only the author can.
   *
   * Idempotent: closing a closed poll answers with it rather than an error,
   * because two people pressing close at once both got what they asked for.
   */
  async close(userId: string, messageId: string): Promise<Message> {
    const target = await this.requirePoll(userId, messageId, PERMISSIONS.VIEW_CHANNEL);

    const mine = target.authorId === userId;
    const moderator =
      target.access.serverId !== null &&
      target.access.permissions.includes(PERMISSIONS.MANAGE_MESSAGE);
    if (!mine && !moderator) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: 'Only the author or a moderator can close this poll',
      });
    }

    if (!pollIsClosed(target.poll, new Date())) {
      // Conditional, so a second close cannot move the stamp or the name.
      await prisma.messagePoll.updateMany({
        where: { messageId: target.id, closedAt: null },
        data: { closedAt: new Date(), closedById: userId },
      });
    }

    return this.broadcast(target.id);
  }

  /** Reads the message back whole and tells the channel, like a reaction does. */
  private async broadcast(messageId: string): Promise<Message> {
    const row = await prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });
    const message = toMessage(row);
    await this.events.publish(EVENTS.MESSAGE_UPDATED, { message });
    return message;
  }

  /**
   * A live poll the caller may act on. Access is checked before anything
   * about the poll is revealed, so a stranger learns neither that the message
   * exists nor that it is a poll - both answer the same 404.
   */
  private async requirePoll(
    userId: string,
    messageId: string,
    permission: Permission,
  ): Promise<PollTarget> {
    const row = await prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: {
        id: true,
        channelId: true,
        authorId: true,
        poll: {
          select: { optionCount: true, multiChoice: true, closesAt: true, closedAt: true },
        },
      },
    });
    if (!row) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    const access = await this.messages.requireChannelAccess(userId, row.channelId, permission);
    if (!row.poll) {
      throw new NotFoundException({ code: 'POLL_NOT_FOUND', message: 'That message is not a poll' });
    }
    const poll: PollState = row.poll;
    return { id: row.id, authorId: row.authorId, access, poll };
  }
}
