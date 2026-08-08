import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { ChannelKeysResponse, DeviceKey } from '@nexora/shared-types';
import { E2eeService } from './e2ee.service';
import { PublishChannelKeysDto, RegisterDeviceKeyDto } from './dto';

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
