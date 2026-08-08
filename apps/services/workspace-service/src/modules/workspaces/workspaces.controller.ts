import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard, type AuthenticatedUser } from '@nexora/auth';
import type { Channel, WorkspaceMember, WorkspaceWithRole } from '@nexora/shared-types';
import { WorkspacesService } from './workspaces.service';
import { CreateChannelDto, CreateWorkspaceDto, JoinWorkspaceDto } from './dto';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<WorkspaceWithRole[]> {
    return this.workspaces.listForUser(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkspaceDto,
  ): Promise<WorkspaceWithRole> {
    return this.workspaces.create(user.id, dto.name);
  }

  @Post('join')
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: JoinWorkspaceDto,
  ): Promise<WorkspaceWithRole> {
    return this.workspaces.joinBySlug(user.id, dto.slug);
  }

  @Get(':workspaceId/members')
  members(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<WorkspaceMember[]> {
    return this.workspaces.members(user.id, workspaceId);
  }

  @Get(':workspaceId/channels')
  channels(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<Channel[]> {
    return this.workspaces.listChannels(user.id, workspaceId);
  }
}

@Controller('channels')
@UseGuards(JwtAuthGuard)
export class ChannelsController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<Channel[]> {
    return this.workspaces.listChannels(user.id, workspaceId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChannelDto,
  ): Promise<Channel> {
    return this.workspaces.createChannel(user.id, dto);
  }
}
