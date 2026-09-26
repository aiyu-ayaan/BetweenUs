import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  channelAudience,
  prisma,
  resolveChannelAccess,
  type ChannelAccess,
} from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { PERMISSIONS, type Permission } from '@betweenus/permissions';
import {
  isDisappearingWindow,
  MAX_MESSAGE_CONTENT_LENGTH,
  MESSAGE_EDITS_LIMIT,
  type ClearChatsResponse,
  type CreatePollSettings,
  type Message,
  type MessageEditsResponse,
  type MessageKind,
  type MessageReactionSummary,
  type Paginated,
} from '@betweenus/shared-types';
import { purgeMessageAttachments } from '../uploads/attachment-sweeper';
import { judgePollSettings, toPoll, type PollRow } from './poll-rules';
import { keepsEditHistory, toEditVersion, writtenAtOf } from './edit-history';
import { threadRootProblem, threadSummaryOf } from './threads';
import { publishThreadFollows, recordThreadReply } from './thread-follows';

const PAGE_SIZE = 50;
/**
 * Content is an encrypted envelope, so the limit has to cover the attachment
 * manifest riding inside it as well as the words, and base64 on top of both.
 * Shared with the DTO so the two ceilings cannot drift apart again - they did,
 * and a message carrying ten pictures was refused by the lower of them.
 */
const MAX_CONTENT_LENGTH = MAX_MESSAGE_CONTENT_LENGTH;
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
 * How long a one-time message lives when nobody finishes opening it.
 *
 * It is normally destroyed the moment its last recipient has looked, but that
 * is a condition that may never arrive - one member of a channel who never
 * opens theirs would keep the ciphertext for ever. A week is long enough that
 * nobody loses a message they meant to open and short enough that an
 * unopened one is not indefinite storage.
 *
 * Never longer than a window the server itself set: a backstop that extended
 * a retention policy would be the opposite of one.
 */
const ONE_TIME_BACKSTOP_SECONDS = 7 * 24 * 60 * 60;

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

/**
 * Who still has a look coming, given a channel's audience and who has used
 * theirs.
 *
 * Split out from the database call so the policy can be asserted on without
 * one - it is the whole of the fix for "the first person to open it destroyed
 * it for everybody", and it is arithmetic over two lists.
 *
 * The author is never owed a look: re-reading what you sent spends nothing.
 * An audience of nobody but the author owes nothing either, which matters for
 * a channel emptied since the message was sent - holding ciphertext for a
 * recipient who no longer exists helps nobody.
 */
export function looksOwed(
  audience: string[],
  viewedBy: string[],
  authorId: string,
): string[] {
  const looked = new Set(viewedBy);
  return audience.filter((member) => member !== authorId && !looked.has(member));
}

