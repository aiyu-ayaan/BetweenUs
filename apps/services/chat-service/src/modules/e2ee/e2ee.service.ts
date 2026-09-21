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
import {
  ACCOUNT_SCOPE,
  isAccountScope,
  type AccountKeyRecipient,
  type BackupSecretKind,
  type ChannelKeysResponse,
  type DeviceKey,
  type IdentityBackup,
  type IdentityBackupResponse,
  type KeyHealthResponse,
  type PublishChannelKeysRequest,
  type PutIdentityBackupRequest,
} from '@betweenus/shared-types';
import { MessagesService } from '../messages/messages.service';
import { ESCROW_KIND } from './vault.service';

/**
 * How many epochs back a re-wrap is offered in one response.
 *
 * A ceiling rather than a policy: a client works through what it is given and
 * asks again, so a channel with a hundred epochs recovers over a few opens
 * instead of in one response nobody wants to build or parse.
 */
const MAX_GAP_EPOCHS = 20;

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
    holdsVault?: boolean,
  ): Promise<DeviceKey> {
    const existing = await prisma.deviceKey.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
      select: { revokedAt: true, grantedAt: true },
    });
    if (existing?.revokedAt) {
      throw new ForbiddenException({
        code: 'DEVICE_REVOKED',
        message: 'This device was revoked',
      });
    }

    // `grantedAt` is only ever set, never cleared, and only by a machine
    // saying it can open the vault. Clearing it on a launch that happened to
    // start offline would put a working installation on the locked screen and
    // ask its owner to approve a machine that needs no approving.
    const granted = holdsVault ? { grantedAt: existing?.grantedAt ?? new Date() } : {};

    const row = await prisma.deviceKey.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      update: { publicKey, lastSeenAt: new Date(), ...(label ? { label } : {}), ...granted },
      create: { userId, deviceId, publicKey, label: label ?? null, ...granted },
    });

    // A machine that got in by itself - somebody typed a recovery code on it -
    // withdraws the request it made while it was locked. Leaving it would put
    // a machine that needs nothing on the approval screen of every other
    // machine of the account, and an approval prompt that is not asking for
    // anything is how people learn to approve without looking.
    if (holdsVault) {
      await prisma.vaultGrantRequest.deleteMany({ where: { userId, deviceId, grantedAt: null } });
    }

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
    const rows = await prisma.identityBackup.findMany({ where: { userId } });
    const backups = rows.map(toIdentityBackup);

    return {
      backups,
      // A client older than per-kind backups reads one blob and one kind. Give
      // it the password one when it exists, because the password is the secret
      // such a client actually holds at sign-in; handing it the passphrase blob
      // would make it decide it cannot open anything and mint its own identity.
      backup: backups.find((it) => it.kind === 'password') ?? backups[0] ?? null,
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
      kdf: dto.kdf,
      iterations: dto.iterations,
      salt: dto.salt,
      iv: dto.iv,
      ciphertext: dto.ct,
      publicKey: dto.publicKey,
    };
    // Scoped to the kind, so writing a passphrase backup leaves the password
    // one standing. It used to be keyed on the account, and setting a
    // passphrase silently took away the only blob a fresh sign-in can open.
    await prisma.identityBackup.upsert({
      where: { userId_kind: { userId, kind: dto.kind } },
      update: data,
      create: { userId, kind: dto.kind, ...data },
    });
  }

  /**
   * Drops one kind of backup, which is how somebody says "my password must not
   * be able to recover my messages".
   *
   * Deleting the last one is allowed. It is the same thing as never having had
   * one, and refusing would be the server deciding how recoverable an account
   * is - a choice that belongs to whoever holds the keys, not to the courier.
   */
  async deleteIdentityBackup(userId: string, kind: BackupSecretKind): Promise<void> {
    await prisma.identityBackup.deleteMany({ where: { userId, kind } });
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

  /**
   * Who a channel key must be wrapped for: one entry per member account.
   *
   * One per *account*, where v1 sent one per machine. That is not a
   * simplification, it is the fix: a list of machines is a list that grows
   * after the key was minted, and every machine added to it after the fact was
   * a person reading padlocks until somebody else's client noticed. A list of
   * accounts is settled the moment the membership is.
   *
   * An account with no vault yet is left out, because there is nothing to wrap
   * to. It reappears here the moment it sets one up, as an entry in
   * `missingRecipients`, and the next client into the channel seals for it.
   */
  async recipientsForChannel(userId: string, channelId: string): Promise<AccountKeyRecipient[]> {
    await this.messages.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);
    return this.recipients(await this.memberIds(channelId));
  }

  /** Wrapped keys addressed to the caller, plus who still needs a re-wrap. */
  async keysForUser(userId: string, channelId: string): Promise<ChannelKeysResponse> {
    await this.messages.requireChannelAccess(userId, channelId, PERMISSIONS.VIEW_CHANNEL);

    const [all, latest] = await Promise.all([
      prisma.channelKey.findMany({
        // Every row addressed to the caller's account, account-scoped and
        // per-device alike: a client holds the account keyring plus this
        // machine's own key, tries each row against both, and keeps what
        // opens. Filtering by device here would mean trusting a device id the
        // caller supplied, which is a claim rather than a fact.
        where: { channelId, recipientUserId: userId },
        orderBy: { epoch: 'asc' },
      }),
      prisma.channelKey.aggregate({ where: { channelId }, _max: { epoch: true } }),
    ]);

    const epoch = latest._max.epoch ?? 0;
    // Rows sealed to an identity this account has since reset away open for
    // nobody; handing them over only makes the client try every one.
    const since = (await vaultsCreatedAt([userId])).get(userId);
    const rows = all.filter((row) => !isStaleWrap(row, since));

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
      gaps: epoch === 0 ? [] : await this.gaps(channelId),
      promotable: promotableEpochs(rows),
    };
  }

  /**
   * How much of this account's history survives losing every machine it owns.
   *
   * The question v1 had no way to ask, and the one that decides whether any of
   * this worked. `sealed` counts epochs whose key exists only as a wrap
   * addressed to a machine - each of those is a conversation that a reinstall
   * would have destroyed, and each is repaired by that machine promoting it.
   * `lost` counts epochs with no wrap at all: nothing can repair those, and
   * saying so plainly is better than a client drawing padlocks forever and
   * implying somebody is coming.
   */
  async keyHealth(userId: string): Promise<KeyHealthResponse> {
    const [all, portableFactors, since] = await Promise.all([
      prisma.channelKey.findMany({
        where: { recipientUserId: userId },
        select: { channelId: true, epoch: true, recipientDeviceId: true, createdAt: true },
      }),
      prisma.accountVaultFactor.count({
        where: { userId, kind: { in: ['password', 'passphrase', 'recovery-code', ESCROW_KIND] } },
      }),
      vaultsCreatedAt([userId]).then((map) => map.get(userId)),
    ]);
    const rows = all.filter((row) => !isStaleWrap(row, since));

    const scoped = new Map<string, boolean>();
    for (const row of rows) {
      const at = `${row.channelId}#${row.epoch}`;
      scoped.set(at, (scoped.get(at) ?? false) || isAccountScope(row.recipientDeviceId));
    }

    let portable = 0;
    let sealed = 0;
    for (const isPortable of scoped.values()) {
      if (isPortable) portable += 1;
      else sealed += 1;
    }

    // Every epoch of every channel the caller can see, minus the ones they
    // hold something for. An epoch nobody ever wrapped for them is not a
    // padlock that will open later; it is one that never will.
    const channelIds = [...new Set(rows.map((row) => row.channelId))];
    const reachable = await prisma.channelKey.groupBy({
      by: ['channelId', 'epoch'],
      where: { channelId: { in: channelIds } },
    });
    const lost = reachable.filter((at) => !scoped.has(`${at.channelId}#${at.epoch}`)).length;

    return { portable, sealed, lost, recoverable: portableFactors > 0 };
  }

  /**
   * Channels this account holds any wrap for.
   *
   * Exists for one job: a client that has just unlocked the vault sweeping
   * every channel to promote the v1 rows only it can open. Waiting for
   * somebody to open each channel would work eventually, and "eventually" is
   * the wrong word for a rescue whose window closes when this installation is
   * wiped - the channel nobody has opened in six months is exactly the one
   * most likely to be lost with it.
   */
  async channelsWithKeys(userId: string): Promise<string[]> {
    const rows = await prisma.channelKey.groupBy({
      by: ['channelId'],
      where: { recipientUserId: userId },
    });
    return rows.map((row) => row.channelId);
  }

  /**
   * Earlier epochs a member is owed an account wrap for.
   *
   * Almost empty by construction now, and that is the point. v1's gap list
   * existed to repair a person's own second machine, one epoch at a time,
   * whenever another of their machines happened to open the channel - which is
   * why history arrived late, arrived partially, or never arrived at all. A
   * wrap addressed to the account needs no repair: the second machine opens
   * the same row the first one does.
   *
   * What is left is the single deliberate exception - a member somebody with
   * `MANAGE_MEMBER` let in *with* the history - and the rule around it is
   * unchanged. The server writes nothing; it holds no key. It says who is
   * owed, and a client that holds the epoch seals it.
   */
  private async gaps(
    channelId: string,
  ): Promise<Array<{ epoch: number; recipients: AccountKeyRecipient[] }>> {
    const memberIds = await this.memberIds(channelId);
    const [withHistory, covered, since] = await Promise.all([
      this.historySharedWith(channelId, memberIds),
      prisma.channelKey.findMany({
        where: { channelId, recipientDeviceId: ACCOUNT_SCOPE },
        select: { epoch: true, recipientUserId: true, recipientDeviceId: true, createdAt: true },
      }),
      vaultsCreatedAt(memberIds),
    ]);

    const owed = owedEpochs(covered, since, withHistory);
    if (owed.size === 0) return [];
    const recipients = await this.recipients([...new Set([...owed.values()].flat())]);

    return [...owed.keys()]
      .sort((a, b) => b - a)
      .map((at) => ({
        epoch: at,
        recipients: recipients.filter((who) => owed.get(at)?.includes(who.userId)),
      }))
      .filter((gap) => gap.recipients.length > 0)
      // The newest epochs matter most - they are what the next message uses -
      // and a channel with a long history should not be one enormous response.
      .slice(0, MAX_GAP_EPOCHS);
  }

  /**
   * Members somebody deliberately let in with the history that predates them.
   *
   * The rule everywhere else here is that a member reads from the moment they
   * arrive and no further back. That is still the default, and it is still
   * what happens unless a person with `MANAGE_MEMBER` said otherwise while
   * adding them.
   *
   * When they did, `server_members.historyShared` records it, and this is where
   * that note is turned into an answer: those members appear in the gap list
   * for every epoch of every channel in the server, and the first client that
   * already holds them seals them across. The server hands over nothing itself
   * - it holds no key - and the publish rules are unchanged: a caller may still
   * only add to an epoch it holds.
   *
   * A direct message has no server and therefore no such note. It also needs
   * none: both participants have been there since the first message.
   */
  private async historySharedWith(
    channelId: string,
    memberIds: string[],
  ): Promise<Set<string>> {
    if (memberIds.length === 0) return new Set();

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    if (!channel?.serverId) return new Set();

    const shared = await prisma.serverMember.findMany({
      where: { serverId: channel.serverId, userId: { in: memberIds }, historyShared: true },
      select: { userId: true },
    });
    return new Set(shared.map((row) => row.userId));
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
        select: { recipientUserId: true, recipientDeviceId: true, createdAt: true },
      }),
    ]);

    const members = new Set(memberIds);
    if (holders.some((holder) => !members.has(holder.recipientUserId))) return true;

    // The second way to hold a key you should not: a *machine* that was
    // trusted when the epoch was minted and has been revoked since.
    //
    // Narrower than it was, and deliberately so. Under v1 every wrap was
    // addressed to a machine, so revoking one meant the epoch was loose and
    // every channel re-keyed. Under v2 the wrap is addressed to the account,
    // and a revoked machine keeps whatever it decrypted and nothing else -
    // but it may still hold the account keyring it was granted, so a revoked
    // machine is still a reason to rotate. What changed is that rotation is
    // now the account's to do (`POST /e2ee/vault/rotate`) as well as the
    // channel's, and this flag is the channel half of it.
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
   *
   * Two v2 rules sit on top, and both exist to stop the account-scoped wrap
   * being quietly downgraded back into the thing that lost data:
   *
   * - **A new wrap must be account-scoped.** `@account` or nothing. A client
   *   that went on writing per-device rows would look like it was working and
   *   would rebuild v1's failure a channel at a time, invisibly, because
   *   everything reads correctly on the machine that wrote it.
   * - **A per-device row may only be promoted by the account that holds it.**
   *   That is the one exception above, and it is not a grant: the caller is
   *   re-addressing a key it can already open to its own account key.
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
      const [held, since] = await Promise.all([
        prisma.channelKey.findMany({
          where: { channelId: dto.channelId, epoch: dto.epoch, recipientUserId: userId },
          select: { recipientDeviceId: true, createdAt: true },
        }),
        vaultsCreatedAt([userId]).then((map) => map.get(userId)),
      ]);
      // A wrap to an identity this account reset away is not holding the key.
      const holdsKey = held.some((row) => !isStaleWrap(row, since));
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

    // Everything written from here on is addressed to an account. The one way
    // past this is the caller promoting its own v1 row, which is the migration
    // and not a hole: `recipientUserId` is the caller, so it is re-addressing
    // a key it already holds to a key it already holds.
    for (const entry of dto.entries) {
      if (isAccountScope(entry.recipientDeviceId)) continue;
      throw new ForbiddenException({
        code: 'DEVICE_SCOPED_WRAP',
        message: 'Channel keys are wrapped for an account, not for a machine',
      });
    }

    // Nothing is sealed for an account with no vault, because there is no
    // account key to have sealed it to. A bundle claiming otherwise was built
    // from a directory read that has since gone stale, or by a client
    // improvising - and storing it would write a row nobody can ever open,
    // which is indistinguishable from the data loss this all exists to end.
    const vaults = await prisma.accountVault.findMany({
      where: { userId: { in: [...new Set(dto.entries.map((entry) => entry.recipientUserId))] } },
      select: { userId: true, createdAt: true },
    });
    const hasVault = new Set(vaults.map((row) => row.userId));
    for (const entry of dto.entries) {
      if (!hasVault.has(entry.recipientUserId)) {
        throw new ForbiddenException({
          code: 'RECIPIENT_HAS_NO_VAULT',
          message: 'That account has not published an identity to wrap for yet',
        });
      }
    }

    // The sealing machine must itself be one the account still trusts. A
    // revoked laptop writing wraps would be revocation as a suggestion, and
    // the machine in question is running this same code.
    const sender = await prisma.deviceKey.findUnique({
      where: { userId_deviceId: { userId, deviceId: dto.senderDeviceId } },
      select: { revokedAt: true },
    });
    if (sender?.revokedAt) {
      throw new ForbiddenException({
        code: 'DEVICE_REVOKED',
        message: 'This device was revoked',
      });
    }

    // "Existing entries are never overwritten" has one exception: a wrap to an
    // identity its account has since reset away. It opens for nobody, and
    // leaving it would make the fresh one below a skipped duplicate.
    const stale = vaults.map((vault) =>
      prisma.channelKey.deleteMany({
        where: {
          channelId: dto.channelId,
          epoch: dto.epoch,
          recipientUserId: vault.userId,
          recipientDeviceId: ACCOUNT_SCOPE,
          createdAt: { lt: vault.createdAt },
        },
      }),
    );
    const store = prisma.channelKey.createMany({
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
    // Deletes first, in the same transaction, so a fresh wrap never collides
    // with the stale row it replaces.
    const results = await prisma.$transaction([...stale, store]);
    return { epoch: dto.epoch, stored: results.at(-1)?.count ?? 0 };
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
   * Turns a list of accounts into the public keys to wrap for.
   *
   * An account with no vault is dropped rather than guessed at. There is
   * genuinely nothing to seal to - it has published no account identity - and
   * inventing one would be the server minting a key, which is the one thing it
   * must never be able to do. It reappears in `missingRecipients` the moment
   * it sets a vault up.
   */
  private async recipients(userIds: string[]): Promise<AccountKeyRecipient[]> {
    if (userIds.length === 0) return [];
    const rows = await prisma.accountVault.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, publicKey: true, generation: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      publicKey: row.publicKey,
      generation: row.generation,
    }));
  }

  /**
   * Members who should hold this epoch and do not - one entry per account.
   *
   * Per account rather than per machine, which is the whole change. Under v1
   * somebody who signed in on a second laptop yesterday was "missing" the
   * epoch and had to wait for one of their own machines to notice; under v2
   * there is nothing to notice, because the wrap their first laptop opens is
   * the same row the second one reads.
   *
   * What this list is for now is narrower and more important: it is what a
   * sender must clear *before* sealing a message. A message sent under an
   * epoch a member has no wrap for is a message that member will never read,
   * and nothing later repairs it.
   */
  private async missingAtEpoch(channelId: string, epoch: number): Promise<AccountKeyRecipient[]> {
    const memberIds = await this.memberIds(channelId);
    const [covered, recipients, since] = await Promise.all([
      prisma.channelKey.findMany({
        where: { channelId, epoch, recipientDeviceId: ACCOUNT_SCOPE },
        select: { recipientUserId: true, recipientDeviceId: true, createdAt: true },
      }),
      this.recipients(memberIds),
      vaultsCreatedAt(memberIds),
    ]);

    // A wrap to an identity the member has since reset away covers nothing.
    const has = new Set(
      covered
        .filter((row) => !isStaleWrap(row, since.get(row.recipientUserId)))
        .map((row) => row.recipientUserId),
    );
    return recipients.filter((who) => !has.has(who.userId));
  }
}

