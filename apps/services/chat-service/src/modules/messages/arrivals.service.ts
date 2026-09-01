/**
 * "VILEN is here."
 *
 * A server's member list is a screen somebody has to go and look at, so joining
 * used to be invisible: the first anyone knew of a new person was a message
 * from a name they had never seen. Discord's answer is the right one and this
 * is it - the conversation itself notes the arrival, in place, at the moment it
 * happened, so scrolling back tells you who turned up and when.
 *
 * It lives in chat-service rather than in server-service, which owns the
 * membership, for one reason: a row in a conversation is this service's, and so
 * is the `message.created` fan-out that puts it on everybody's screen. The
 * membership change arrives as an event like any other.
 *
 * Nothing here is encrypted, and nothing here needs to be. The row carries no
 * body at all: `kind` says what happened and `author` says who it happened to,
 * and both are facts the server already holds - it wrote the membership row a
 * moment ago. The sentence is the client's, which is also why it is in the
 * reader's language rather than in this file's.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { prisma } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { Logger } from '@betweenus/logger';
import { toMessage } from './messages.service';

@Injectable()
export class ArrivalsService implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.events.subscribe(EVENTS.SERVER_MEMBER_ADDED, (envelope) => {
      const { serverId, userId } = envelope.payload;
      void this.announce(serverId, userId).catch((error: unknown) => {
        // A greeting that could not be written is not worth failing a join
        // over. They are in the server either way, which is the part that
        // mattered.
        this.logger.warn('Could not note an arrival', {
          serverId,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  /**
   * Where the line goes: the channel the server has had longest.
   *
   * Which is `#general` on a server nobody has rearranged, and on one that has
   * been rearranged it is still the channel everybody can see - it predates the
   * private ones, and a private one is exactly where an arrival must not be
   * announced. A voice channel has no history to put it in.
   */
  private async announce(serverId: string, userId: string): Promise<void> {
    const channel = await prisma.channel.findFirst({
      where: { serverId, type: 'TEXT', isPrivate: false },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!channel) return;

    // Said once. A membership event can be republished - a retry, two replicas
    // reading the same message - and a conversation that says somebody arrived
    // four times is worse than one that never said so.
    const already = await prisma.message.findFirst({
      where: { channelId: channel.id, authorId: userId, kind: 'MEMBER_JOIN' },
      select: { id: true },
    });
    if (already) return;

    const row = await prisma.message.create({
      data: { channelId: channel.id, authorId: userId, kind: 'MEMBER_JOIN', content: '' },
      include: { author: true, deletedBy: true, reactions: true, views: true },
    });

    await this.events.publish(EVENTS.MESSAGE_CREATED, { message: toMessage(row) });
  }
}
