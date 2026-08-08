import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, resolveChannelAccess, type ChannelAccess } from '@nexora/database';
import { EVENTS, EventBus } from '@nexora/events';
import { PERMISSIONS, type Permission } from '@nexora/permissions';
import type { Message, Paginated } from '@nexora/shared-types';

const PAGE_SIZE = 50;
// Content is an encrypted envelope, so the limit covers base64 expansion of a
// 4000-character message plus the JSON wrapper.
const MAX_CONTENT_LENGTH = 8000;

@Injectable()
export class MessagesService {
  constructor(private readonly events: EventBus) {}

  /**
   * Newest-first page of a channel's history. `before` is a message id; the
   * cursor is opaque to the client.
   */
  async history(userId: string, channelId: string, before?: string): Promise<Paginated<Message>> {
    await this.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);

    const cursor = before
      ? await prisma.message.findUnique({ where: { id: before }, select: { createdAt: true } })
      : null;

    const rows = await prisma.message.findMany({
      where: {
        channelId,
        deletedAt: null,
        ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}),
      },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    });

    const items = rows.map(toMessage).reverse();
    const oldest = rows[rows.length - 1];
    return {
      items,
      nextCursor: rows.length === PAGE_SIZE && oldest ? oldest.id : null,
    };
  }

  async send(userId: string, channelId: string, content: string): Promise<Message> {
    await this.requireChannelAccess(userId, channelId, PERMISSIONS.SEND_MESSAGE);

    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CONTENT_LENGTH) {
      throw new ForbiddenException({
        code: 'INVALID_MESSAGE',
        message: `Message must be 1-${MAX_CONTENT_LENGTH} characters`,
      });
    }

    const row = await prisma.message.create({
      data: { channelId, authorId: userId, content: trimmed },
      include: { author: true },
    });

    const message = toMessage(row);
    // The WebSocket gateway - in this process and in every other instance -
    // fans this out to subscribed sockets.
    await this.events.publish(EVENTS.MESSAGE_CREATED, { message });
    return message;
  }

  /**
   * Access is resolved by `@nexora/database`, which is also what call- and
   * presence-service ask; the three of them used to keep their own copy of this
   * check. A channel the caller cannot see answers 404, not 403, so channel ids
   * cannot be probed for.
   */
  async requireChannelAccess(
    userId: string,
    channelId: string,
    permission: Permission,
  ): Promise<ChannelAccess> {
    const access = await resolveChannelAccess(userId, channelId);
    if (!access) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    if (!access.permissions.includes(permission)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: `Missing permission ${permission}`,
      });
    }
    return access;
  }
}

interface MessageRow {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channelId: row.channelId,
    content: row.content,
    author: {
      id: row.author.id,
      username: row.author.username,
      displayName: row.author.displayName,
      avatarUrl: row.author.avatarUrl,
    },
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
  };
}
