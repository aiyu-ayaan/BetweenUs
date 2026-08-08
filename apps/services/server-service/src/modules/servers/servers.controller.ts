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
import type {
  Channel,
  ChannelMember,
  ServerMember,
  ServerWithRole,
} from '@nexora/shared-types';
import { ServersService } from './servers.service';
import {
  CreateChannelDto,
  CreateServerDto,
  JoinServerDto,
  SetChannelMembersDto,
  UpdateChannelDto,
  UpdateServerDto,
  UpdateServerMemberDto,
} from './dto';

@Controller('servers')
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<ServerWithRole[]> {
    return this.servers.listForUser(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateServerDto,
  ): Promise<ServerWithRole> {
    return this.servers.create(user.id, dto.name);
  }

  @Post('join')
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: JoinServerDto,
  ): Promise<ServerWithRole> {
    return this.servers.joinBySlug(user.id, dto.slug);
  }

  @Patch(':serverId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Body() dto: UpdateServerDto,
  ): Promise<ServerWithRole> {
    return this.servers.update(user.id, serverId, dto);
  }

  @Delete(':serverId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<void> {
    return this.servers.remove(user.id, serverId);
  }

  @Post(':serverId/leave')
  @HttpCode(204)
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<void> {
    return this.servers.leave(user.id, serverId);
  }

  @Get(':serverId/members')
  members(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<ServerMember[]> {
    return this.servers.members(user.id, serverId);
  }

  @Patch(':serverId/members/:userId')
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: UpdateServerMemberDto,
  ): Promise<ServerMember> {
    return this.servers.updateMember(user.id, serverId, targetUserId, dto);
  }

  @Delete(':serverId/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    return this.servers.removeMember(user.id, serverId, targetUserId);
  }

  @Get(':serverId/channels')
  channels(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<Channel[]> {
    return this.servers.listChannels(user.id, serverId);
  }
}

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<Channel[]> {
    return this.servers.listChannels(user.id, serverId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChannelDto,
  ): Promise<Channel> {
    return this.servers.createChannel(user.id, dto);
  }

  @Patch(':channelId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: UpdateChannelDto,
  ): Promise<Channel> {
    return this.servers.updateChannel(user.id, channelId, dto);
  }

  @Delete(':channelId')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<void> {
    return this.servers.deleteChannel(user.id, channelId);
  }

  @Get(':channelId/members')
  members(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelMember[]> {
    return this.servers.channelMembers(user.id, channelId);
  }

  @Put(':channelId/members')
  setMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: SetChannelMembersDto,
  ): Promise<ChannelMember[]> {
    return this.servers.setChannelMembers(user.id, channelId, dto.userIds);
  }
}
