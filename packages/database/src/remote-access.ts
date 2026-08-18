/**
 * The one place that answers "may this user do this to this machine".
 *
 * Deliberately separate from `resolveChannelAccess`: nothing about a server
 * role, a membership or a channel grants remote access. The only two sources
 * are owning the machine and holding an unexpired grant on it, which is what
 * makes "who can see my desktop" answerable by reading one table.
 */
import { REMOTE_PERMISSIONS, type RemotePermission } from '@betweenus/permissions';
import { prisma } from './client';

export interface RemoteAccess {
  machineId: string;
  ownerId: string;
  isOwner: boolean;
  permissions: RemotePermission[];
  /** When this access lapses. Null for an owner, and for an open-ended grant. */
  expiresAt: Date | null;
}

/** Drops anything an older or newer build wrote that this one does not know. */
export function asRemotePermissions(values: readonly string[]): RemotePermission[] {
  return values.filter((value): value is RemotePermission =>
    (REMOTE_PERMISSIONS as readonly string[]).includes(value),
  );
}

/**
 * Null means "this machine does not exist as far as this user is concerned":
 * callers answer 404 for a machine that is missing and for one the caller has
 * no access to alike, so nobody can probe for machine ids.
 *
 * The owner always holds everything, including `REMOTE_ADMIN`; a grant to the
 * owner would be a second answer to the same question.
 */
export async function resolveRemoteAccess(
  userId: string,
  machineId: string,
  now: Date = new Date(),
): Promise<RemoteAccess | null> {
  const machine = await prisma.remoteMachine.findUnique({
    where: { id: machineId },
    select: { id: true, ownerId: true },
  });
  if (!machine) return null;

  if (machine.ownerId === userId) {
    return {
      machineId: machine.id,
      ownerId: machine.ownerId,
      isOwner: true,
      permissions: [...REMOTE_PERMISSIONS],
      expiresAt: null,
    };
  }

  const grant = await prisma.remoteGrant.findUnique({
    where: { machineId_userId: { machineId, userId } },
    select: { permissions: true, expiresAt: true },
  });
  if (!grant) return null;

  // An expired grant is treated as absent rather than deleted: the row is what
  // an owner looks at to see that access lapsed, and sweeping it would erase
  // that. Temporary access ends by the clock, not by a job running on time.
  if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) return null;

  const permissions = asRemotePermissions(grant.permissions);
  if (permissions.length === 0) return null;

  return {
    machineId: machine.id,
    ownerId: machine.ownerId,
    isOwner: false,
    permissions,
    expiresAt: grant.expiresAt,
  };
}

/** Appends to the audit trail. Never throws into a caller's happy path. */
export async function recordRemoteAudit(entry: {
  machineId: string;
  action: string;
  actorId?: string | null;
  sessionId?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.remoteAudit.create({
      data: {
        machineId: entry.machineId,
        action: entry.action,
        actorId: entry.actorId ?? null,
        sessionId: entry.sessionId ?? null,
        detail: (entry.detail ?? undefined) as never,
      },
    });
  } catch {
    // An audit row that could not be written must not take a session down with
    // it; the gateway's own log still has the line.
  }
}
