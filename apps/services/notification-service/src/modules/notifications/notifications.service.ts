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
import { prisma, resolveChannelAccess } from '@nexora/database';
import type {
  ChannelUnread,
  NotificationPreferences,
  UpdateNotificationPreferencesRequest,
} from '@nexora/shared-types';

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

    const reads = await prisma.channelRead.findMany({
      where: { userId, channelId: { in: channels.map((channel) => channel.id) } },
      select: { channelId: true, lastReadAt: true },
    });
    const readAt = new Map(reads.map((read) => [read.channelId, read.lastReadAt]));

    // ponytail: one count query per channel, because each has its own cutoff.
    // Fine at a few dozen channels; a single grouped raw query if it is not.
    return Promise.all(
      channels.map(async (channel) => {
        const marker = readAt.get(channel.id);
        const since =
          marker ??
          joinedChannel.get(channel.id) ??
          (channel.serverId ? joinedServer.get(channel.serverId) : undefined) ??
          channel.createdAt;

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

    return { channelId, count: 0, lastReadAt: at.toISOString() };
  }
}
