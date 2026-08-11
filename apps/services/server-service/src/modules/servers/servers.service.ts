import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, resolveChannelAccess } from '@nexora/database';
import { EVENTS, EventBus } from '@nexora/events';
import type {
  Channel,
  ChannelMember as ChannelMemberDto,
  CreateChannelRequest,
  UpdateChannelRequest,
  Server,
  ServerMember,
  ServerRole,
  ServerWithRole,
  UpdateServerMemberRequest,
  UpdateServerRequest,
} from '@nexora/shared-types';
import {
  ASSIGNABLE_PERMISSIONS,
  PERMISSIONS,
  effectivePermissions,
  isPermission,
  type Permission,
} from '@nexora/permissions';

/** Highest first. Nobody may hand out a role at or above their own. */
const ROLE_RANK: Record<ServerRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MODERATOR: 2,
  MEMBER: 1,
  GUEST: 0,
};

interface MembershipRow {
  role: string;
  grantedPermissions: string[];
  deniedPermissions: string[];
}

@Injectable()
export class ServersService {
  constructor(private readonly events: EventBus) {}

  async listForUser(userId: string): Promise<ServerWithRole[]> {
    const memberships = await prisma.serverMember.findMany({
      where: { userId },
      include: { server: true },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((membership) => ({
      ...toServer(membership.server),
      role: membership.role as ServerRole,
      permissions: permissionsOf(membership),
    }));
  }

  async create(userId: string, name: string): Promise<ServerWithRole> {
    const slug = await this.uniqueSlug(name);

    const server = await prisma.server.create({
      data: {
        name: name.trim(),
        slug,
        ownerId: userId,
        members: { create: { userId, role: 'OWNER' } },
        // A server with nowhere to talk is a dead end, so it opens with one of
        // each: #general to type in and General to call in.
        channels: {
          create: [
            { name: 'general', type: 'TEXT' },
            { name: 'General', type: 'VOICE' },
          ],
        },
      },
    });

    await this.events.publish(EVENTS.SERVER_CREATED, {
      serverId: server.id,
      ownerId: userId,
    });

    return {
      ...toServer(server),
      role: 'OWNER',
      permissions: effectivePermissions('OWNER'),
    };
  }

  async members(userId: string, serverId: string): Promise<ServerMember[]> {
    await this.requireMembership(userId, serverId);

    const members = await prisma.serverMember.findMany({
      where: { serverId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map(toMember);
  }

  /**
   * Changes a member's role, their granted permissions, or both.
   *
   * Three rules keep this from being a privilege ladder: the owner cannot be
   * edited by anyone, nobody may hand out a role at or above their own, and
   * nobody may grant a permission they do not hold themselves. Without the last
   * one a moderator with `MANAGE_MEMBER` could grant themselves anything by way
   * of a second account.
   */
  async updateMember(
    actorId: string,
    serverId: string,
    targetUserId: string,
    dto: UpdateServerMemberRequest,
  ): Promise<ServerMember> {
    const actor = await this.requireMembershipRow(actorId, serverId);
    const actorPermissions = permissionsOf(actor);

    const target = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: targetUserId } },
      include: { user: true },
    });
    if (!target) {
      throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'Member not found' });
    }
    if (target.role === 'OWNER') {
      throw new ForbiddenException({
        code: 'CANNOT_EDIT_OWNER',
        message: 'The server owner cannot be edited',
      });
    }
    if (targetUserId === actorId) {
      throw new ForbiddenException({
        code: 'CANNOT_EDIT_SELF',
        message: 'You cannot change your own role or permissions',
      });
    }

    const data: {
      role?: ServerRole;
      grantedPermissions?: string[];
      deniedPermissions?: string[];
    } = {};

    if (dto.role !== undefined) {
      this.require(actorPermissions, PERMISSIONS.MANAGE_ROLE);
      if (dto.role === 'OWNER') {
        throw new ForbiddenException({
          code: 'CANNOT_ASSIGN_OWNER',
          message: 'Ownership is transferred, not assigned',
        });
      }
      if (ROLE_RANK[dto.role] >= ROLE_RANK[actor.role as ServerRole]) {
        throw new ForbiddenException({
          code: 'ROLE_ABOVE_OWN',
          message: 'You cannot assign a role at or above your own',
        });
      }
      data.role = dto.role;
    }

    if (dto.grantedPermissions !== undefined || dto.deniedPermissions !== undefined) {
      this.require(actorPermissions, PERMISSIONS.MANAGE_MEMBER);
    }

