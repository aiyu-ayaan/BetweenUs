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
import { channelAudience, prisma } from '@betweenus/database';
import { PERMISSIONS } from '@betweenus/permissions';
import type {
  BackupSecretKind,
  ChannelKeysResponse,
  DeviceKey,
  IdentityBackup,
  IdentityBackupResponse,
  PublishChannelKeysRequest,
  PutIdentityBackupRequest,
} from '@betweenus/shared-types';
import { MessagesService } from '../messages/messages.service';

@Injectable()
export class E2eeService {
  constructor(private readonly messages: MessagesService) {}

  /**
   * Publishes (or rotates) one machine's public identity key.
   *
   * A revoked id stays revoked, and re-registering it is refused rather than
   * quietly clearing the flag. Allowing the machine to un-revoke itself would
   * make revocation a suggestion: the case it exists for is a laptop somebody
   * else is holding, and that laptop is running this same code.
   *
   * What revocation cannot do is stop a machine that still holds a valid
   * session from starting again as a *new* device - the app would have to be
   * reinstalled, but nothing here can tell that apart from a genuinely new
   * laptop. Ending the session is what answers that, and this is not a
   * substitute for it. See development/E2EE.md.
   */
  async registerDevice(
    userId: string,
    deviceId: string,
    publicKey: string,
    label?: string,
  ): Promise<DeviceKey> {
    const existing = await prisma.deviceKey.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
      select: { revokedAt: true },
    });
    if (existing?.revokedAt) {
      throw new ForbiddenException({
        code: 'DEVICE_REVOKED',
        message: 'This device was revoked',
      });
    }

    const row = await prisma.deviceKey.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      update: { publicKey, lastSeenAt: new Date(), ...(label ? { label } : {}) },
      create: { userId, deviceId, publicKey, label: label ?? null },
    });
    return toDeviceKey(row);
  }

  /** This account's own machines, newest first. Nobody else's. */
  async myDevices(userId: string): Promise<DeviceKey[]> {
    const rows = await prisma.deviceKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDeviceKey);
  }

  /**
   * Stops a machine being wrapped for, and takes away what it was already
   * given.
   *
   * The wraps go because leaving them is leaving the key: a revoked laptop
   * still holds its private half, and a row it can open is a row it can keep
   * opening. What it decrypted before this is gone - it was decrypted on a
   * machine somebody has decided not to trust, and no server-side deletion
   * reaches that.
   *
   * The row itself stays. When a device stopped being trusted is the only thing
   * anybody can audit afterwards, and a deleted row says nothing.
   */
  async revokeDevice(userId: string, deviceId: string): Promise<DeviceKey> {
    const row = await prisma.deviceKey.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });
    if (!row) {
      throw new ForbiddenException({ code: 'DEVICE_NOT_FOUND', message: 'No such device' });
    }

    const [updated] = await prisma.$transaction([
      prisma.deviceKey.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      }),
      prisma.channelKey.deleteMany({
        where: { recipientUserId: userId, recipientDeviceId: deviceId },
      }),
    ]);

    return toDeviceKey(updated);
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

  /**
   * Every device of every channel member, minus the revoked ones.
   *
   * Revoked devices are filtered here rather than left to the client, because
   * this is the list a client wraps the channel key against and "do not seal
   * anything for that laptop again" has to be enforced where the answer is
   * produced, not where it is used.
   */
  async devicesForChannel(userId: string, channelId: string): Promise<DeviceKey[]> {
    await this.messages.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);
    const memberIds = await this.memberIds(channelId);

    const rows = await prisma.deviceKey.findMany({
      where: { userId: { in: memberIds }, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDeviceKey);
  }

  /** Wrapped keys addressed to the caller, plus who still needs a re-wrap. */
  async keysForUser(userId: string, channelId: string): Promise<ChannelKeysResponse> {
    await this.messages.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);

    const [rows, latest] = await Promise.all([
      prisma.channelKey.findMany({
        // Every device of the caller, not only the one asking: a client holds
        // one private key, tries each row against it, and keeps what opens.
        // Filtering by device here would mean trusting a device id the caller
        // supplied, which is a claim rather than a fact.
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
        recipientDeviceId: row.recipientDeviceId,
        senderUserId: row.senderUserId,
        senderDeviceId: row.senderDeviceId,
        senderPublicKey: row.senderPublicKey,
        wrappedKey: row.wrappedKey,
        iv: row.iv,
      })),
      missingRecipients: epoch === 0 ? [] : await this.missingAtEpoch(channelId, epoch),
      rekeyNeeded: epoch === 0 ? false : await this.staleAtEpoch(channelId, epoch),
    };
  }

  /**
   * Does anybody outside the channel hold the current key?
   *
   * Derived rather than recorded, which is what makes it right without a
   * bookkeeping step somebody can forget: the answer is a comparison between
   * who was wrapped for and who is a member now, so every way of losing access -
   * dropped from a private channel's allowlist, kicked from the server, the
   * channel made private around them - produces it, including the ones added
   * later.
   */
  private async staleAtEpoch(channelId: string, epoch: number): Promise<boolean> {
    const [memberIds, holders] = await Promise.all([
      this.memberIds(channelId),
      prisma.channelKey.findMany({
        where: { channelId, epoch },
        select: { recipientUserId: true, createdAt: true },
      }),
    ]);

    const members = new Set(memberIds);
    if (holders.some((holder) => !members.has(holder.recipientUserId))) return true;

    // The second way to hold a key you should not: a machine that was trusted
    // when the epoch was minted and has been revoked since.
    //
    // It cannot be derived by looking for its wraps, because revoking deletes
    // them - that is most of what revoking *is*. What is left is the timing: a
    // device revoked after this epoch was created was a device this epoch was
    // wrapped for, so the epoch is on a machine nobody trusts any more.
    //
    // Over-rotating is a re-wrap nobody notices. Under-rotating is a lost
    // laptop reading the channel for as long as it stays on the same key, so
    // where the two answers differ this takes the expensive one.
    if (holders.length === 0) return false;
    const mintedAt = holders.reduce(
      (earliest, holder) => (holder.createdAt < earliest ? holder.createdAt : earliest),
      holders[0]!.createdAt,
    );

    const revokedSince = await prisma.deviceKey.findFirst({
      where: { userId: { in: memberIds }, revokedAt: { gt: mintedAt } },
      select: { id: true },
    });
    return revokedSince !== null;
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
      // Any of the caller's devices holding this epoch is enough: the check is
      // "do you already have this key", and the person is the one who has it.
      const holdsKey = await prisma.channelKey.findFirst({
        where: { channelId: dto.channelId, epoch: dto.epoch, recipientUserId: userId },
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

    // And nothing is sealed for a device its owner has revoked. The client
    // fetches a filtered directory, so this only catches a stale bundle or a
    // client that decided to improvise - but it is the difference between a
    // revocation and a suggestion.
    const revoked = await prisma.deviceKey.findMany({
      where: {
        revokedAt: { not: null },
        OR: dto.entries.map((entry) => ({
          userId: entry.recipientUserId,
          deviceId: entry.recipientDeviceId,
        })),
      },
      select: { id: true },
    });
    if (revoked.length > 0) {
      throw new ForbiddenException({
        code: 'DEVICE_REVOKED',
        message: 'One of those devices has been revoked',
      });
    }

    const result = await prisma.channelKey.createMany({
      data: dto.entries.map((entry) => ({
        channelId: dto.channelId,
        epoch: dto.epoch,
        recipientUserId: entry.recipientUserId,
        recipientDeviceId: entry.recipientDeviceId,
        senderUserId: userId,
        senderDeviceId: dto.senderDeviceId,
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

  /**
   * Devices that should hold this epoch and do not - one entry per machine.
   *
   * Per device rather than per person, which is the whole change: somebody who
   * signed in on a second laptop yesterday is not "covered" because their first
   * laptop was wrapped for. The comparison is against every unrevoked device of
   * every member.
   */
  private async missingAtEpoch(channelId: string, epoch: number): Promise<DeviceKey[]> {
    const memberIds = await this.memberIds(channelId);
    const [covered, devices] = await Promise.all([
      prisma.channelKey.findMany({
        where: { channelId, epoch },
        select: { recipientUserId: true, recipientDeviceId: true },
      }),
      prisma.deviceKey.findMany({
        where: { userId: { in: memberIds }, revokedAt: null },
      }),
    ]);

    const has = new Set(covered.map((row) => `${row.recipientUserId}:${row.recipientDeviceId}`));
    return devices
      .filter((device) => !has.has(`${device.userId}:${device.deviceId}`))
      .map(toDeviceKey);
  }
}

/** One row of the directory, as the contract has it. */
function toDeviceKey(row: {
  userId: string;
  deviceId: string;
  publicKey: string;
  label: string | null;
  revokedAt: Date | null;
  lastSeenAt: Date;
  createdAt: Date;
}): DeviceKey {
  return {
    userId: row.userId,
    deviceId: row.deviceId,
    publicKey: row.publicKey,
    label: row.label,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
