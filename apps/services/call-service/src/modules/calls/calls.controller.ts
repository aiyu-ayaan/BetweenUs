import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { CallTokenResponse } from '@nexora/shared-types';
import { CallsService } from './calls.service';
import { CallTokenDto } from './dto';

@Controller('calls')
@UseGuards(JwtAuthGuard)
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post('token')
  token(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CallTokenDto,
    // The address this client reached the deployment on, so the reply can refuse
    // to send it somewhere it cannot go. Nginx forwards the original Host.
    @Headers('host') host?: string,
  ): Promise<CallTokenResponse> {
    return this.calls.token(user, dto.channelId, host);
  }
}