    if (dto.grantedPermissions !== undefined) {
      const granted = sanitizeAssignable(dto.grantedPermissions);
      const beyondActor = granted.filter((permission) => !actorPermissions.includes(permission));
      if (beyondActor.length > 0) {
        throw new ForbiddenException({
          code: 'PERMISSION_ABOVE_OWN',
          message: `You do not hold ${beyondActor.join(', ')}`,
        });
      }
      data.grantedPermissions = granted;
    }

    if (dto.deniedPermissions !== undefined) {
      data.deniedPermissions = sanitizeAssignable(dto.deniedPermissions);
    }

    const updated = await prisma.serverMember.update({
      where: { id: target.id },
      data,
      include: { user: true },
    });

    // The member whose permissions these are is usually somebody else, on
    // another machine, holding a server list fetched when they signed in.
    // Without this they keep the permissions they had at that moment - a grant
    // made here would not reach them until they restarted.
    await this.events.publish(EVENTS.SERVER_MEMBER_UPDATED, {
      serverId,
      userId: targetUserId,
    });
    return toMember(updated);
  }

  /**
   * Adds someone by username, from the members screen. They join as a MEMBER
   * whatever the actor's own role is - handing out a role is a separate,
   * `MANAGE_ROLE` decision, and this one only needs `MANAGE_MEMBER`.
   *
   * Someone already in the server is returned as they are rather than refused:
   * the outcome the caller asked for is already true.
   */
  async addMember(actorId: string, serverId: string, username: string): Promise<ServerMember> {
    const actor = await this.requireMembershipRow(actorId, serverId);
    this.require(permissionsOf(actor), PERMISSIONS.MANAGE_MEMBER);

    const user = await prisma.user.findUnique({
      where: { username: username.trim() },
      select: { id: true, disabledAt: true },
    });
    if (!user || user.disabledAt !== null) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No such user' });
    }

    const existing = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: user.id } },
      include: { user: true },
    });
    if (existing) return toMember(existing);

    const member = await prisma.serverMember.create({
      data: { serverId, userId: user.id, role: 'MEMBER' },
      include: { user: true },
    });
    await this.events.publish(EVENTS.SERVER_MEMBER_ADDED, { serverId, userId: user.id });
    return toMember(member);
  }

  /** Removes someone else from the server. Leaving is `leave`, below. */
  async removeMember(actorId: string, serverId: string, targetUserId: string): Promise<void> {
    const actor = await this.requireMembershipRow(actorId, serverId);
    this.require(permissionsOf(actor), PERMISSIONS.MANAGE_MEMBER);

    if (targetUserId === actorId) {
      throw new ForbiddenException({
        code: 'CANNOT_REMOVE_SELF',
        message: 'Leave the server instead',
      });
    }

    const target = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', message: 'Member not found' });
    }
    if (target.role === 'OWNER') {
      throw new ForbiddenException({
        code: 'CANNOT_REMOVE_OWNER',
        message: 'The server owner cannot be removed',
      });
    }
    if (ROLE_RANK[target.role as ServerRole] >= ROLE_RANK[actor.role as ServerRole]) {
      throw new ForbiddenException({
        code: 'ROLE_ABOVE_OWN',
        message: 'You cannot remove a member at or above your own role',
      });
    }

    await prisma.serverMember.delete({ where: { id: target.id } });
    await this.events.publish(EVENTS.SERVER_MEMBER_REMOVED, { serverId, userId: targetUserId });
  }

  /** The owner cannot leave; deleting the server is the way out. */
  async leave(userId: string, serverId: string): Promise<void> {
    const membership = await this.requireMembershipRow(userId, serverId);
    if (membership.role === 'OWNER') {
      throw new ForbiddenException({
        code: 'OWNER_CANNOT_LEAVE',
        message: 'Delete the server instead',
      });
    }

    await prisma.serverMember.delete({
      where: { serverId_userId: { serverId, userId } },
    });
    await this.events.publish(EVENTS.SERVER_MEMBER_REMOVED, { serverId, userId });
  }

  async update(userId: string, serverId: string, dto: UpdateServerRequest): Promise<ServerWithRole> {
    const membership = await this.requireMembershipRow(userId, serverId);
    this.require(permissionsOf(membership), PERMISSIONS.MANAGE_SERVER);

    const server = await prisma.server.update({
      where: { id: serverId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.iconUrl !== undefined ? { iconUrl: dto.iconUrl } : {}),
      },
    });

    return {
      ...toServer(server),
      role: membership.role as ServerRole,
      permissions: permissionsOf(membership),
    };
  }

  /** Only the owner, and it takes the channels and their history with it. */
  async remove(userId: string, serverId: string): Promise<void> {
    const membership = await this.requireMembershipRow(userId, serverId);
    if (membership.role !== 'OWNER') {
      throw new ForbiddenException({
        code: 'NOT_SERVER_OWNER',
        message: 'Only the owner can delete a server',
      });
    }
    await prisma.server.delete({ where: { id: serverId } });
  }

  /** Joins by slug. Invitations with codes and expiry come later (see TODO.md). */
  async joinBySlug(userId: string, slug: string): Promise<ServerWithRole> {
    const server = await prisma.server.findUnique({ where: { slug } });
    if (!server) {
      throw new NotFoundException({ code: 'SERVER_NOT_FOUND', message: 'Server not found' });
    }

    const membership = await prisma.serverMember.upsert({
      where: { serverId_userId: { serverId: server.id, userId } },
      update: {},
      create: { serverId: server.id, userId, role: 'MEMBER' },
    });

    await this.events.publish(EVENTS.SERVER_MEMBER_ADDED, {
      serverId: server.id,
      userId,
    });

    return {
      ...toServer(server),
      role: membership.role as ServerRole,
      permissions: permissionsOf(membership),
    };
  }

  /** Public channels, plus the private ones this user is named on. */
  async listChannels(userId: string, serverId: string): Promise<Channel[]> {
    await this.requireMembership(userId, serverId);

    const channels = await prisma.channel.findMany({
      where: {
        serverId,
        OR: [{ isPrivate: false }, { members: { some: { userId } } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return channels.map(toChannel);
  }

  /**
   * A private channel is created with its allowlist, because the moment between
   * "channel exists" and "allowlist applied" is a moment when everyone can read
   * it. The creator is always on the list - otherwise they cannot open what they
   * just made.
   */
  async createChannel(userId: string, dto: CreateChannelRequest): Promise<Channel> {
    await this.requirePermission(userId, dto.serverId, PERMISSIONS.MANAGE_CHANNEL);

    const isPrivate = dto.isPrivate === true;
    const seats = isPrivate
      ? await this.serverMemberIds(dto.serverId, [...(dto.memberIds ?? []), userId])
      : [];

    const channel = await prisma.channel.create({
      data: {
        serverId: dto.serverId,
        name: normalizeChannelName(dto.name),
        type: dto.type ?? 'TEXT',
        isPrivate,
        members: { create: seats.map((memberId) => ({ userId: memberId })) },
      },
    });

    await this.events.publish(EVENTS.CHANNEL_CREATED, {
      channelId: channel.id,
      serverId: dto.serverId,
    });

    return toChannel(channel);
  }

  async updateChannel(
    userId: string,
    channelId: string,
    dto: UpdateChannelRequest,
  ): Promise<Channel> {
    const channel = await this.requireChannelManagement(userId, channelId);

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        ...(dto.name !== undefined ? { name: normalizeChannelName(dto.name) } : {}),
        ...(dto.topic !== undefined ? { topic: dto.topic } : {}),
      },
    });
    return toChannel(updated);
  }

  async deleteChannel(userId: string, channelId: string): Promise<void> {
    const channel = await this.requireChannelManagement(userId, channelId);
    await prisma.channel.delete({ where: { id: channel.id } });
    await this.events.publish(EVENTS.CHANNEL_DELETED, {
      channelId: channel.id,
      serverId: channel.serverId,
    });
  }

  async channelMembers(userId: string, channelId: string): Promise<ChannelMemberDto[]> {
    const access = await resolveChannelAccess(userId, channelId);
    if (!access) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    const seats = await prisma.channelMember.findMany({
      where: { channelId },
      include: { user: true },
      orderBy: { addedAt: 'asc' },
    });

    return seats.map((seat) => ({
      userId: seat.userId,
      username: seat.user.username,
      displayName: seat.user.displayName,
      avatarUrl: seat.user.avatarUrl,
      addedAt: seat.addedAt.toISOString(),
    }));
  }

  /**
   * Replaces the allowlist. Removing someone leaves the messages they already
   * hold a key for readable to them - rotating the channel key on removal is
   * still open (development/TODO.md), and pretending otherwise would be worse
   * than saying so.
   */
  async setChannelMembers(
    userId: string,
    channelId: string,
    userIds: string[],
  ): Promise<ChannelMemberDto[]> {
    const channel = await this.requireChannelManagement(userId, channelId);
    if (!channel.isPrivate) {
      throw new ForbiddenException({
        code: 'CHANNEL_NOT_PRIVATE',
        message: 'A public channel has no allowlist',
      });
    }

    const seats = await this.serverMemberIds(channel.serverId, [...userIds, userId]);

    await prisma.$transaction([
      prisma.channelMember.deleteMany({ where: { channelId, userId: { notIn: seats } } }),
      prisma.channelMember.createMany({
        data: seats.map((memberId) => ({ channelId, userId: memberId })),
        skipDuplicates: true,
      }),
    ]);

    return this.channelMembers(userId, channelId);
  }

  /** Channel management needs the permission *and* access to the channel. */
  private async requireChannelManagement(
    userId: string,
    channelId: string,
  ): Promise<{ id: string; serverId: string; isPrivate: boolean }> {
    const access = await resolveChannelAccess(userId, channelId);
    // A direct message has no server and nothing to manage, so it is not found
    // here either - the same answer a stranger gets.
    if (!access || access.serverId === null) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }
    this.require(access.permissions, PERMISSIONS.MANAGE_CHANNEL);
    return { id: access.channelId, serverId: access.serverId, isPrivate: access.isPrivate };
  }

  /** Keeps the allowlist to real members of the server, de-duplicated. */
  private async serverMemberIds(serverId: string, candidates: string[]): Promise<string[]> {
    const wanted = [...new Set(candidates)];
    if (wanted.length === 0) return [];

    const members = await prisma.serverMember.findMany({
      where: { serverId, userId: { in: wanted } },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  /**
   * Membership check every read path goes through. Authorization lives here,
   * never in the client.
   */
  private async requireMembership(userId: string, serverId: string): Promise<ServerRole> {
    return (await this.requireMembershipRow(userId, serverId)).role as ServerRole;
  }

  private async requireMembershipRow(userId: string, serverId: string): Promise<MembershipRow> {
    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      select: { role: true, grantedPermissions: true, deniedPermissions: true },
    });
    if (!membership) {
      // 404 rather than 403: a non-member should not learn the server exists.
      throw new NotFoundException({ code: 'SERVER_NOT_FOUND', message: 'Server not found' });
    }
    return membership;
  }

  private async requirePermission(
    userId: string,
    serverId: string,
    permission: Permission,
  ): Promise<void> {
    this.require(permissionsOf(await this.requireMembershipRow(userId, serverId)), permission);
  }

  private require(held: Permission[], permission: Permission): void {
    if (!held.includes(permission)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: `Missing permission ${permission}`,
      });
    }
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'server';

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await prisma.server.findUnique({ where: { slug: candidate } });
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}