/**
 * Epochs the caller holds only as a v1 per-device wrap.
 *
 * The rescue path for every conversation written before the vault, and the
 * whole of the migration: the client can open these rows *today*, on this
 * machine, and nothing but this machine can. Re-sealing what it can already
 * read to its own account key costs one request and takes that epoch
 * permanently out of reach of every way v1 lost data - on every machine of the
 * account, including the ones that do not exist yet.
 *
 * It grants nothing. The caller is re-addressing a key it already holds to
 * itself, and `publishKeys` checks exactly that before storing it.
 *
 * Kept as a free function so the rule can be asserted on without a database.
 */
export function promotableEpochs(
  rows: Array<{ epoch: number; recipientDeviceId: string }>,
): number[] {
  const perDevice = new Set<number>();
  const perAccount = new Set<number>();
  for (const row of rows) {
    if (isAccountScope(row.recipientDeviceId)) perAccount.add(row.epoch);
    else perDevice.add(row.epoch);
  }
  return [...perDevice].filter((epoch) => !perAccount.has(epoch)).sort((a, b) => a - b);
}

/** One row of the directory, as the contract has it. */
function toIdentityBackup(row: {
  kind: string;
  kdf: string;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  publicKey: string;
  updatedAt: Date;
}): IdentityBackup {
  return {
    v: 1,
    kind: row.kind as BackupSecretKind,
    kdf: row.kdf as IdentityBackup['kdf'],
    iterations: row.iterations,
    salt: row.salt,
    iv: row.iv,
    ct: row.ciphertext,
    publicKey: row.publicKey,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Exported for the status module, which wraps for the same directory this one
 * publishes: one shape for a device key, not two that nearly agree.
 */
export function toDeviceKey(row: {
  userId: string;
  deviceId: string;
  publicKey: string;
  label: string | null;
  revokedAt: Date | null;
  grantedAt: Date | null;
  lastSeenAt: Date;
  createdAt: Date;
}): DeviceKey {
  return {
    userId: row.userId,
    deviceId: row.deviceId,
    publicKey: row.publicKey,
    label: row.label,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    // Null is what puts a machine on the locked screen, so it is carried
    // rather than defaulted: a missing grant and a grant this response forgot
    // to mention look identical to the client, and one of the two is a machine
    // that sits waiting for an approval nobody was asked for.
    grantedAt: row.grantedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** When each account's current vault was created. Absent for no vault. */
async function vaultsCreatedAt(userIds: string[]): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.accountVault.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, createdAt: true },
  });
  return new Map(rows.map((row) => [row.userId, row.createdAt]));
}

