import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type {
  ClearChatsResponse,
  LinkPreview,
  Message,
  Paginated,
} from '@betweenus/shared-types';
import { MessagesService } from './messages.service';
import { UnfurlService } from './unfurl.service';
import {
  ClearChatsDto,
  CreateMessageDto,
  MessageQueryDto,
  PinQueryDto,
  ReactToMessageDto,
  UpdateMessageDto,
} from './dto';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly unfurlService: UnfurlService,
  ) {}

  @Get()
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MessageQueryDto,
  ): Promise<Paginated<Message>> {
    return this.messages.history(user.id, query.channelId, query.before);
  }

  // Ahead of `:messageId` routes, or `unfurl` is read as a message id.
  @Get('unfurl')
  unfurl(@Query('url') targetUrl?: string): Promise<LinkPreview | null> {
    if (!targetUrl) return Promise.resolve(null);
    return this.unfurlService.unfurl(targetUrl);
  }

  // Ahead of `:messageId` routes, or `pins` is read as a message id.
  @Get('pins')
  pins(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PinQueryDto,
  ): Promise<Message[]> {
    return this.messages.pins(user.id, query.channelId);
  }

  /**
   * Hides this account's own history: one conversation when `channelId` is
   * given, every one of them when it is not. Ahead of `:messageId`, or `clear`
   * is read as a message id.
   */
  @Post('clear')
  @HttpCode(200)
  clear(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClearChatsDto,
  ): Promise<ClearChatsResponse> {
    return this.messages.clearChats(user.id, dto.channelId);
  }

  @Post()
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMessageDto): Promise<Message> {
    return this.messages.send(
      user.id,
      dto.channelId,
      dto.content,
      dto.attachmentKeys,
      dto.viewOnce,
    );
  }

  @Patch(':messageId')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UpdateMessageDto,
  ): Promise<Message> {
    return this.messages.edit(user.id, messageId, dto.content);
  }

  @Delete(':messageId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.messages.remove(user.id, messageId);
  }

  /**
   * Spends a one-time message: the caller has opened its media, so it goes.
   *
   * A POST rather than the DELETE it resembles, because the caller is usually
   * not allowed to delete this message and is not claiming to be - they are
   * reporting that they looked at it, and the destruction is the server's
   * consequence rather than their request. 204 either way: a message already
   * burned by somebody else is not an error to whoever arrived second.
   */
  @Post(':messageId/burn')
  @HttpCode(204)
  burn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.messages.burn(user.id, messageId);
  }

  @Put(':messageId/pin')
  pin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<Message> {
    return this.messages.setPinned(user.id, messageId, true);
  }

  @Delete(':messageId/pin')
  unpin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<Message> {
    return this.messages.setPinned(user.id, messageId, false);
  }

  /** One route for both directions: reacting with what you already chose undoes it. */
  @Post(':messageId/reactions')
  react(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ReactToMessageDto,
  ): Promise<Message> {
    return this.messages.react(user.id, messageId, dto.emoji);
  }
}
