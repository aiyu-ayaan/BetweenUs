import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type {
  AccountKeyRecipient,
  AccountVaultResponse,
  BackupSecretKind,
  ChannelKeysResponse,
  DeviceKey,
  IdentityBackupResponse,
  KeyHealthResponse,
  VaultFactor,
  VaultFactorKind,
  VaultGrantsResponse,
} from '@betweenus/shared-types';
import { E2eeService } from './e2ee.service';
import { VaultService } from './vault.service';
import {
  CreateVaultDto,
  PublishChannelKeysDto,
  PutIdentityBackupDto,
  PutVaultFactorDto,
  RegisterDeviceKeyDto,
  RequestVaultGrantDto,
  RotateVaultDto,
} from './dto';

/** The kinds a route may be handed, so a path parameter cannot invent one. */
const FACTOR_KINDS: readonly VaultFactorKind[] = ['password', 'passphrase', 'recovery-code', 'device'];

@Controller('e2ee')
@UseGuards(JwtAuthGuard)
export class E2eeController {
  constructor(
    private readonly e2ee: E2eeService,
    private readonly vaults: VaultService,
  ) {}

  // --- The account vault ------------------------------------------------------

  /**
   * The caller's sealed identity keyring, or an explicit null.
   *
   * The null matters more than anything else on this controller: a client that
   * reads a *failed* request as "this account has no vault" mints a second
   * identity over a standing one and orphans every channel key wrapped for the
   * first. There is no undo. See the note on `VaultService.vault`.
   */
  @Get('vault')
  vault(@CurrentUser() user: AuthenticatedUser): Promise<AccountVaultResponse> {
    return this.vaults.vault(user.id);
  }

  /** Creates the vault. Refused when one already stands, never replaced. */
  @Post('vault')
  createVault(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVaultDto,
  ): Promise<AccountVaultResponse> {
    return this.vaults.createVault(user.id, dto);
  }

  /** Appends an identity generation, for a rotation after a machine was lost. */
  @Post('vault/rotate')
  rotateVault(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RotateVaultDto,
  ): Promise<AccountVaultResponse> {
    return this.vaults.rotate(user.id, dto);
  }