/** Everything a `Message` is built from, in one place so every path agrees. */
export const MESSAGE_INCLUDE = {
  author: true,
  deletedBy: true,
  reactions: { select: { userId: true, emoji: true } },
  views: { select: { userId: true } },
  // Only the three fields a client draws. `select` rather than `true`, because
  // the row also carries the token hash and every history page would otherwise
  // read it out of the database for no reason.
  webhook: { select: { id: true, name: true, avatarUrl: true } },
  // How many earlier versions an edit left behind; the rows themselves are
  // read only by the history endpoint.
  _count: { select: { edits: true } },
  // The refereed half of a poll: counts and indexes, never words. Oldest vote
  // first, so the names under a bar do not reshuffle every time somebody votes.
  poll: {
    select: {
      optionCount: true,
      multiChoice: true,
      closesAt: true,
      closedAt: true,
      closedById: true,
      votes: { select: { userId: true, option: true }, orderBy: { createdAt: 'asc' } },
    },
  },
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
  async history(
    userId: string,
    channelId: string,
    before?: string,
    threadRootId?: string,
  ): Promise<Paginated<Message>> {
    await this.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);

    // A thread is paged exactly like its channel, under its root. The root has
    // to be in this channel - a thread id is not a way round the access check
    // on the channel it lives in. A deleted root is fine: the thread under it
    // is still somebody's conversation.
    if (threadRootId) {
      const root = await prisma.message.findFirst({
        where: { id: threadRootId, channelId },
        select: { id: true },
      });
      if (!root) {
        throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
      }
    }

    const cursor = before
      ? await prisma.message.findUnique({ where: { id: before }, select: { createdAt: true } })
      : null;

    const clearedAt = await this.historyFloor(userId, channelId);
    const rows = await prisma.message.findMany({
      where: {
        channelId,
        // The channel's own timeline leaves thread replies out; a thread's
        // history is nothing but them.
        threadRootId: threadRootId ?? null,
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

  /**
   * One message by id, tombstone included - what a client opening a thread
   * from a notification needs when the root is not in anything it has loaded.
   *
   * The same visibility as a history page: channel access, and nothing from
   * before this account's own cut-off.
   */
  async one(userId: string, messageId: string): Promise<Message> {
    const row = await prisma.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    // Resolved after the lookup, and a message in a channel the caller cannot
    // see answers the same 404 as one that does not exist.
    const access = await resolveChannelAccess(userId, row.channelId);
    if (!access || !access.permissions.includes(PERMISSIONS.VIEW_CHANNEL)) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    const floor = await this.historyFloor(userId, row.channelId);
    if (floor && row.createdAt.getTime() <= floor.getTime()) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    return toMessage(row);
  }

  /** Pinned messages of one channel, most recently pinned first. */
  async pins(userId: string, channelId: string): Promise<Message[]> {
    await this.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);

    const clearedAt = await this.historyFloor(userId, channelId);
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
   * The third marker is this account's personal disappearing window, which is
   * the same kind of thing in a different shape: not a moment somebody chose,
   * but one that slides forward with the clock. It belongs here rather than in
   * a filter of its own precisely because it is one-sided - a personal window
   * hides history from its owner and from nobody else, which is exactly what
   * these two markers already do. The server's own window is not here at all:
   * that one deletes the rows, so there is nothing left to filter.
   *
   * ponytail: two lookups per history page, both primary-key reads. Fold them
   * into the access check's query if a profiler ever says otherwise.
   */
  async historyFloor(userId: string, channelId: string): Promise<Date | null> {
    const [account, conversation] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { chatsClearedAt: true, messageTtlSeconds: true },
      }),
      prisma.channelRead.findUnique({
        where: { userId_channelId: { userId, channelId } },
        select: { clearedAt: true },
      }),
    ]);

    const personal = account?.messageTtlSeconds
      ? new Date(Date.now() - account.messageTtlSeconds * 1000)
      : null;
    return laterOf(
      laterOf(account?.chatsClearedAt ?? null, conversation?.clearedAt ?? null),
      personal,
    );
  }

  /**
   * When a message sent into this channel now should stop existing, or null
   * when nothing says it should.
   *
   * Only the server's window is read. An account's own window is a filter over
   * what it is shown and has no business setting an expiry on somebody else's
   * copy - that asymmetry is the whole difference between the two settings,
   * and it is why the server's outranks the account's rather than the two
   * being combined.
   *
   * A direct message has no server, so it has no window: there is nobody to
   * set one and nobody it would bind.
   */
  private async expiryFor(serverId: string | null, viewOnce = false): Promise<Date | null> {
    const server = serverId
      ? await prisma.server.findUnique({
          where: { id: serverId },
          select: { messageTtlSeconds: true },
        })
      : null;

    const seconds = server?.messageTtlSeconds ?? null;
    // A window that is not on the list is a window somebody wrote into the
    // database by hand. Ignored rather than obeyed: the alternative is
    // honouring a three-second retention nobody's client can offer to undo.
    const configured = seconds && isDisappearingWindow(seconds) ? seconds : null;

    // A one-time message is destroyed when everyone has looked, which is a
    // condition that may never arrive: one member of a channel who never opens
    // theirs keeps the blob for ever. So it also gets a backstop, and the
    // shorter of the two wins - the backstop must never *extend* a window a
    // server actually set.
    const window = viewOnce ? Math.min(configured ?? ONE_TIME_BACKSTOP_SECONDS, ONE_TIME_BACKSTOP_SECONDS) : configured;
    if (!window) return null;
    return new Date(Date.now() + window * 1000);
  }

  async send(
    userId: string,
    channelId: string,
    content: string,
    attachmentKeys: string[] = [],
    viewOnce = false,
    pollSettings?: CreatePollSettings,
    threadRootId?: string,
  ): Promise<Message> {
    const access = await this.requireChannelAccess(userId, channelId, PERMISSIONS.SEND_MESSAGE);

    // The settings are checked before anything is written, so a refused poll
    // leaves no message behind. The words are in `content` and are not looked
    // at - they cannot be.
    let poll: ReturnType<typeof judgePollSettings> | null = null;
    if (pollSettings) {
      if (viewOnce) {
        throw new BadRequestException({
          code: 'INVALID_POLL',
          message: 'A poll cannot be a one-time message',
        });
      }
      poll = judgePollSettings(pollSettings, new Date());
      if (!poll.ok) {
        throw new BadRequestException({ code: poll.code, message: poll.message });
      }
    }

    if (threadRootId) {
      // A one-time reply would be destroyed out from under the thread's count
      // by a look, which is a thread quietly rewriting itself.
      if (viewOnce) {
        throw new BadRequestException({
          code: 'THREAD_NOT_ALLOWED',
          message: 'A thread reply cannot be a one-time message',
        });
      }
      const root = await prisma.message.findUnique({
        where: { id: threadRootId },
        select: { channelId: true, kind: true, threadRootId: true, viewOnce: true },
      });
      const problem = threadRootProblem(root, channelId);
      if (problem === 'MESSAGE_NOT_FOUND') {
        throw new NotFoundException({ code: problem, message: 'Message not found' });
      }
      if (problem === 'THREAD_NOT_ALLOWED') {
        throw new BadRequestException({
          code: problem,
          message: 'That message cannot have a thread',
        });
      }
    }

    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CONTENT_LENGTH) {
      throw new ForbiddenException({
        code: 'INVALID_MESSAGE',
        message: `Message must be 1-${MAX_CONTENT_LENGTH} characters`,
      });
    }

    // Stamped now rather than evaluated on read, so changing a server's window
    // governs what is sent next and never reaches back through the channel.
    const expiresAt = await this.expiryFor(access.serverId, viewOnce);

    const row = await prisma.message.create({
      data: {
        channelId,
        authorId: userId,
        content: trimmed,
        expiresAt,
        viewOnce,
        ...(poll?.ok ? { poll: { create: poll.value } } : {}),
        threadRootId: threadRootId ?? null,
      },
      include: MESSAGE_INCLUDE,
    });

    // The blobs become this message's, so deleting it can take them with it.
    // Scoped to unclaimed uploads of this account: a key is not a capability,
    // and naming somebody else's must not move it.
    //
    // `state` moves with `messageId`, and it has to: a row left at `PENDING`
    // is collected the moment its grace runs out, which would mean every
    // photograph in the app being deleted a day after it was sent.
    if (attachmentKeys.length > 0) {
      await prisma.attachment.updateMany({
        where: { key: { in: attachmentKeys.slice(0, 50) }, uploaderId: userId, messageId: null },
        data: { messageId: row.id, state: 'LINKED', stateAt: new Date() },
      });
    }

    const message = toMessage(row);
    // The WebSocket gateway - in this process and in every other instance -
    // fans this out to subscribed sockets.
    await this.events.publish(EVENTS.MESSAGE_CREATED, { message });
    // The root's "N replies" chip, after the reply itself: a client that sees
    // the count move before the reply exists would open an empty thread.
    if (threadRootId) {
      // The replier follows the thread and has read up to their own reply; the
      // root's author follows it unless they said otherwise. Before the
      // summary, whose fan-out tells every follower their unread count.
      await recordThreadReply({ authorId: userId, threadRootId, createdAt: row.createdAt });
      await refreshThreadSummaries(this.events, [threadRootId]);
    }
    return message;
  }

  /**
   * Rewrites the body. The author only - a moderator may remove a message but
   * never put different words in somebody's mouth - and `editedAt` is stamped
   * so every client can say so.
   *
   * The old envelope is kept in `message_edits` in the same transaction as the
   * replacement, still sealed with the channel key it was written under, so
   * the server holds no more about the old words than about the new. A message
   * that disappears or is one-time keeps none: a copy would outlive the
   * promise. See `keepsEditHistory`.
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

    // A poll's labels are sealed, so the server could not tell an edit that
    // fixed a typo from one that swapped "yes" and "no" under everybody's
    // votes. Refusing the edit is the only way to keep a vote meaning what it
    // meant when it was cast.
    const poll = await prisma.messagePoll.findUnique({
      where: { messageId: existing.id },
      select: { messageId: true },
    });
    if (poll) {
      throw new BadRequestException({
        code: 'POLL_NOT_EDITABLE',
        message: 'A poll cannot be edited once it is sent',
      });
    }

    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException({
        code: 'INVALID_MESSAGE',
        message: `Message must be 1-${MAX_CONTENT_LENGTH} characters`,
      });
    }

    const previous = await prisma.message.findUnique({
      where: { id: existing.id },
      select: { content: true, createdAt: true, editedAt: true, expiresAt: true, viewOnce: true },
    });
    if (!previous) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }

    const now = new Date();
    const keep = keepsEditHistory(previous);
    // One transaction, so a message is never edited without its old words
    // being kept, nor kept without having been edited.
    const row = await prisma.$transaction(async (tx) => {
      if (keep) {
        await tx.messageEdit.create({
          data: {
            messageId: existing.id,
            content: previous.content,
            writtenAt: writtenAtOf(previous),
            createdAt: now,
          },
        });
        // Beyond the cap the oldest go, so a message edited a thousand times
        // does not grow without bound.
        const stale = await tx.messageEdit.findMany({
          where: { messageId: existing.id },
          orderBy: { createdAt: 'desc' },
          skip: MESSAGE_EDITS_LIMIT,
          select: { id: true },
        });
        if (stale.length > 0) {
          await tx.messageEdit.deleteMany({ where: { id: { in: stale.map((edit) => edit.id) } } });
        }
      }
      return tx.message.update({
        where: { id: existing.id },
        data: { content: trimmed, editedAt: now },
        include: MESSAGE_INCLUDE,
      });
    });

    const message = toMessage(row);
    await this.events.publish(EVENTS.MESSAGE_UPDATED, { message });
    return message;
  }

  /**
   * Earlier versions of a message, newest first, capped. Visible to exactly
   * whoever can see the message - channel access and the account's own
   * clear-chat cut-off, else the same 404 - and sealed: the caller opens each
   * one with the channel key like the message body.
   *
   * A tombstone has no history: it is emptied when the message is deleted.
   */
  async edits(userId: string, messageId: string): Promise<MessageEditsResponse> {
    const row = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, channelId: true, createdAt: true, deletedAt: true },
    });
    const access = row ? await resolveChannelAccess(userId, row.channelId) : null;
    if (!row || !access || !access.permissions.includes(PERMISSIONS.VIEW_CHANNEL)) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    const floor = await this.historyFloor(userId, row.channelId);
    if (floor && row.createdAt.getTime() <= floor.getTime()) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    if (row.deletedAt) return { items: [] };

    const edits = await prisma.messageEdit.findMany({
      where: { messageId: row.id },
      orderBy: { createdAt: 'desc' },
      take: MESSAGE_EDITS_LIMIT,
    });
    return { items: edits.map(toEditVersion) };
  }

  /**
   * Deletes a message. The author may always delete their own; anyone else
   * needs `DELETE_MESSAGE` in that channel, which is what a moderator holds.
   *
   * It is a soft delete: `deletedAt` and, when somebody else did it,
   * `deletedById` are set and the body is emptied. The row stays so the
   * conversation can show a tombstone and so a page cursor handed out a moment
   * ago still points somewhere; the ciphertext does not.
   *
   * The blobs go with it, here and now. They used to be left to the attachment
   * sweeper, which is correct but runs every six hours - so "I deleted that
   * photo" meant "the ciphertext leaves the object store some time today",
   * which is not what anybody pressing delete is asking for. The sweeper is
   * still behind this as the backstop for whatever the immediate delete could
   * not reach.
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

    // A tombstone asks nothing, so its poll and every vote on it go too. In the
    // same transaction as the tombstone, so a failed delete keeps the votes.
    const [, , row] = await prisma.$transaction([
      prisma.messagePoll.deleteMany({ where: { messageId: existing.id } }),
      // A tombstone keeps no words, and that includes the earlier versions.
      prisma.messageEdit.deleteMany({ where: { messageId: existing.id } }),
      prisma.message.update({
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
      }),
    ]);

    // After the row update, never before: a blob deleted for a message that
    // then failed to delete is a message rendering broken pictures for ever.
    await purgeMessageAttachments([row.id]);

    await this.events.publish(EVENTS.MESSAGE_DELETED, {
      messageId: row.id,
      channelId: row.channelId,
      message: toMessage(row),
    });
    // A deleted reply stops counting towards its root's chip. A deleted root
    // keeps its thread: the tombstone above still carries the summary.
    if (row.threadRootId) await refreshThreadSummaries(this.events, [row.threadRootId]);
  }

  /**
   * Spends one person's look at a one-time message.
   *
   * One look *each*, not one look in total. This used to settle a race with a
   * conditional update on a single `viewedAt`, so the first person to open one
   * in a channel destroyed it and everybody else was shown "Opened" for
   * something they had never seen. That is not a one-time message; it is a
   * race to a message.
   *
   * So a look is a row, and the message survives until the rows cover everyone
   * who could see it. In a direct message that is one person and the behaviour
   * is unchanged; in a channel each member gets the look they were sent.
   *
   * The author is not a viewer. Re-reading what you sent spends nobody's look,
   * and a sender who burned their own message by scrolling past it would find
   * the feature unusable.
   *
   * Idempotent by the unique index on (message, user): opening twice from two
   * devices records one look, so the second one is not silently charged to
   * somebody else.
   */
  async burn(userId: string, messageId: string): Promise<void> {
    const row = await prisma.message.findFirst({
      where: { id: messageId, deletedAt: null },
      select: { id: true, channelId: true, authorId: true, viewOnce: true, viewedAt: true },
    });
    if (!row || !row.viewOnce) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    }
    await this.requireChannelAccess(userId, row.channelId, PERMISSIONS.VIEW_CHANNEL);

    // The author looking at their own does not spend anything.
    if (row.authorId === userId) return;

    await prisma.messageView.upsert({
      where: { messageId_userId: { messageId: row.id, userId } },
      create: { messageId: row.id, userId },
      update: {},
    });
    // The stamp the backstop expiry is measured from - the first look, not
    // this one. Written only once, so a slow second viewer cannot extend it.
    if (row.viewedAt === null) {
      await prisma.message.updateMany({
        where: { id: row.id, viewedAt: null },
        data: { viewedAt: new Date() },
      });
    }

    if (await this.everyoneHasLooked(row.id, row.channelId, row.authorId)) {
      await purgeMessageAttachments([row.id]);
      await prisma.message.delete({ where: { id: row.id } });
      await this.events.publish(EVENTS.MESSAGE_DELETED, {
        messageId: row.id,
        channelId: row.channelId,
        message: null,
      });
      return;
    }

    // Still somebody's look left in it. Everyone is told who has spent theirs,
    // so this account's other devices stop offering it and the author can see
    // that it has been opened.
    const updated = await prisma.message.findUniqueOrThrow({
      where: { id: row.id },
      include: MESSAGE_INCLUDE,
    });
    await this.events.publish(EVENTS.MESSAGE_UPDATED, { message: toMessage(updated) });
  }

  /**
   * Whether a one-time message has no looks left in it.
   *
   * "Everyone who could see it" is the channel's audience as it stands now,
   * minus the author. A member who joined after it was sent is deliberately
   * included: they can see the channel, so they can see the card, and a
   * message destroyed before they opened it would be another "Opened" for
   * something never shown.
   *
   * The corollary is that a channel where somebody never opens theirs keeps
   * the blob until the backstop expiry collects it - see `expiryFor`.
   */
  private async everyoneHasLooked(
    messageId: string,
    channelId: string,
    authorId: string,
  ): Promise<boolean> {
    const [audience, looks] = await Promise.all([
      channelAudience(channelId),
      prisma.messageView.findMany({ where: { messageId }, select: { userId: true } }),
    ]);

    return looksOwed(audience, looks.map((look) => look.userId), authorId).length === 0;
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
  /** Optional so a caller that selected before the column existed still fits. */
  kind?: MessageKind;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  pinnedAt: Date | null;
  expiresAt?: Date | null;
  viewOnce?: boolean;
  views?: Array<{ userId: string }>;
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
  /**
   * The webhook that posted this, where one did. Optional so a caller that
   * selected before the column existed still fits this shape.
   *
   * `null` on the relation and a name on the row are different things: the
   * relation is `SetNull`, so a deleted webhook leaves its messages behind
   * carrying nothing but a name - see `webhookNameOf`.
   */
  webhookId?: string | null;
  webhook?: { id: string; name: string; avatarUrl: string | null } | null;
  /** Set when the message is a poll. Optional for callers that did not select it. */
  poll?: PollRow | null;
  /** Thread columns; optional so a caller that selected without them still fits. */
  threadRootId?: string | null;
  threadReplyCount?: number;
  threadLastReplyAt?: Date | null;
  /** Present when the row was read with `MESSAGE_INCLUDE`. */
  _count?: { edits: number };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channelId: row.channelId,
    kind: row.kind ?? 'USER',
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
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    viewOnce: row.viewOnce ?? false,
    viewedBy: (row.views ?? []).map((view) => view.userId),
    threadRootId: row.threadRootId ?? null,
    thread: threadSummaryOf(row),
    editCount: row.deletedAt ? 0 : (row._count?.edits ?? 0),
    ...(row.kind === 'WEBHOOK'
      ? {
          webhook: {
            // Null once the webhook has been deleted. The message stays - the
            // relation is `SetNull` on purpose - so the client draws the name
            // and falls back to an initial for the picture.
            id: row.webhook?.id ?? null,
            name: row.webhook?.name ?? 'Webhook',
            avatarUrl: row.webhook?.avatarUrl ?? null,
          },
        }
      : {}),
    ...(row.poll ? { poll: toPoll(row.poll) } : {}),
  };
}