function permissionsOf(membership: MembershipRow): Permission[] {
  return effectivePermissions(
    membership.role as ServerRole,
    membership.grantedPermissions,
    membership.deniedPermissions,
  );
}

/**
 * Drops anything that is not a permission this build knows, and anything that
 * is not an administrator's to hand out - `MANAGE_SERVER` comes with ownership
 * and the remote-access permissions are granted per machine, not per server.
 */
function sanitizeAssignable(values: string[]): Permission[] {
  const unique = new Set(values.filter(isPermission));
  return ASSIGNABLE_PERMISSIONS.filter((permission) => unique.has(permission));
}

function toMember(row: {
  id: string;
  userId: string;
  role: string;
  grantedPermissions: string[];
  deniedPermissions: string[];
  joinedAt: Date;
  user: { username: string; displayName: string; avatarUrl: string | null };
}): ServerMember {
  return {
    id: row.id,
    userId: row.userId,
    username: row.user.username,
    displayName: row.user.displayName,
    avatarUrl: row.user.avatarUrl,
    role: row.role as ServerRole,
    permissions: permissionsOf(row),
    grantedPermissions: row.grantedPermissions,
    deniedPermissions: row.deniedPermissions,
    joinedAt: row.joinedAt.toISOString(),
  };
}

/** Channel names follow the Discord convention: lowercase, dashes, no spaces. */
export function normalizeChannelName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'channel'
  );
}

function toServer(row: {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: Date;
}): Server {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    iconUrl: row.iconUrl,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toChannel(row: {
  id: string;
  serverId: string | null;
  name: string;
  type: string;
  topic: string | null;
  isPrivate: boolean;
  createdAt: Date;
}): Channel {
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    type: row.type === 'VOICE' ? 'VOICE' : row.type === 'DM' ? 'DM' : 'TEXT',
    topic: row.topic,
    isPrivate: row.isPrivate,
    createdAt: row.createdAt.toISOString(),
  };
}
