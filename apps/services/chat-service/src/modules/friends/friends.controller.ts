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
import { IsString, IsUUID, Length } from 'class-validator';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@betweenus/auth';
import type {
  DirectChannel,
  Friend,
  OpenDirectChannelRequest,
  SendFriendRequestRequest,
  UserSummary,
} from '@betweenus/shared-types';
import { FriendsService } from './friends.service';

export class SendFriendRequestDto implements SendFriendRequestRequest {
  @IsString()
  @Length(2, 32)
  username!: string;
}

export class OpenDirectChannelDto implements OpenDirectChannelRequest {
  @IsUUID()
  userId!: string;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserSearchController {
  constructor(private readonly friends: FriendsService) {}

  @Get('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') query = '',
    /** `true` narrows the answer to this account's friends - see the service. */
    @Query('friendsOnly') friendsOnly = '',
  ): Promise<UserSummary[]> {
    return this.friends.search(user.id, query, friendsOnly === 'true');
  }
}

@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<Friend[]> {
    return this.friends.list(user.id);
  }

  @Post()
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendFriendRequestDto,
  ): Promise<Friend> {
    return this.friends.request(user.id, dto.username);
  }

  @Post(':userId/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) otherUserId: string,
  ): Promise<Friend> {
    return this.friends.accept(user.id, otherUserId);
  }

  @Delete(':userId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) otherUserId: string,
  ): Promise<void> {
    return this.friends.remove(user.id, otherUserId);
  }
}

@Controller('dm')
@UseGuards(JwtAuthGuard)
export class DirectChannelsController {
  constructor(private readonly friends: FriendsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<DirectChannel[]> {
    return this.friends.directChannels(user.id);
  }

  @Post()
  open(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OpenDirectChannelDto,
  ): Promise<DirectChannel> {
    return this.friends.openDirectChannel(user.id, dto.userId);
  }
}
