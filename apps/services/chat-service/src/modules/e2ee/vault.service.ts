/**
 * The account vault: one identity keyring per account, and the doors into it.
 *
 * Everything stored here is ciphertext the server has no key for, plus one
 * public key that is public by definition. This service decides *who may
 * write* and enforces the one invariant that keeps an account recoverable; it
 * never decides what is inside, because it cannot.
 *
 * ## Why this exists
 *
 * v1 sealed the identity of one *machine* and let a machine that could not
 * open a backup mint an identity of its own. An account therefore accumulated
 * identities, and a channel key wrapped for one of them was invisible to every
 * other. "My messages are gone on my new phone" was not a sync delay, it was
 * the permanent and correct outcome of that design.
 *
 * The vault makes the identity belong to the account. Any machine that can
 * open any one factor holds it, and therefore holds every channel key ever
 * wrapped for the account - including for channels and epochs that predate the
 * machine by years.
 *
 * ## The invariant
 *
 * An account must always keep at least one **portable** factor: a password, a
 * passphrase or a recovery code. A vault whose only doors are grants sealed to
 * machines is one wipe away from losing everything, which is the exact state
 * this design exists to make unreachable. `assertPortableRemains` is that rule
 * and it is the only thing here that ever refuses a delete.
 */
import { createDecipheriv } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { openSecret, sealSecret } from '@betweenus/auth';
import { prisma } from '@betweenus/database';
import {
  PORTABLE_FACTOR_KINDS,
  isPortableFactor,
  type AccountVaultResponse,
  type CreateVaultRequest,
  type VaultEscrowResponse,
  type PutVaultFactorRequest,
  type RotateVaultRequest,
  type VaultFactor,
  type VaultFactorKind,
  type VaultGrantRequest,
  type VaultGrantsResponse,
} from '@betweenus/shared-types';

/**
 * How many machines may queue for a grant at once.
 *
 * A ceiling rather than a policy: the list is drawn in a settings panel and
 * read by a person, and an account with fifty pending machines is somebody
 * hammering the endpoint rather than somebody with fifty laptops.
 */
const MAX_PENDING_GRANTS = 20;

/**
 * The factor row the server-held master key is filed under.
 *
 * Kept out of `VaultFactorKind` on purpose: clients never see it in a factor
 * list, never try to open it themselves, and cannot put or delete it through
 * the factor routes. It has routes of its own.
 */
export const ESCROW_KIND = 'server';

