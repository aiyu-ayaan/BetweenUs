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
  Channel,
  ChannelMember,
  InvitePreview,
  ServerCustomRole,
  ServerEmoji,
  ServerInvite,
  ServerMember,
  ServerWithRole,
} from '@betweenus/shared-types';
import { ServersService } from './servers.service';
import {
  AddServerMemberDto,
  CreateChannelDto,
  CreateServerDto,
  CreateServerEmojiDto,
  CreateServerInviteDto,
  CreateServerRoleDto,
  JoinServerDto,
  SetChannelMembersDto,
  UpdateChannelDto,
  UpdateServerDto,
  UpdateServerMemberDto,
  UpdateServerRoleDto,
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
    return this.servers.joinByInvite(user.id, dto.code);
  }

  /**
   * What an invite leads to, without taking it. Any signed-in account may ask
   * with a code in hand, which is the whole point: the person deciding whether
   * to join is by definition not a member yet.
   *
   * Above the `:serverId` routes on purpose - `invites` is not a UUID, and this
   * has to be matched before anything tries to parse it as one.
   */
  @Get('invites/:code')
  invitePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('code') code: string,
  ): Promise<InvitePreview> {
    return this.servers.invitePreview(user.id, code);
  }

  @Get(':serverId/invites')
  invites(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<ServerInvite[]> {
    return this.servers.invites(user.id, serverId);
  }

  @Post(':serverId/invites')
  createInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Body() dto: CreateServerInviteDto,
  ): Promise<ServerInvite> {
    return this.servers.createInvite(user.id, serverId, dto);
  }

  /** Revoked, not deleted: the list keeps saying that it existed. */
  @Delete(':serverId/invites/:code')
  revokeInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('code') code: string,
  ): Promise<ServerInvite> {
    return this.servers.revokeInvite(user.id, serverId, code);
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

  @Post(':serverId/members')
  addMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Body() dto: AddServerMemberDto,
  ): Promise<ServerMember> {
    return this.servers.addMember(user.id, serverId, dto.username);
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

  @Get(':serverId/roles')
  roles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<ServerCustomRole[]> {
    return this.servers.roles(user.id, serverId);
  }

  @Post(':serverId/roles')
  createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Body() dto: CreateServerRoleDto,
  ): Promise<ServerCustomRole> {
    return this.servers.createRole(user.id, serverId, dto);
  }

  @Patch(':serverId/roles/:roleId')
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateServerRoleDto,
  ): Promise<ServerCustomRole> {
    return this.servers.updateRole(user.id, serverId, roleId, dto);
  }

  @Delete(':serverId/roles/:roleId')
  @HttpCode(204)
  deleteRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.servers.deleteRole(user.id, serverId, roleId);
  }

  // --- Emoji ------------------------------------------------------------------

  @Get(':serverId/emoji')
  emoji(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<ServerEmoji[]> {
    return this.servers.emoji(user.id, serverId);
  }

  /** The picture goes to `/api/v1/uploads/picture` first; this names it. */
  @Post(':serverId/emoji')
  addEmoji(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Body() dto: CreateServerEmojiDto,
  ): Promise<ServerEmoji> {
    return this.servers.addEmoji(user.id, serverId, dto);
  }

  @Delete(':serverId/emoji/:emojiId')
  @HttpCode(204)
  removeEmoji(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('emojiId', ParseUUIDPipe) emojiId: string,
  ): Promise<void> {
    return this.servers.removeEmoji(user.id, serverId, emojiId);
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