/**
 * Rewrites each root's thread summary from its live replies, and tells every
 * subscriber the root changed.
 *
 * Recomputed from the rows rather than incremented, so a reply that was
 * deleted, expired, or sent twice across a retry can never leave the count
 * drifting. A root that no longer exists - destroyed by a disappearing window,
 * which takes its thread with it - is skipped rather than recreated.
 *
 * The root travels as an ordinary `message.updated`: that is already what a
 * client does with "this message is not what you last saw", and the chip is
 * part of the message.
 */
export async function refreshThreadSummaries(events: EventBus, rootIds: string[]): Promise<void> {
  for (const rootId of new Set(rootIds)) {
    const replies = await prisma.message.aggregate({
      where: { threadRootId: rootId, deletedAt: null },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const { count } = await prisma.message.updateMany({
      where: { id: rootId },
      data: {
        threadReplyCount: replies._count._all,
        threadLastReplyAt: replies._max.createdAt,
      },
    });
    if (count === 0) continue;

    const root = await prisma.message.findUnique({ where: { id: rootId }, include: MESSAGE_INCLUDE });
    if (root) await events.publish(EVENTS.MESSAGE_UPDATED, { message: toMessage(root) });
    // Every follower's unread count moved with the replies, up or down.
    await publishThreadFollows(events, rootId);
  }
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
