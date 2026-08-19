import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type { RegisteredDevice } from '@betweenus/shared-types';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto';

@Controller('notifications/devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Register on sign-in, and again on every token rotation. Idempotent. */
  @Post()
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<RegisteredDevice> {
    return this.devices.register(user.id, dto);
  }

  /**
   * Sign-out. Called *before* the tokens are discarded, because it needs one -
   * a row left behind pushes this account's messages at whoever holds the phone
   * next.
   */
  @Delete(':deviceId')
  async unregister(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
  ): Promise<{ ok: true }> {
    await this.devices.unregister(user.id, deviceId);
    return { ok: true };
  }
}
