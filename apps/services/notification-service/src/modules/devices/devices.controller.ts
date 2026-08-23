import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type { PushKeyResponse, RegisteredDevice } from '@betweenus/shared-types';
import { vapidPublicKey } from '../../push/webpush';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto';

@Controller('notifications/devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /**
   * The application server key a browser needs before it can subscribe.
   *
   * Null when this deployment has no VAPID keys, which the client reads as
   * "this deployment does not do web push" and stops - rather than calling
   * `subscribe` with nothing and failing in a way that looks like a bug.
   *
   * The public half only. It is meant to be handed out: a subscription is
   * bound to it, which is what stops anybody else pushing to that browser.
   */
  @Get('key')
  key(): PushKeyResponse {
    return { vapidPublicKey: vapidPublicKey() };
  }

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
