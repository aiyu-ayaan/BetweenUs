import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type {
  ChannelKeysResponse,
  DeviceKey,
  IdentityBackupResponse,
} from '@nexora/shared-types';
import { E2eeService } from './e2ee.service';
import { PublishChannelKeysDto, PutIdentityBackupDto, RegisterDeviceKeyDto } from './dto';

@Controller('e2ee')
@UseGuards(JwtAuthGuard)
export class E2eeController {
  constructor(private readonly e2ee: E2eeService) {}

  @Post('devices')
  registerDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceKeyDto,
  ): Promise<DeviceKey> {
    return this.e2ee.registerDevice(user.id, dto.publicKey);
  }

  /** The caller's sealed identity key, for a machine that has none of its own. */
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

  @Get('devices')
  devices(
    @CurrentUser() user: AuthenticatedUser,
    @Query('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<DeviceKey[]> {
    return this.e2ee.devicesForChannel(user.id, channelId);
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
