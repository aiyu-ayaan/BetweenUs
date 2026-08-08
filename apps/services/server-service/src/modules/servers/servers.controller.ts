import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { Channel, ServerMember, ServerWithRole } from '@nexora/shared-types';
import { ServersService } from './servers.service';
import { CreateChannelDto, CreateServerDto, JoinServerDto } from './dto';

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

  @Get(':serverId/members')
  members(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<ServerMember[]> {
    return this.servers.members(user.id, serverId);
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
}
