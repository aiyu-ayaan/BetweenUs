/**
 * The one place that answers "may this user do this in this channel".
 *
 * Chat-, call- and presence-service each used to carry their own copy of
 * "look up the channel, look up the membership, check the role", which meant
 * three places to keep in step and three places to forget. They all call this
 * instead. It reads the shared schema directly for the same reason every other
 * service does; when the schema is split this becomes an RPC to server-service
 * with an unchanged signature.
 */
import type { ServerRole } from '@nexora/shared-types';
import { PERMISSIONS, effectivePermissions, type Permission } from '@nexora/permissions';
import { prisma } from './client';

export interface ChannelAccess {
  channelId: string;
  /** Null for a direct message, which belongs to its participants. */
  serverId: string | null;
  isPrivate: boolean;
  /** The caller's role in the channel's server; null in a direct message. */
  role: ServerRole | null;
  /** What the caller may actually do here, overrides applied. */
  permissions: Permission[];
}

/**
 * What the two people in a direct message may do. It is fixed rather than
 * derived: there is no role to derive it from, and a conversation between two
 * people has no administration to speak of.
 */
const DM_PERMISSIONS: Permission[] = [
  PERMISSIONS.VIEW_CHANNEL,
  PERMISSIONS.SEND_MESSAGE,
  PERMISSIONS.START_CALL,
];

/**
 * Null means "this channel does not exist as far as this user is concerned" -
 * callers answer 404 for both a missing channel and one they cannot see, so a
 * stranger cannot probe for channel ids.
 *
 * A private channel is an allowlist and nothing else overrides it: server
 * membership, a role and even ownership grant no access to a channel the user
 * is not named on. The way in is to be added.
 */
export async function resolveChannelAccess(
  userId: string,
  channelId: string,
): Promise<ChannelAccess | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, serverId: true, isPrivate: true },
  });
  if (!channel) return null;

  // A direct message has no server to take a role from; being one of the two
  // people on it is the whole of the authorization.
  if (channel.serverId === null) {
    if (!(await isChannelMember(channelId, userId))) return null;
    return {
      channelId: channel.id,
      serverId: null,
      isPrivate: true,
      role: null,
      permissions: DM_PERMISSIONS,
    };
  }

  const membership = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: channel.serverId, userId } },
    select: { role: true, grantedPermissions: true, deniedPermissions: true },
  });
  if (!membership) return null;

  if (channel.isPrivate && !(await isChannelMember(channelId, userId))) return null;

  const role = membership.role as ServerRole;
  return {
    channelId: channel.id,
    serverId: channel.serverId,
    isPrivate: channel.isPrivate,
    role,
    permissions: effectivePermissions(
      role,
      membership.grantedPermissions,
      membership.deniedPermissions,
    ),
  };
}

export async function isChannelMember(channelId: string, userId: string): Promise<boolean> {
  const seat = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { id: true },
  });
  return seat !== null;
}

/**
 * Who may read a channel: the allowlist when it is private, every server member
 * otherwise. This is the set the end-to-end encryption key is wrapped for, so
 * "who can read this" has exactly one answer.
 */
export async function channelAudience(channelId: string): Promise<string[]> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true, isPrivate: true },
  });
  if (!channel) return [];

  // A direct message and a private channel are the same question: who is on it.
  if (channel.isPrivate || channel.serverId === null) {
    const seats = await prisma.channelMember.findMany({
      where: { channelId },
      select: { userId: true },
    });
    return seats.map((seat) => seat.userId);
  }

  const members = await prisma.serverMember.findMany({
    where: { serverId: channel.serverId },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

/** Convenience for the common "access plus one permission" check. */
export async function channelPermission(
  userId: string,
  channelId: string,
  permission: Permission,
): Promise<{ access: ChannelAccess | null; allowed: boolean }> {
  const access = await resolveChannelAccess(userId, channelId);
  return { access, allowed: access !== null && access.permissions.includes(permission) };
}
