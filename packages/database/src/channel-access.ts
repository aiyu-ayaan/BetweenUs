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
import { effectivePermissions, type Permission } from '@nexora/permissions';
import { prisma } from './client';

export interface ChannelAccess {
  channelId: string;
  serverId: string;
  /** The caller's role in the channel's server. */
  role: ServerRole;
  /** What the caller may actually do here, overrides applied. */
  permissions: Permission[];
}

/**
 * Null means "this channel does not exist as far as this user is concerned" -
 * callers answer 404 for both a missing channel and one they cannot see, so a
 * stranger cannot probe for channel ids.
 */
export async function resolveChannelAccess(
  userId: string,
  channelId: string,
): Promise<ChannelAccess | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, serverId: true },
  });
  if (!channel) return null;

  const membership = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: channel.serverId, userId } },
    select: { role: true, grantedPermissions: true, deniedPermissions: true },
  });
  if (!membership) return null;

  const role = membership.role as ServerRole;
  return {
    channelId: channel.id,
    serverId: channel.serverId,
    role,
    permissions: effectivePermissions(
      role,
      membership.grantedPermissions,
      membership.deniedPermissions,
    ),
  };
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
