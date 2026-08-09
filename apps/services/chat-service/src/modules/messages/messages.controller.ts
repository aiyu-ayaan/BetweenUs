import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { Message, Paginated } from '@nexora/shared-types';
import { MessagesService } from './messages.service';
import { CreateMessageDto, MessageQueryDto } from './dto';

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

  @Post()
  send(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMessageDto): Promise<Message> {
    return this.messages.send(user.id, dto.channelId, dto.content);
  }

  @Delete(':messageId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.messages.remove(user.id, messageId);
  }
}