@Injectable()
export class VaultService {
  /**
   * The caller's vault, or an explicit null.
   *
   * The null is load-bearing and the clients are held to it: a *failed* read
   * must never be treated as "this account has no vault", because that would
   * mint a second identity over a standing one and orphan every key already
   * wrapped for the first. It is the single most destructive mistake a client
   * can make here, which is why the shape says "vault: null" rather than
   * returning an empty object somebody can misread.
   */
  async vault(userId: string): Promise<AccountVaultResponse> {
    const row = await prisma.accountVault.findUnique({
      where: { userId },
      include: { factors: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return { vault: null };

    return {
      vault: {
        publicKey: row.publicKey,
        generation: row.generation,
        keyring: { v: 1, iv: row.keyringIv, ct: row.keyringCiphertext },
        factors: row.factors.filter((factor) => factor.kind !== ESCROW_KIND).map(toFactor),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  /**
   * Creates the vault. Refused if one already stands.
   *
   * Refusing rather than replacing is the whole of the safety here. A create
   * that overwrote would turn one confused client - a failed fetch read as "no
   * vault", a race between two machines signing in at the same second - into
   * the permanent loss of every channel key wrapped for the identity it
   * replaced. There is no undo for that and no way to detect it afterwards, so
   * the only safe answer to "create, but one exists" is to say so and let the
   * client read the one that exists.
   */
  async createVault(userId: string, dto: CreateVaultRequest): Promise<AccountVaultResponse> {
    if (dto.escrow === undefined) assertPortablePresent(dto.factors.map((factor) => factor.kind));
    if (dto.escrow !== undefined) assertOpensKeyring(dto.escrow, dto.keyring.iv, dto.keyring.ct);

    const existing = await prisma.accountVault.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException({
        code: 'VAULT_EXISTS',
        message: 'This account already has a vault; read it rather than replacing it',
      });
    }

    await prisma.$transaction(async (tx) => {
      const vault = await tx.accountVault.create({
        data: {
          userId,
          publicKey: dto.publicKey,
          generation: 1,
          keyringIv: dto.keyring.iv,
          keyringCiphertext: dto.keyring.ct,
        },
      });
      await tx.accountVaultFactor.createMany({
        data: dto.factors.map((factor) => ({
          vaultId: vault.id,
          userId,
          ...factorColumns(factor),
        })),
      });
      if (dto.escrow !== undefined) {
        await tx.accountVaultFactor.create({
          data: { vaultId: vault.id, userId, ...escrowColumns(dto.escrow) },
        });
      }
    });

    return this.vault(userId);
  }

  /**
   * Replaces the sealed keyring after a rotation appended a generation.
   *
   * `generation` must be exactly the next one - the same no-jumping rule a
   * channel epoch has, and for the same reason: two machines rotating at once
   * would otherwise each believe they won, and one of the two keyrings would
   * be the only copy of a private half now published as the account's.
   *
   * Nothing is lost by a rotation, because the thing being replaced is a ring.
   * The client appends a generation and re-seals; every earlier private half
   * is still in there, so every channel key ever wrapped to an older public
   * half still opens. v1 could not rotate at all for want of this.
   */
  async rotate(userId: string, dto: RotateVaultRequest): Promise<AccountVaultResponse> {
    const row = await prisma.accountVault.findUnique({ where: { userId } });
    if (!row) {
      throw new BadRequestException({ code: 'NO_VAULT', message: 'This account has no vault' });
    }
    if (dto.generation !== row.generation + 1) {
      throw new ConflictException({
        code: 'GENERATION_OUT_OF_ORDER',
        message: `Next generation is ${row.generation + 1}`,
      });
    }

    await prisma.accountVault.update({
      where: { userId },
      data: {
        publicKey: dto.publicKey,
        generation: dto.generation,
        keyringIv: dto.keyring.iv,
        keyringCiphertext: dto.keyring.ct,
      },
    });
    return this.vault(userId);
  }

  /**
   * Adds or replaces one door.
   *
   * Replacing is the ordinary case and needs no ceremony: a changed password
   * re-seals the same master key under a new derivation, and the server cannot
   * tell a good blob from noise anyway. What it *can* check is that the master
   * key being sealed is the one already in use - and it cannot, so the client
   * is held to it by the only thing that makes it safe: a factor may only be
   * written by a session that could already open the vault, which is exactly
   * what holding one of the other factors means.
   *
   * A `device` factor additionally stamps the grant, so the machine it was
   * written for stops showing the locked screen and the request leaves the
   * pending list.
   */
  async putFactor(userId: string, dto: PutVaultFactorRequest): Promise<{ ok: true }> {
    const vault = await prisma.accountVault.findUnique({ where: { userId } });
    if (!vault) {
      throw new BadRequestException({ code: 'NO_VAULT', message: 'This account has no vault' });
    }

    assertFactorShape(dto);

    const deviceId = isPortableFactor(dto.kind) ? '' : dto.deviceId;
    await prisma.$transaction(async (tx) => {
      await tx.accountVaultFactor.upsert({
        where: { userId_kind_deviceId: { userId, kind: dto.kind, deviceId } },
        update: factorColumns(dto),
        create: { vaultId: vault.id, userId, ...factorColumns(dto) },
      });

      if (dto.kind === 'device') {
        await tx.vaultGrantRequest.updateMany({
          where: { userId, deviceId, grantedAt: null },
          data: { grantedAt: new Date() },
        });
        await tx.deviceKey.updateMany({
          where: { userId, deviceId, revokedAt: null },
          data: { grantedAt: new Date() },
        });
      }
    });

    return { ok: true };
  }

  /**
   * Takes one door away.
   *
   * The only refusal is the invariant: a portable factor may not be removed
   * when it is the last one. Somebody turning off password recovery because a
   * live server sees the password at sign-in is doing something reasonable;
   * doing it before writing down a recovery code is losing the account, and
   * the difference between those two is a check the server can actually make.
   *
   * A `device` grant has no such guard. Revoking a machine is supposed to be
   * possible at any moment, and it takes nothing from the account - every
   * portable door still opens.
   */
  async deleteFactor(
    userId: string,
    kind: VaultFactorKind,
    deviceId: string,
  ): Promise<{ ok: true }> {
    const scoped = isPortableFactor(kind) ? '' : deviceId;

    if (isPortableFactor(kind)) {
      const portable = await prisma.accountVaultFactor.count({
        // The server-held key counts: it survives every machine being lost.
        where: { userId, kind: { in: [...PORTABLE_FACTOR_KINDS, ESCROW_KIND] } },
      });
      const removing = await prisma.accountVaultFactor.count({ where: { userId, kind } });
      if (removing > 0 && portable - removing < 1) {
        throw new ForbiddenException({
          code: 'LAST_PORTABLE_FACTOR',
          message:
            'Set a recovery code or passphrase first: removing this would leave the account with no way back in',
        });
      }
    }

    await prisma.accountVaultFactor.deleteMany({ where: { userId, kind, deviceId: scoped } });
    return { ok: true };
  }

  /**
   * The master key as the server holds it, for a signed-in session of the
   * account it belongs to - and nobody else, because `userId` comes from the
   * access token rather than from anything the caller said.
   *
   * This is what lets a new phone, a reinstalled laptop or a provider sign-in
   * with no password open the whole history with nothing typed. Null when no
   * key is held, or when the one held was sealed under a settings secret this
   * deployment no longer has: either way the next machine that holds the key
   * puts it back.
   */
  async escrow(userId: string): Promise<VaultEscrowResponse> {
    const row = await prisma.accountVaultFactor.findUnique({
      where: { userId_kind_deviceId: { userId, kind: ESCROW_KIND, deviceId: '' } },
      select: { ciphertext: true },
    });
    return { masterKey: row ? openSecret(row.ciphertext) : null };
  }

  /**
   * Stores the master key for the server to hold.
   *
   * Only a key that opens the account's keyring is accepted. The server can
   * check that - it holds the sealed keyring - and it is the check that
   * matters: an escrowed key that did not open it would hand every new machine
   * of this account a key to nothing.
   */
  async putEscrow(userId: string, masterKey: string): Promise<{ ok: true }> {
    const vault = await prisma.accountVault.findUnique({ where: { userId } });
    if (!vault) {
      throw new BadRequestException({ code: 'NO_VAULT', message: 'This account has no vault' });
    }
    assertOpensKeyring(masterKey, vault.keyringIv, vault.keyringCiphertext);

    const columns = escrowColumns(masterKey);
    await prisma.accountVaultFactor.upsert({
      where: { userId_kind_deviceId: { userId, kind: ESCROW_KIND, deviceId: '' } },
      update: columns,
      create: { vaultId: vault.id, userId, ...columns },
    });
    return { ok: true };
  }

  /**
   * Starts the account's vault over, for an account nobody can open any more.
   *
   * The way out of the state vaults created before the server held a key could
   * reach: every machine locked, the recovery code never written down, and no
   * password factor because the vault was created on a launch that had none.
   * Nothing in that vault can be opened by anybody, so replacing it loses
   * nothing that was not already lost.
   *
   * Refused while the server holds a key that opens the vault - then there is
   * a way in, and a client asking to reset is a client with a bug.
   *
   * The account-scoped channel keys addressed to the old identity are left in
   * place. They open for nobody, but they are the record of which epochs this
   * account was entitled to: rows older than the new vault are treated as
   * stale, and `E2eeService.gaps` lists those epochs so the other members'
   * clients re-seal them to the new identity. That is how a two-person chat
   * gets its history back after a reset.
   */
  async reset(userId: string): Promise<{ ok: true }> {
    const { masterKey } = await this.escrow(userId);
    if (masterKey) {
      throw new ConflictException({
        code: 'VAULT_ESCROWED',
        message: 'This vault can still be opened; fetch the held key instead',
      });
    }

    await prisma.$transaction([
      prisma.accountVault.deleteMany({ where: { userId } }),
      prisma.vaultGrantRequest.deleteMany({ where: { userId } }),
    ]);
    return { ok: true };
  }

  /**
   * A machine asking to be let in.
   *
   * Nothing secret crosses here: a device id, that machine's public key and a
   * label. What makes approving it safe is that the grant is sealed to *that
   * public key*, and that the two screens show the same fingerprint for the
   * two people to compare out of band - the same protection a safety number
   * gives a conversation, applied to a machine.
   *
   * Upserted, because a machine that asks twice is a machine that was
   * restarted, not a second machine.
   */
  async requestGrant(
    userId: string,
    deviceId: string,
    publicKey: string,
    label: string | null,
    fingerprint: string,
  ): Promise<{ ok: true }> {
    const pending = await prisma.vaultGrantRequest.count({ where: { userId, grantedAt: null } });
    const mine = await prisma.vaultGrantRequest.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
    });
    if (!mine && pending >= MAX_PENDING_GRANTS) {
      throw new ForbiddenException({
        code: 'TOO_MANY_GRANT_REQUESTS',
        message: 'Too many machines are waiting to be approved',
      });
    }

    await prisma.vaultGrantRequest.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      update: { publicKey, label, fingerprint, grantedAt: null },
      create: { userId, deviceId, publicKey, label, fingerprint },
    });
    return { ok: true };
  }

  /** Machines of this account waiting to be let in. Never anybody else's. */
  async pendingGrants(userId: string): Promise<VaultGrantsResponse> {
    const rows = await prisma.vaultGrantRequest.findMany({
      where: { userId, grantedAt: null },
      orderBy: { createdAt: 'asc' },
      take: MAX_PENDING_GRANTS,
    });

    return {
      requests: rows.map(
        (row): VaultGrantRequest => ({
          deviceId: row.deviceId,
          publicKey: row.publicKey,
          label: row.label,
          fingerprint: row.fingerprint,
          requestedAt: row.createdAt.toISOString(),
        }),
      ),
    };
  }

  /**
   * Whether this machine has been let in yet, which is the one question the
   * locked screen polls.
   *
   * Answered from the factor rather than from the request row, because the
   * factor is the thing that actually opens the vault: a request marked
   * granted with no factor beside it would put a machine back on a screen it
   * cannot leave.
   */
  async grantFor(userId: string, deviceId: string): Promise<VaultFactor | null> {
    const row = await prisma.accountVaultFactor.findUnique({
      where: { userId_kind_deviceId: { userId, kind: 'device', deviceId } },
    });
    return row ? toFactor(row) : null;
  }

  /** Withdraws a request, for somebody who changed their mind on the other screen. */
  async denyGrant(userId: string, deviceId: string): Promise<{ ok: true }> {
    await prisma.vaultGrantRequest.deleteMany({ where: { userId, deviceId, grantedAt: null } });
    return { ok: true };
  }
}

/**
 * The shape rules the server can actually check, as opposed to the ones it has
 * to trust the client for.
 *
 * Both arms matter for a different reason. A PBKDF2 factor's iteration count
 * is the one number in the row that decides what stealing the table is worth,
 * so it has a floor. An ECDH factor must name the machine it is for and the
 * key it was sealed from, because without either the row is a blob addressed
 * to nobody, and the machine waiting for it would poll forever.
 */
function assertFactorShape(factor: PutVaultFactorRequest): void {
  if (factor.kind === 'device') {
    if (factor.kdf !== 'ECDH-HKDF-SHA256') {
      throw new BadRequestException({
        code: 'INVALID_FACTOR',
        message: 'A device grant is sealed with ECDH-HKDF-SHA256',
      });
    }
    if (!factor.deviceId || !factor.senderPublicKey) {
      throw new BadRequestException({
        code: 'INVALID_FACTOR',
        message: 'A device grant needs the machine it is for and the key it was sealed from',
      });
    }
    return;
  }

  if (factor.kdf !== 'PBKDF2-SHA256') {
    throw new BadRequestException({
      code: 'INVALID_FACTOR',
      message: 'A secret-derived factor is sealed with PBKDF2-SHA256',
    });
  }
  if (factor.iterations < 600_000) {
    throw new BadRequestException({
      code: 'WEAK_FACTOR',
      message: 'At least 600000 PBKDF2 iterations',
    });
  }
  if (!factor.salt) {
    throw new BadRequestException({ code: 'INVALID_FACTOR', message: 'A derived factor needs a salt' });
  }
}

/**
 * A vault may not be *created* without a portable door.
 *
 * Checked at creation as well as at deletion because the two are the same
 * mistake at different moments: an account that starts with nothing but a
 * device grant has never been recoverable, and nothing later would notice.
 */
function assertPortablePresent(kinds: VaultFactorKind[]): void {
  if (!kinds.some(isPortableFactor)) {
    throw new BadRequestException({
      code: 'NO_PORTABLE_FACTOR',
      message: 'A vault needs at least one of: a password, a passphrase or a recovery code',
    });
  }
}

function factorColumns(factor: PutVaultFactorRequest) {
  return {
    kind: factor.kind,
    deviceId: isPortableFactor(factor.kind) ? '' : factor.deviceId,
    kdf: factor.kdf,
    iterations: factor.iterations,
    salt: factor.salt,
    iv: factor.iv,
    ciphertext: factor.ct,
    senderPublicKey: factor.senderPublicKey,
  };
}

function toFactor(row: {
  kind: string;
  deviceId: string;
  kdf: string;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  senderPublicKey: string;
  createdAt: Date;
  updatedAt: Date;
}): VaultFactor {
  return {
    v: 1,
    kind: row.kind as VaultFactorKind,
    deviceId: row.deviceId,
    kdf: row.kdf as VaultFactor['kdf'],
    iterations: row.iterations,
    salt: row.salt,
    iv: row.iv,
    ct: row.ciphertext,
    senderPublicKey: row.senderPublicKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The escrow row: the master key sealed with the deployment's settings secret. */
function escrowColumns(masterKey: string) {
  return {
    kind: ESCROW_KIND,
    deviceId: '',
    kdf: 'SETTINGS-SECRET',
    iterations: 0,
    salt: '',
    iv: '',
    ciphertext: sealSecret(masterKey),
    senderPublicKey: '',
  };
}

/**
 * Refuses a master key that does not open the keyring.
 *
 * The keyring is AES-256-GCM under the raw master key, with WebCrypto's layout:
 * the 16-byte tag at the end of the ciphertext. Exported for the check file.
 */
export function assertOpensKeyring(masterKey: string, iv: string, ciphertext: string): void {
  if (!opensKeyring(masterKey, iv, ciphertext)) {
    throw new BadRequestException({
      code: 'WRONG_MASTER_KEY',
      message: 'That key does not open this account\'s keyring',
    });
  }
}

export function opensKeyring(masterKey: string, iv: string, ciphertext: string): boolean {
  const key = Buffer.from(masterKey, 'base64');
  const sealed = Buffer.from(ciphertext, 'base64');
  if (key.length !== 32 || sealed.length <= 16) return false;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(sealed.subarray(sealed.length - 16));
    decipher.update(sealed.subarray(0, sealed.length - 16));
    decipher.final();
    return true;
  } catch {
    return false;
  }
}