/**
 * Whether an account-scoped wrap was sealed to an identity its account has
 * since reset away (`VaultService.reset`). A reset replaces the vault, so a
 * wrap older than the account's current vault opens for nobody.
 *
 * Per-device v1 rows are never stale by this rule: they are sealed to a
 * machine's own key, which a vault reset does not touch.
 */
export function isStaleWrap(
  row: { recipientDeviceId: string; createdAt: Date },
  vaultCreatedAt: Date | undefined,
): boolean {
  return (
    isAccountScope(row.recipientDeviceId) &&
    vaultCreatedAt !== undefined &&
    row.createdAt < vaultCreatedAt
  );
}

/**
 * Which accounts are owed which epochs, keyed by epoch.
 *
 * Two kinds of member are owed an epoch they hold no working wrap for:
 *
 * - one let in *with* the history (`historyShared`), for every epoch;
 * - one whose wrap for that epoch is stale because the account reset its
 *   vault. They were entitled to it before and still are - the reset changed
 *   the key, not who is in the channel.
 *
 * Kept free of the database so the rule can be checked on its own.
 */
export function owedEpochs(
  covered: Array<{ epoch: number; recipientUserId: string; recipientDeviceId: string; createdAt: Date }>,
  vaultCreatedAt: Map<string, Date>,
  withHistory: Set<string>,
): Map<number, string[]> {
  const fresh = new Set<string>();
  const stale = new Set<string>();
  for (const row of covered) {
    const at = `${row.epoch}:${row.recipientUserId}`;
    if (isStaleWrap(row, vaultCreatedAt.get(row.recipientUserId))) stale.add(at);
    else fresh.add(at);
  }

  const epochs = [...new Set(covered.map((row) => row.epoch))];
  const owed = new Map<number, string[]>();
  for (const epoch of epochs) {
    const who = new Set<string>();
    for (const userId of withHistory) {
      if (!fresh.has(`${epoch}:${userId}`)) who.add(userId);
    }
    for (const key of stale) {
      const [at, userId] = key.split(':') as [string, string];
      if (Number(at) === epoch && !fresh.has(key)) who.add(userId);
    }
    // Only accounts with a vault can be sealed to.
    const withVault = [...who].filter((userId) => vaultCreatedAt.has(userId));
    if (withVault.length > 0) owed.set(epoch, withVault);
  }
  return owed;
}
