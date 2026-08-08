import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@nexora/database';
import { EVENTS, EventBus } from '@nexora/events';
import type {
  Channel,
  CreateChannelRequest,
  Server,
  ServerMember,
  ServerRole,
  ServerWithRole,
} from '@nexora/shared-types';
import { PERMISSIONS, hasPermission, type Permission } from '@nexora/permissions';

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
        channels: { create: { name: 'general', type: 'TEXT' } },
      },
    });

    await this.events.publish(EVENTS.SERVER_CREATED, {
      serverId: server.id,
      ownerId: userId,
    });

    return { ...toServer(server), role: 'OWNER' };
  }

  async members(userId: string, serverId: string): Promise<ServerMember[]> {
    await this.requireMembership(userId, serverId);

    const members = await prisma.serverMember.findMany({
      where: { serverId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((member) => ({
      id: member.id,
      userId: member.userId,
      username: member.user.username,
      displayName: member.user.displayName,
      avatarUrl: member.user.avatarUrl,
      role: member.role as ServerRole,
      joinedAt: member.joinedAt.toISOString(),
    }));
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

    return { ...toServer(server), role: membership.role as ServerRole };
  }

  async listChannels(userId: string, serverId: string): Promise<Channel[]> {
    await this.requireMembership(userId, serverId);

    const channels = await prisma.channel.findMany({
      where: { serverId },
      orderBy: { createdAt: 'asc' },
    });
    return channels.map(toChannel);
  }

  async createChannel(userId: string, dto: CreateChannelRequest): Promise<Channel> {
    await this.requirePermission(userId, dto.serverId, PERMISSIONS.MANAGE_CHANNEL);

    const channel = await prisma.channel.create({
      data: {
        serverId: dto.serverId,
        name: normalizeChannelName(dto.name),
        type: dto.type ?? 'TEXT',
      },
    });

    await this.events.publish(EVENTS.CHANNEL_CREATED, {
      channelId: channel.id,
      serverId: channel.serverId,
    });

    return toChannel(channel);
  }

  /**
   * Membership check every read path goes through. Authorization lives here,
   * never in the client.
   */
  private async requireMembership(userId: string, serverId: string): Promise<ServerRole> {
    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
    });
    if (!membership) {
      // 404 rather than 403: a non-member should not learn the server exists.
      throw new NotFoundException({ code: 'SERVER_NOT_FOUND', message: 'Server not found' });
    }
    return membership.role as ServerRole;
  }

  private async requirePermission(
    userId: string,
    serverId: string,
    permission: Permission,
  ): Promise<void> {
    const role = await this.requireMembership(userId, serverId);
    if (!hasPermission(role, permission)) {
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
  serverId: string;
  name: string;
  type: string;
  topic: string | null;
  createdAt: Date;
}): Channel {
  return {
    id: row.id,
    serverId: row.serverId,
    name: row.name,
    type: row.type === 'VOICE' ? 'VOICE' : 'TEXT',
    topic: row.topic,
    createdAt: row.createdAt.toISOString(),
  };
}
