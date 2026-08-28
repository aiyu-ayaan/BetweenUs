/**
 * Notification preferences and read state.
 *
 * This service raises nothing itself: the desktop client already receives every
 * message over `/ws/chat` and the OS notification is the Electron main
 * process's job. What the client cannot own is the part that has to outlive it
 * - which channels are muted, when the quiet hours are, and how far each
 * channel has been read. Those follow the account, so a mute set on one machine
 * holds on the next one and an unread badge survives a restart.
 *
 * It reads the shared schema like every other service; splitting the schema per
 * service is tracked in development/TODO.md.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { channelAudience, prisma, resolveChannelAccess } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import type {
  ChannelReadReceipt,
  ChannelUnread,
  NotificationPreferences,
  UpdateNotificationPreferencesRequest,
} from '@betweenus/shared-types';

/** An account with no row is an account with these. */
const DEFAULTS: NotificationPreferences = {
  enabled: true,
  quietStartMinute: null,
  quietEndMinute: null,
  mutedChannelIds: [],
  mentionOnlyChannelIds: [],
  mutedUserIds: [],
};

@Injectable()
export class NotificationsService {
  constructor(private readonly events: EventBus) {}

  async preferences(userId: string): Promise<NotificationPreferences> {
    const row = await prisma.notificationSetting.findUnique({ where: { userId } });
    if (!row) return DEFAULTS;
    return {
      enabled: row.enabled,
      quietStartMinute: row.quietStartMinute,
      quietEndMinute: row.quietEndMinute,
      mutedChannelIds: row.mutedChannelIds,
      mentionOnlyChannelIds: row.mentionOnlyChannelIds,
      mutedUserIds: row.mutedUserIds,
    };
  }

  async updatePreferences(
    userId: string,
    patch: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> {
    // Only the fields actually sent are touched, so a client that knows about
    // one setting cannot wipe another it has never heard of.
    const changes = {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.quietStartMinute !== undefined ? { quietStartMinute: patch.quietStartMinute } : {}),
      ...(patch.quietEndMinute !== undefined ? { quietEndMinute: patch.quietEndMinute } : {}),
      ...(patch.mutedChannelIds !== undefined
        ? { mutedChannelIds: [...new Set(patch.mutedChannelIds)] }
        : {}),
      ...(patch.mentionOnlyChannelIds !== undefined
        ? { mentionOnlyChannelIds: [...new Set(patch.mentionOnlyChannelIds)] }
        : {}),
      ...(patch.mutedUserIds !== undefined
        ? { mutedUserIds: [...new Set(patch.mutedUserIds)] }
        : {}),
    };

    const row = await prisma.notificationSetting.upsert({
      where: { userId },
      create: { userId, ...changes },
      update: changes,
    });

    return {
      enabled: row.enabled,
      quietStartMinute: row.quietStartMinute,
      quietEndMinute: row.quietEndMinute,
      mutedChannelIds: row.mutedChannelIds,
      mentionOnlyChannelIds: row.mentionOnlyChannelIds,
      mutedUserIds: row.mutedUserIds,
    };
  }

