import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type {
  ChannelReadReceipt,
  ChannelUnread,
  NotificationPreferences,
} from '@betweenus/shared-types';
import { NotificationsService } from './notifications.service';
import { MarkReadDto, UpdatePreferencesDto } from './dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('preferences')
  preferences(@CurrentUser() user: AuthenticatedUser): Promise<NotificationPreferences> {
    return this.notifications.preferences(user.id);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<NotificationPreferences> {
    return this.notifications.updatePreferences(user.id, dto);
  }

  @Get('unread')
  unread(@CurrentUser() user: AuthenticatedUser): Promise<ChannelUnread[]> {
    return this.notifications.unread(user.id);
  }

  /** Who else has read this channel - the receipts a "seen by" row is drawn from. */
  @Get('channels/:channelId/reads')
  receipts(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId') channelId: string,
  ): Promise<ChannelReadReceipt[]> {
    return this.notifications.receipts(user.id, channelId);
  }

  @Post('read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MarkReadDto,
  ): Promise<ChannelUnread> {
    return this.notifications.markRead(user.id, dto.channelId);
  }
}
