import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@nexora/database';
import { EVENTS, EventBus } from '@nexora/events';
import type {
  Channel,
  CreateChannelRequest,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceWithRole,
} from '@nexora/shared-types';
import { PERMISSIONS, hasPermission, type Permission } from '@nexora/permissions';

@Injectable()
export class WorkspacesService {
  constructor(private readonly events: EventBus) {}

  async listForUser(userId: string): Promise<WorkspaceWithRole[]> {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((membership) => ({
      ...toWorkspace(membership.workspace),
      role: membership.role as WorkspaceRole,
    }));
  }

  async create(userId: string, name: string): Promise<WorkspaceWithRole> {
    const slug = await this.uniqueSlug(name);

    const workspace = await prisma.workspace.create({
      data: {
        name: name.trim(),
        slug,
        ownerId: userId,
        members: { create: { userId, role: 'OWNER' } },
        channels: { create: { name: 'general', type: 'TEXT' } },
      },
    });

    await this.events.publish(EVENTS.WORKSPACE_CREATED, {
      workspaceId: workspace.id,
      ownerId: userId,
    });

    return { ...toWorkspace(workspace), role: 'OWNER' };
  }

  async members(userId: string, workspaceId: string): Promise<WorkspaceMember[]> {
    await this.requireMembership(userId, workspaceId);

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((member) => ({
      id: member.id,
      userId: member.userId,
      username: member.user.username,
      displayName: member.user.displayName,
      avatarUrl: member.user.avatarUrl,
      role: member.role as WorkspaceRole,
      joinedAt: member.joinedAt.toISOString(),
    }));
  }

  /** Joins by slug. Invitations with codes and expiry come later (see TODO.md). */
  async joinBySlug(userId: string, slug: string): Promise<WorkspaceWithRole> {
    const workspace = await prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) {
      throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' });
    }

    const membership = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      update: {},
      create: { workspaceId: workspace.id, userId, role: 'MEMBER' },
    });

    await this.events.publish(EVENTS.WORKSPACE_MEMBER_ADDED, {
      workspaceId: workspace.id,
      userId,
    });

    return { ...toWorkspace(workspace), role: membership.role as WorkspaceRole };
  }

  async listChannels(userId: string, workspaceId: string): Promise<Channel[]> {
    await this.requireMembership(userId, workspaceId);

    const channels = await prisma.channel.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return channels.map(toChannel);
  }

  async createChannel(userId: string, dto: CreateChannelRequest): Promise<Channel> {
    await this.requirePermission(userId, dto.workspaceId, PERMISSIONS.MANAGE_CHANNEL);

    const channel = await prisma.channel.create({
      data: {
        workspaceId: dto.workspaceId,
        name: normalizeChannelName(dto.name),
        type: dto.type ?? 'TEXT',
      },
    });

    await this.events.publish(EVENTS.CHANNEL_CREATED, {
      channelId: channel.id,
      workspaceId: channel.workspaceId,
    });

    return toChannel(channel);
  }

  /**
   * Membership check every read path goes through. Authorization lives here,
   * never in the client.
   */
  private async requireMembership(userId: string, workspaceId: string): Promise<WorkspaceRole> {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) {
      // 404 rather than 403: a non-member should not learn the workspace exists.
      throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' });
    }
    return membership.role as WorkspaceRole;
  }

  private async requirePermission(
    userId: string,
    workspaceId: string,
    permission: Permission,
  ): Promise<void> {
    const role = await this.requireMembership(userId, workspaceId);
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
        .slice(0, 40) || 'workspace';

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const taken = await prisma.workspace.findUnique({ where: { slug: candidate } });
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

function toWorkspace(row: {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: Date;
}): Workspace {
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
  workspaceId: string;
  name: string;
  type: string;
  topic: string | null;
  createdAt: Date;
}): Channel {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    type: row.type === 'VOICE' ? 'VOICE' : 'TEXT',
    topic: row.topic,
    createdAt: row.createdAt.toISOString(),
  };
}
