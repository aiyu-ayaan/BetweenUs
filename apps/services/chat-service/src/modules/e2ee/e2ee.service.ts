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
import { channelAudience, prisma } from '@nexora/database';
import { PERMISSIONS } from '@nexora/permissions';
import type {
  BackupSecretKind,
  ChannelKeysResponse,
  DeviceKey,
  IdentityBackup,
  IdentityBackupResponse,
  PublishChannelKeysRequest,
  PutIdentityBackupRequest,
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

  /**
   * The caller's sealed identity key, or null if they never uploaded one.
   *
   * Handing this to whoever holds a session for the account is the point: it is
   * what turns "this machine" into "this account", and it is ciphertext under a
   * key derived from a secret that never reaches the server, so a session alone
   * does not open it.
   */
  async identityBackup(userId: string): Promise<IdentityBackupResponse> {
    const row = await prisma.identityBackup.findUnique({ where: { userId } });
    if (!row) return { backup: null };

    return {
      backup: {
        v: 1,
        kind: row.kind as BackupSecretKind,
        kdf: row.kdf as IdentityBackup['kdf'],
        iterations: row.iterations,
        salt: row.salt,
        iv: row.iv,
        ct: row.ciphertext,
        publicKey: row.publicKey,
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  /**
   * Replaces the caller's backup. Overwriting is the normal case - a changed
   * password re-seals the same identity under a new key - so there is no
   * "already exists" rule to enforce here, and no way for the server to tell a
   * good blob from a bad one anyway.
   */
  async putIdentityBackup(userId: string, dto: PutIdentityBackupRequest): Promise<void> {
    const data = {
      kind: dto.kind,
      kdf: dto.kdf,
      iterations: dto.iterations,
      salt: dto.salt,
      iv: dto.iv,
      ciphertext: dto.ct,
      publicKey: dto.publicKey,
    };
    await prisma.identityBackup.upsert({ where: { userId }, update: data, create: { userId, ...data } });
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
   *
   * Minting the next epoch deliberately needs no key of its own: a member who
   * joined after the channel was keyed holds nothing, and if only a holder
   * could move the channel forward they would be locked out until one came
   * online. Nothing is given away by it - a member can read what is sent from
   * now on either way, and every earlier epoch stays sealed to whoever held it.
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

  /**
   * Who the key is wrapped for. `channelAudience` is the allowlist on a private
   * channel and every server member otherwise, so the people who can read the
   * channel and the people who get a key are the same set by construction.
   */
  private async memberIds(channelId: string): Promise<string[]> {
    return channelAudience(channelId);
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