  /**
   * Unread counts for every channel this user can read.
   *
   * The cutoff is the read marker; a channel with no marker counts from the
   * moment the user could first see it (joining the server, or being added to
   * a private channel or a DM), so joining an old server does not arrive with
   * a thousand unread messages.
   */
  async unread(userId: string): Promise<ChannelUnread[]> {
    const [memberships, seats] = await Promise.all([
      prisma.serverMember.findMany({ where: { userId }, select: { serverId: true, joinedAt: true } }),
      prisma.channelMember.findMany({ where: { userId }, select: { channelId: true, addedAt: true } }),
    ]);

    const joinedServer = new Map(memberships.map((m) => [m.serverId, m.joinedAt]));
    const joinedChannel = new Map(seats.map((seat) => [seat.channelId, seat.addedAt]));

    // Public channels of servers this user belongs to, plus every channel they
    // are named on - which is what a private channel and a DM both are.
    const channels = await prisma.channel.findMany({
      where: {
        type: { not: 'VOICE' },
        OR: [
          { serverId: { in: [...joinedServer.keys()] }, isPrivate: false },
          { id: { in: [...joinedChannel.keys()] } },
        ],
      },
      select: { id: true, serverId: true, createdAt: true },
    });

    // An account that cleared its history must not be told it has unread
    // messages it can no longer open. The cut is a floor under every channel's
    // cutoff rather than a separate rule - see `chatsClearedAt`.
    const cleared = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatsClearedAt: true },
    });

    const reads = await prisma.channelRead.findMany({
      where: { userId, channelId: { in: channels.map((channel) => channel.id) } },
      select: { channelId: true, lastReadAt: true, clearedAt: true },
    });
    const readAt = new Map(reads.map((read) => [read.channelId, read.lastReadAt]));
    // Cleared per conversation, as well as the account-wide cut above.
    const clearedAt = new Map(
      reads.filter((read) => read.clearedAt !== null).map((read) => [read.channelId, read.clearedAt!]),
    );

    // ponytail: one count query per channel, because each has its own cutoff.
    // Fine at a few dozen channels; a single grouped raw query if it is not.
    return Promise.all(
      channels.map(async (channel) => {
        const marker = readAt.get(channel.id);
        const from =
          marker ??
          joinedChannel.get(channel.id) ??
          (channel.serverId ? joinedServer.get(channel.serverId) : undefined) ??
          channel.createdAt;
        // Whichever cut-off is latest wins: the account-wide one, this
        // conversation's own, or where they had read to.
        const since = [cleared?.chatsClearedAt, clearedAt.get(channel.id)].reduce<Date>(
          (latest, cut) => (cut && cut > latest ? cut : latest),
          from,
        );

        const count = await prisma.message.count({
          where: {
            channelId: channel.id,
            createdAt: { gt: since },
            deletedAt: null,
            // Your own message is never unread.
            authorId: { not: userId },
          },
        });

        return { channelId: channel.id, count, lastReadAt: marker?.toISOString() ?? null };
      }),
    );
  }

  /**
   * "I am looking at this channel now." The marker is always the current time -
   * there is no way to mark read as of an older message, which keeps the count
   * monotonic and saves a rule about moving the marker backwards.
   */
  async markRead(userId: string, channelId: string): Promise<ChannelUnread> {
    // 404 for both a missing channel and one this user cannot see, so read
    // markers cannot be used to probe for channel ids.
    const access = await resolveChannelAccess(userId, channelId);
    if (!access) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    const at = new Date();
    await prisma.channelRead.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: { userId, channelId, lastReadAt: at },
      update: { lastReadAt: at },
    });

    // Their other devices, so a notification this account has already dealt
    // with stops sitting in a pocket. Published rather than pushed from here:
    // the fan-out belongs to `PushService`, which owns the tokens.
    await this.events.publish(EVENTS.CHANNEL_READ, {
      userId,
      channelId,
      at: at.toISOString(),
    });

    return { channelId, count: 0, lastReadAt: at.toISOString() };
  }

  /**
   * Who else has read this channel, and up to when.
   *
   * The caller is left out: a receipt is about somebody else having seen your
   * message, and your own marker is already the thing that moves when you read.
   * Anyone who can read the channel but has never opened it simply has no row,
   * which reads as "has not seen it" without a null to carry around.
   */
  async receipts(userId: string, channelId: string): Promise<ChannelReadReceipt[]> {
    // Same 404 as everywhere else: a channel this account cannot see does not
    // exist, so receipts cannot be used to probe for channel ids either.
    const access = await resolveChannelAccess(userId, channelId);
    if (!access) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    // The audience, not every row: somebody who has since been removed from a
    // private channel keeps their old marker, and it is not the caller's
    // business any more.
    const audience = (await channelAudience(channelId)).filter((id) => id !== userId);
    if (audience.length === 0) return [];

    const reads = await prisma.channelRead.findMany({
      where: { channelId, userId: { in: audience } },
      orderBy: { lastReadAt: 'desc' },
      select: {
        lastReadAt: true,
        user: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return reads.map((read) => ({
      user: read.user,
      readAt: read.lastReadAt.toISOString(),
    }));
  }
}
