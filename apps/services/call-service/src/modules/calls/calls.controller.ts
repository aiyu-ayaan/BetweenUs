import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type { CallIceResponse } from '@betweenus/shared-types';
import { CallsService } from './calls.service';
import { CallIceDto, CallRingDto } from './dto';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /**
   * No `Host` header is read here, unlike the token endpoint this replaced.
   * That header existed to catch a media-server address the caller could never
   * reach; nothing is advertised to a caller any more, so there is nothing that
   * could be wrong about where they are.
   */
  @Post('ice')
  ice(@CurrentUser() user: AuthenticatedUser, @Body() dto: CallIceDto): Promise<CallIceResponse> {
    return this.calls.ice(user.id, dto.channelId);
  }

  /**
   * "Come into this call."
   *
   * The caller is the authenticated user and never the body: a ring that could
   * name its own sender is a ring that could be sent as somebody else.
   */
  @Post('ring')
  @HttpCode(204)
  ring(@CurrentUser() user: AuthenticatedUser, @Body() dto: CallRingDto): Promise<void> {
    return this.calls.ring(user.id, dto.channelId, dto.userId);
  }
}
