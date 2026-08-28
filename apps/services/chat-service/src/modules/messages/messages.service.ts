import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, resolveChannelAccess, type ChannelAccess } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { PERMISSIONS, type Permission } from '@betweenus/permissions';
import type {
  ClearChatsResponse,
  Message,
  MessageReactionSummary,
  Paginated,
} from '@betweenus/shared-types';

const PAGE_SIZE = 50;
// Content is an encrypted envelope, so the limit covers base64 expansion of a
// 4000-character message plus the JSON wrapper.
const MAX_CONTENT_LENGTH = 8000;
/**
 * An emoji is a handful of code points - a base, a skin tone, a zero-width
 * joiner, a variation selector. The cap is on the string, not on how many
 * characters a human would count, and it exists so the column cannot be used as
 * free storage.
 */
const MAX_EMOJI_LENGTH = 32;
/** How many distinct people's reactions one message may carry. */
const MAX_REACTIONS_PER_MESSAGE = 200;

/**
 * The later of two cut-offs, treating null as "no cut-off at all" rather than
 * as the beginning of time - which is the difference between hiding nothing and
 * hiding everything.
 */
export function laterOf(left: Date | null, right: Date | null): Date | null {
  if (left === null) return right;
  if (right === null) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

/** Everything a `Message` is built from, in one place so every path agrees. */
const MESSAGE_INCLUDE = {
  author: true,
  deletedBy: true,
  reactions: { select: { userId: true, emoji: true } },
} as const;

@Injectable()
export class MessagesService {
  constructor(private readonly events: EventBus) {}

  /**
   * Newest-first page of a channel's history. `before` is a message id; the
   * cursor is opaque to the client.
   *
   * Deleted messages are included as tombstones - the body is already empty in
   * the database, and a conversation that silently closes over a removed
   * message is harder to follow than one that says something was here.
   */
  async history(userId: string, channelId: string, before?: string): Promise<Paginated<Message>> {
    await this.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);

    const cursor = before
      ? await prisma.message.findUnique({ where: { id: before }, select: { createdAt: true } })
      : null;

    const clearedAt = await this.clearedAt(userId, channelId);
    const rows = await prisma.message.findMany({
      where: {
        channelId,
        ...(cursor || clearedAt
          ? {
              createdAt: {
                ...(cursor ? { lt: cursor.createdAt } : {}),
                ...(clearedAt ? { gt: clearedAt } : {}),
              },
            }
          : {}),
      },
      include: MESSAGE_INCLUDE,
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

  /** Pinned messages of one channel, most recently pinned first. */
  async pins(userId: string, channelId: string): Promise<Message[]> {
    await this.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);

    const clearedAt = await this.clearedAt(userId, channelId);
    const rows = await prisma.message.findMany({
      where: {
        channelId,
        pinnedAt: { not: null },
        deletedAt: null,
        ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
      },
      include: MESSAGE_INCLUDE,
      orderBy: { pinnedAt: 'desc' },
      take: 100,
    });
    return rows.map(toMessage);
  }

  /**
   * Hides everything this account can currently see, everywhere, on every one
   * of its devices.
   *
   * Nothing is deleted. It cannot be: a message has two ends, the other one is
   * somebody else's history, and a button on this side that reached across and
   * took it away would be a different feature with a different name. What this
   * does is move one marker on the account, which every read path already
   * respects - so the other participant's view is untouched and this account's
   * phone, laptop and browser all agree without any of them being told
   * individually what to forget.
   *
   * "Everything it can currently see" and not "everything up to now": the cut
   * is stamped at the moment of the call, so a message that arrives a second
   * later is new mail rather than something the button quietly ate.
   */
  async clearChats(userId: string, channelId?: string | null): Promise<ClearChatsResponse> {
    const clearedAt = new Date();

    if (channelId) {
      // The same 404-for-both rule every other channel route follows, so a
      // stranger cannot use this to find out which channel ids exist.
      await this.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);
      // The marker sits on the read row, which may not exist yet - somebody can
      // clear a conversation they have never opened on this device.
      await prisma.channelRead.upsert({
        where: { userId_channelId: { userId, channelId } },
        create: { userId, channelId, clearedAt },
        update: { clearedAt },
      });
    } else {
      await prisma.user.update({ where: { id: userId }, data: { chatsClearedAt: clearedAt } });
    }

    // The other devices are holding decrypted copies in their own caches, which
    // no refetch would clear - so this is carried rather than announced.
    await this.events.publish(EVENTS.CHATS_CLEARED, {
      userId,
      clearedAt: clearedAt.toISOString(),
      channelId: channelId ?? null,
    });
    return { clearedAt: clearedAt.toISOString(), channelId: channelId ?? null };
  }

  /**
   * This account's cut-off in this conversation: whichever of the two markers
   * is later, or null when it has never cleared anything.
   *
   * Two markers and not one because they answer different questions and neither
   * subsumes the other. "Clear everything" is one write on the account rather
   * than a fan-out over every channel; "clear this conversation" is one write
   * on the row that already exists per (user, channel). Later wins, so clearing
   * everything and then clearing one conversation again does the obvious thing,
   * and so does the reverse.
   *
   * ponytail: two lookups per history page, both primary-key reads. Fold them
   * into the access check's query if a profiler ever says otherwise.
   */
  private async clearedAt(userId: string, channelId: string): Promise<Date | null> {
    const [account, conversation] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { chatsClearedAt: true } }),
      prisma.channelRead.findUnique({
        where: { userId_channelId: { userId, channelId } },
        select: { clearedAt: true },
      }),
    ]);
    return laterOf(account?.chatsClearedAt ?? null, conversation?.clearedAt ?? null);
  }

  async send(
    userId: string,
    channelId: string,
    content: string,
    attachmentKeys: string[] = [],
  ): Promise<Message> {
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
      include: MESSAGE_INCLUDE,
    });

    // The blobs become this message's, so deleting it can take them with it.
    // Scoped to unclaimed uploads of this account: a key is not a capability,
    // and naming somebody else's must not move it.
    if (attachmentKeys.length > 0) {
      await prisma.attachment.updateMany({
        where: { key: { in: attachmentKeys.slice(0, 50) }, uploaderId: userId, messageId: null },
        data: { messageId: row.id },
      });
    }

    const message = toMessage(row);
    // The WebSocket gateway - in this process and in every other instance -
    // fans this out to subscribed sockets.
    await this.events.publish(EVENTS.MESSAGE_CREATED, { message });
    return message;
  }

  /**
   * Rewrites the body. The author only - a moderator may remove a message but
   * never put different words in somebody's mouth - and `editedAt` is stamped
   * so every client can say so.
   *
   * The new body replaces the old ciphertext, so an edit is not recoverable
   * from the database. There is no edit history and this build does not pretend
   * to keep one.
   */
  async edit(userId: string, messageId: string, content: string): Promise<Message> {
    const existing = await this.require(messageId);
    await this.requireChannelAccess(userId, existing.channelId, PERMISSIONS.SEND_MESSAGE);

    if (existing.authorId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_MESSAGE_AUTHOR',
        message: 'Only the author can edit a message',
      });
    }

    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException({
        code: 'INVALID_MESSAGE',
        message: `Message must be 1-${MAX_CONTENT_LENGTH} characters`,
      });
    }

    const row = await prisma.message.update({
      where: { id: existing.id },
      data: { content: trimmed, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });

    const message = toMessage(row);
    await this.events.publish(EVENTS.MESSAGE_UPDATED, { message });
    return message;
  }

  /**
   * Deletes a message. The author may always delete their own; anyone else
   * needs `DELETE_MESSAGE` in that channel, which is what a moderator holds.
   *
   * It is a soft delete: `deletedAt` and, when somebody else did it,
   * `deletedById` are set and the body is emptied. The row stays so the
   * conversation can show a tombstone and so a page cursor handed out a moment
   * ago still points somewhere; the ciphertext does not. The blobs it carried
   * go too, but not here: the attachment sweeper collects what a deleted
   * message no longer justifies, so a delete stays one row update.
   */
  async remove(userId: string, messageId: string): Promise<void> {
    const existing = await this.require(messageId);

    const access = await this.requireChannelAccess(
      userId,
      existing.channelId,
      PERMISSIONS.VIEW_CHANNEL,
    );
    const mine = existing.authorId === userId;
    if (!mine && !access.permissions.includes(PERMISSIONS.DELETE_MESSAGE)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: 'You can only delete your own messages here',
      });
    }

    const row = await prisma.message.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        // Null when the author took their own message back: a client only
        // names the person when it was somebody else.
        deletedById: mine ? null : userId,
        content: '',
        // A deleted message cannot stay pinned, and its reactions go with it.
        pinnedAt: null,
        pinnedById: null,
        reactions: { deleteMany: {} },
      },
      include: MESSAGE_INCLUDE,
    });

    await this.events.publish(EVENTS.MESSAGE_DELETED, {
      messageId: row.id,
      channelId: row.channelId,
      message: toMessage(row),
    });
  }

  /**
   * Pins or unpins. In a server channel this is `MANAGE_MESSAGE`, because a pin
   * is a claim on everybody's channel header; in a direct message there is no
   * role to hold, so either participant may pin.
   */
  async setPinned(userId: string, messageId: string, pinned: boolean): Promise<Message> {
    const existing = await this.require(messageId);
    const access = await this.requireChannelAccess(
      userId,
      existing.channelId,
      PERMISSIONS.VIEW_CHANNEL,
    );

    if (access.serverId !== null && !access.permissions.includes(PERMISSIONS.MANAGE_MESSAGE)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: `Missing permission ${PERMISSIONS.MANAGE_MESSAGE}`,
      });
    }

    const row = await prisma.message.update({
      where: { id: existing.id },
      data: pinned
        ? { pinnedAt: new Date(), pinnedById: userId }
        : { pinnedAt: null, pinnedById: null },
      include: MESSAGE_INCLUDE,
    });

    const message = toMessage(row);
    await this.events.publish(EVENTS.MESSAGE_UPDATED, { message });
    return message;
  }

  /**
   * Adds or removes the caller's reaction. Reacting twice with the same emoji
   * takes it back, which is what every client that has one does.
   *
   * The emoji is stored in the clear - see development/E2EE.md. It is the one
   * part of a message the server can read, and it is documented rather than
   * hidden.
   */
  async react(userId: string, messageId: string, emoji: string): Promise<Message> {
    const existing = await this.require(messageId);
    // Reacting is speaking in the channel, so it takes the same permission.
    await this.requireChannelAccess(userId, existing.channelId, PERMISSIONS.SEND_MESSAGE);

    const symbol = emoji.trim();
    if (symbol.length === 0 || symbol.length > MAX_EMOJI_LENGTH || /\s/.test(symbol)) {
      throw new BadRequestException({
        code: 'INVALID_EMOJI',
        message: 'That is not an emoji',
      });
    }

    const already = await prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId: existing.id, userId, emoji: symbol } },
      select: { id: true },
    });

    if (already) {
      await prisma.messageReaction.delete({ where: { id: already.id } });
    } else {
      const total = await prisma.messageReaction.count({ where: { messageId: existing.id } });
      if (total >= MAX_REACTIONS_PER_MESSAGE) {
        throw new BadRequestException({
          code: 'TOO_MANY_REACTIONS',
          message: 'That message has all the reactions it can hold',
        });
      }
      await prisma.messageReaction.create({
        data: { messageId: existing.id, userId, emoji: symbol },
      });
    }

    const row = await prisma.message.findUniqueOrThrow({
      where: { id: existing.id },
      include: MESSAGE_INCLUDE,
    });
    const message = toMessage(row);
    await this.events.publish(EVENTS.MESSAGE_UPDATED, { message });
    return message;
  }

  /**
   * Access is resolved by `@betweenus/database`, which is also what call- and
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

  /**
   * A live message, by id. A deleted one is gone as far as every write path is
   * concerned - it cannot be edited, pinned, reacted to or deleted again - and
   * a message in a channel the caller cannot see answers the same 404 as one
   * that never existed, because the access check has not run yet at this point.
   */
  private async require(
    messageId: string,
  ): Promise<{ id: string; channelId: string; authorId: string }> {
    const row = await prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, channelId: true, authorId: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    return row;
  }
}

interface MessageRow {
  id: string;
  channelId: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  pinnedAt: Date | null;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  deletedBy?: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  reactions?: Array<{ userId: string; emoji: string }>;
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
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    deletedBy: row.deletedBy
      ? {
          id: row.deletedBy.id,
          username: row.deletedBy.username,
          displayName: row.deletedBy.displayName,
          avatarUrl: row.deletedBy.avatarUrl,
        }
      : null,
    pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    reactions: summarise(row.reactions ?? []),
  };
}

/** Groups the rows by emoji, keeping the order they were first used in. */
function summarise(rows: Array<{ userId: string; emoji: string }>): MessageReactionSummary[] {
  const groups = new Map<string, MessageReactionSummary>();
  for (const row of rows) {
    const group = groups.get(row.emoji) ?? { emoji: row.emoji, userIds: [] };
    group.userIds.push(row.userId);
    groups.set(row.emoji, group);
  }
  return [...groups.values()];
}
