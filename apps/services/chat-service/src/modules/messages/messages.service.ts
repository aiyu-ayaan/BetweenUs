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
   * Deletes a message. The author may always delete their own; anyone else
   * needs `DELETE_MESSAGE` in that channel, which is what a moderator holds.
   *
   * It is a soft delete: `deletedAt` is set and the body is emptied, so the row
   * still anchors the `before` cursor of a page that was already handed out and
   * the ciphertext stops existing at the same moment. Attachment blobs are not
   * swept yet - development/TODO.md carries that, and it is a storage job, not
   * a message one.
   */
  async remove(userId: string, messageId: string): Promise<void> {
    const row = await prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, channelId: true, authorId: true },
    });
    // A message in a channel the caller cannot see must answer the same way as
    // one that never existed.
    if (!row) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }

    const access = await this.requireChannelAccess(
      userId,
      row.channelId,
      PERMISSIONS.VIEW_CHANNEL,
    );
    if (
      row.authorId !== userId &&
      !access.permissions.includes(PERMISSIONS.DELETE_MESSAGE)
    ) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: 'You can only delete your own messages here',
      });
    }

    await prisma.message.update({
      where: { id: row.id },
      data: { deletedAt: new Date(), content: '' },
    });
    await this.events.publish(EVENTS.MESSAGE_DELETED, {
      messageId: row.id,
      channelId: row.channelId,
    });
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
