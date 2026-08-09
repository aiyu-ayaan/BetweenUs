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
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { Message, Paginated } from '@nexora/shared-types';
import { MessagesService } from './messages.service';
import {
  CreateMessageDto,
  MessageQueryDto,
  PinQueryDto,
  ReactToMessageDto,
  UpdateMessageDto,
} from './dto';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MessageQueryDto,
  ): Promise<Paginated<Message>> {
    return this.messages.history(user.id, query.channelId, query.before);
  }

  // Ahead of `:messageId` routes, or `pins` is read as a message id.
  @Get('pins')
  pins(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PinQueryDto,
  ): Promise<Message[]> {
    return this.messages.pins(user.id, query.channelId);
  }

  @Post()
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMessageDto): Promise<Message> {
    return this.messages.send(user.id, dto.channelId, dto.content);
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
