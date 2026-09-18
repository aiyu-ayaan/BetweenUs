/**
 * The append-only trail for a server's own moderation actions - a role
 * change, a removal, a role created or edited or deleted, the server's own
 * settings. Same shape and same rule as `recordRemoteAudit`: a failed write
 * here must never take the mutation it is recording down with it.
 */
import { prisma } from './client';

export async function recordServerAudit(entry: {
  serverId: string;
  action: string;
  actorId?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.serverAudit.create({
      data: {
        serverId: entry.serverId,
        action: entry.action,
        actorId: entry.actorId ?? null,
        targetId: entry.targetId ?? null,
        targetLabel: entry.targetLabel ?? null,
        detail: (entry.detail ?? undefined) as never,
      },
    });
  } catch {
    // An audit row that could not be written must not take a moderation
    // action down with it; the service's own log still has the line.
  }
}
