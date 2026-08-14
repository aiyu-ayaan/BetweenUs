import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { CallIceResponse } from '@nexora/shared-types';
import { CallsService } from './calls.service';
import { CallIceDto } from './dto';

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
}
