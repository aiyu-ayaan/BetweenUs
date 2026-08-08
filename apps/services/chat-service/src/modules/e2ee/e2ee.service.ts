/**
 * Key directory for end-to-end encrypted channels.
 *
 * Everything stored here is either a public key or a ciphertext the server has
 * no key for. The service enforces *who may publish*, never *what is inside*.
 *
 * The device directory is user-level data and belongs in `user-service` once
 * that exists; it lives here for now so E2EE ships as one module and one route
 * (recorded as a deliberate shortcut in development/PLANNING.md).
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { prisma } from '@nexora/database';
import { PERMISSIONS } from '@nexora/permissions';
import type {
  ChannelKeysResponse,
  DeviceKey,
  PublishChannelKeysRequest,
} from '@nexora/shared-types';
import { MessagesService } from '../messages/messages.service';

@Injectable()
export class E2eeService {
  constructor(private readonly messages: MessagesService) {}

  /** Publishes (or rotates) the caller's public identity key. */
  async registerDevice(userId: string, publicKey: string): Promise<DeviceKey> {
    const row = await prisma.deviceKey.upsert({
      where: { userId },
      update: { publicKey },
      create: { userId, publicKey },
    });
    return { userId: row.userId, publicKey: row.publicKey };
  }

  /** Public keys of every channel member that has registered a device. */
  async devicesForChannel(userId: string, channelId: string): Promise<DeviceKey[]> {
    await this.messages.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);
    const memberIds = await this.memberIds(channelId);

    const rows = await prisma.deviceKey.findMany({
      where: { userId: { in: memberIds } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({ userId: row.userId, publicKey: row.publicKey }));
  }

  /** Wrapped keys addressed to the caller, plus who still needs a re-wrap. */
  async keysForUser(userId: string, channelId: string): Promise<ChannelKeysResponse> {
    await this.messages.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);

    const [rows, latest] = await Promise.all([
      prisma.channelKey.findMany({
        where: { channelId, recipientUserId: userId },
        orderBy: { epoch: 'asc' },
      }),
      prisma.channelKey.aggregate({ where: { channelId }, _max: { epoch: true } }),
    ]);

    const epoch = latest._max.epoch ?? 0;

    return {
      channelId,
      epoch,
      keys: rows.map((row) => ({
        epoch: row.epoch,
        recipientUserId: row.recipientUserId,
        senderUserId: row.senderUserId,
        senderPublicKey: row.senderPublicKey,
        wrappedKey: row.wrappedKey,
        iv: row.iv,
      })),
      missingRecipients: epoch === 0 ? [] : await this.missingAtEpoch(channelId, epoch),
    };
  }

  /**
   * Stores a bundle of wrapped keys.
   *
   * Two rules keep a member from hijacking a channel's key: a new epoch must be
   * exactly the next one, and adding to an existing epoch requires already
   * holding that epoch's key. Existing entries are never overwritten.
   */
  async publishKeys(
    userId: string,
    dto: PublishChannelKeysRequest,
  ): Promise<{ epoch: number; stored: number }> {
    await this.messages.requireChannelAccess(userId, dto.channelId, PERMISSIONS.SEND_MESSAGE);

    const latest = await prisma.channelKey.aggregate({
      where: { channelId: dto.channelId },
      _max: { epoch: true },
    });
    const currentEpoch = latest._max.epoch ?? 0;

    if (dto.epoch > currentEpoch) {
      if (dto.epoch !== currentEpoch + 1) {
        throw new ForbiddenException({
          code: 'EPOCH_OUT_OF_ORDER',
          message: `Next epoch is ${currentEpoch + 1}`,
        });
      }
    } else {
      const holdsKey = await prisma.channelKey.findUnique({
        where: {
          channelId_epoch_recipientUserId: {
            channelId: dto.channelId,
            epoch: dto.epoch,
            recipientUserId: userId,
          },
        },
        select: { id: true },
      });
      if (!holdsKey) {
        throw new ForbiddenException({
          code: 'EPOCH_NOT_HELD',
          message: 'Only a holder of this epoch may distribute it',
        });
      }
    }

    // Silently dropping non-members would hide a client bug; reject instead.
    const memberIds = new Set(await this.memberIds(dto.channelId));
    for (const entry of dto.entries) {
      if (!memberIds.has(entry.recipientUserId)) {
        throw new ForbiddenException({
          code: 'RECIPIENT_NOT_MEMBER',
          message: 'Recipient is not a member of this channel',
        });
      }
    }

    const result = await prisma.channelKey.createMany({
      data: dto.entries.map((entry) => ({
        channelId: dto.channelId,
        epoch: dto.epoch,
        recipientUserId: entry.recipientUserId,
        senderUserId: userId,
        senderPublicKey: entry.senderPublicKey,
        wrappedKey: entry.wrappedKey,
        iv: entry.iv,
      })),
      skipDuplicates: true,
    });

    return { epoch: dto.epoch, stored: result.count };
  }

  private async memberIds(channelId: string): Promise<string[]> {
    const channel = await prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      select: { serverId: true },
    });
    const members = await prisma.serverMember.findMany({
      where: { serverId: channel.serverId },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  private async missingAtEpoch(channelId: string, epoch: number): Promise<DeviceKey[]> {
    const memberIds = await this.memberIds(channelId);
    const covered = await prisma.channelKey.findMany({
      where: { channelId, epoch },
      select: { recipientUserId: true },
    });
    const has = new Set(covered.map((row) => row.recipientUserId));

    const rows = await prisma.deviceKey.findMany({
      where: { userId: { in: memberIds.filter((id) => !has.has(id)) } },
    });
    return rows.map((row) => ({ userId: row.userId, publicKey: row.publicKey }));
  }
}
