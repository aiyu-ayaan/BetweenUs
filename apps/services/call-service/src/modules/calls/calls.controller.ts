import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type { CallAnalytics, CallHistoryEntry, CallIceResponse } from '@betweenus/shared-types';
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
  /**
   * This account's own call log. Whose is never a parameter: the only thing
   * that could be wrong about a private history is reading somebody else's.
   */
  @Get('history')
  history(@CurrentUser() user: AuthenticatedUser): Promise<CallHistoryEntry[]> {
    return this.calls.history(user.id);
  }

  /**
   * The same rows added up, for the page the log hangs under.
   *
   * `days` is a hint and not a promise: the service clamps it, because a client
   * asking for a hundred thousand days is a client asking for every row it has
   * ever written.
   */
  @Get('analytics')
  analytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query('days') days?: string,
  ): Promise<CallAnalytics> {
    return this.calls.analytics(user.id, Number(days));
  }

  @Post('ring')
  @HttpCode(204)
  ring(@CurrentUser() user: AuthenticatedUser, @Body() dto: CallRingDto): Promise<void> {
    return this.calls.ring(user.id, dto.channelId, dto.userId);
  }
}