  /** Adds or replaces one door into the vault. */
  @Put('vault/factors')
  putFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PutVaultFactorDto,
  ): Promise<{ ok: true }> {
    return this.vaults.putFactor(user.id, dto);
  }

  /**
   * Takes one door away. Refused when it is the last portable one - not as a
   * policy about how secure an account should be, but because the alternative
   * is an account that cannot be recovered and does not know it.
   */
  @Delete('vault/factors/:kind')
  deleteFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind') kind: string,
    @Query('deviceId') deviceId?: string,
  ): Promise<{ ok: true }> {
    if (!FACTOR_KINDS.includes(kind as VaultFactorKind)) {
      throw new BadRequestException({ code: 'INVALID_FACTOR_KIND', message: 'Unknown factor kind' });
    }
    return this.vaults.deleteFactor(user.id, kind as VaultFactorKind, deviceId ?? '');
  }

  /** A machine with no portable secret asking to be let in. */
  @Post('vault/grants')
  requestGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RequestVaultGrantDto,
  ): Promise<{ ok: true }> {
    return this.vaults.requestGrant(user.id, dto.deviceId, dto.publicKey, dto.label ?? null, dto.fingerprint);
  }

  /** Machines of this account waiting to be approved. Never anybody else's. */
  @Get('vault/grants')
  grants(@CurrentUser() user: AuthenticatedUser): Promise<VaultGrantsResponse> {
    return this.vaults.pendingGrants(user.id);
  }

  /**
   * Whether this machine has been let in - the one question a locked screen
   * polls. Answered from the factor rather than the request row, because the
   * factor is the thing that actually opens the vault.
   */
  @Get('vault/grants/:deviceId')
  async grant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
  ): Promise<{ factor: VaultFactor | null }> {
    return { factor: await this.vaults.grantFor(user.id, deviceId) };
  }

  @Delete('vault/grants/:deviceId')
  denyGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
  ): Promise<{ ok: true }> {
    return this.vaults.denyGrant(user.id, deviceId);
  }

  /**
   * How much of this account's history would survive losing every machine.
   *
   * The number v1 made unaskable. A client that finds `sealed` above zero has
   * epochs to promote rather than a warning to draw.
   */
  @Get('health')
  health(@CurrentUser() user: AuthenticatedUser): Promise<KeyHealthResponse> {
    return this.e2ee.keyHealth(user.id);
  }

  @Post('devices')
  registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceKeyDto,
  ): Promise<DeviceKey> {
    return this.e2ee.registerDevice(user.id, dto.deviceId, dto.publicKey, dto.label, dto.holdsVault);
  }

  /**
   * This account's own machines. Separate from `GET devices?channelId=`, which
   * answers "whose keys do I wrap for" - this one answers "what is signed in as
   * me", which is a question only the owner gets to ask.
   */
  @Get('devices/mine')
  myDevices(@CurrentUser() user: AuthenticatedUser): Promise<DeviceKey[]> {
    return this.e2ee.myDevices(user.id);
  }

  /** Stops a machine being wrapped for, and deletes what it was already given. */
  @Delete('devices/:deviceId')
  revokeDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
  ): Promise<DeviceKey> {
    return this.e2ee.revokeDevice(user.id, deviceId);
  }

  /**
   * The caller's sealed identity keys, for a machine that has none of its own.
   *
   * Plural: an account may hold a password-sealed blob and a passphrase-sealed
   * one, and a client opens whichever its secret matches.
   */
  @Get('backup')
  backup(@CurrentUser() user: AuthenticatedUser): Promise<IdentityBackupResponse> {
    return this.e2ee.identityBackup(user.id);
  }

  @Put('backup')
  async putBackup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PutIdentityBackupDto,
  ): Promise<{ ok: true }> {
    await this.e2ee.putIdentityBackup(user.id, dto);
    return { ok: true };
  }

  /**
   * Removes one kind of backup. What "do not let my account password recover my
   * messages" is made of, once a recovery passphrase is standing.
   */
  @Delete('backup/:kind')
  async deleteBackup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kind') kind: string,
  ): Promise<{ ok: true }> {
    if (kind !== 'password' && kind !== 'passphrase') {
      throw new BadRequestException({ code: 'INVALID_BACKUP_KIND', message: 'Unknown backup kind' });
    }
    await this.e2ee.deleteIdentityBackup(user.id, kind satisfies BackupSecretKind);
    return { ok: true };
  }

  /**
   * Member devices for a channel.
   *
   * @deprecated Channel keys are wrapped for accounts now - see
   * `GET recipients`. This stays because a status still needs the directory
   * while the old clients are around, and because a fingerprint dialog is
   * about a machine rather than an account.
   */
  @Get('devices')
  devices(
    @CurrentUser() user: AuthenticatedUser,
    @Query('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<DeviceKey[]> {
    return this.e2ee.devicesForChannel(user.id, channelId);
  }

  /**
   * Who a channel key must be wrapped for: one entry per member account.
   *
   * One per account, where the route above sends one per machine. That is the
   * whole of what stopped conversations disappearing - a list of machines
   * grows after the key was minted, and a list of accounts does not.
   */
  @Get('recipients')
  recipients(
    @CurrentUser() user: AuthenticatedUser,
    @Query('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<AccountKeyRecipient[]> {
    return this.e2ee.recipientsForChannel(user.id, channelId);
  }

  /**
   * Channels this account holds any wrap for, so a client that has just
   * unlocked the vault can sweep them all and promote what only it can open.
   */
  @Get('channels')
  channels(@CurrentUser() user: AuthenticatedUser): Promise<string[]> {
    return this.e2ee.channelsWithKeys(user.id);
  }

  @Get('keys/:channelId')
  keys(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelKeysResponse> {
    return this.e2ee.keysForUser(user.id, channelId);
  }

  @Post('keys')
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PublishChannelKeysDto,
  ): Promise<{ epoch: number; stored: number }> {
    return this.e2ee.publishKeys(user.id, dto);
  }
}
