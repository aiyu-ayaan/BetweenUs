/**
 * Retention for remote sessions and their audit trail.
 *
 * Both tables only ever grew. A session row is finished the moment it ends and
 * is never read again except through the machine's history; an audit row is the
 * history. Neither is dangerous at the scale one deployment runs at, and both
 * are the sort of thing that is discovered years later as the reason a table
 * has forty million rows in it.
 *
 * The audit trail is the point of the feature, so the default keeps it for a
 * year - long enough to answer "who was on that machine in March" - while
 * finished sessions, which say nothing the audit rows do not, go after thirty
 * days. Both are environment variables because the answer is a policy, not a
 * fact, and some deployments have to keep records for longer than others.
 *
 * ponytail: a timer in the process, not a scheduler. Every replica runs it and
 * they will overlap harmlessly - deleting rows that are already gone deletes
 * nothing. A real job runner is the upgrade if that ever stops being true.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { envNumber } from '@nexora/config';
import { prisma } from '@nexora/database';
import { Logger } from '@nexora/logger';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How often the sweep runs once the service is up. */
const INTERVAL_MS = DAY_MS;

/** Waited out before the first sweep, so a boot is not also a delete storm. */
const FIRST_RUN_DELAY_MS = 60_000;

export interface RetentionPolicy {
  sessionDays: number;
  auditDays: number;
}

export function retentionPolicy(): RetentionPolicy {
  return {
    sessionDays: envNumber('REMOTE_SESSION_RETENTION_DAYS', 30),
    auditDays: envNumber('REMOTE_AUDIT_RETENTION_DAYS', 365),
  };
}

/**
 * Deletes what has aged out. Returns what it removed, for the log line and for
 * anything that wants to assert on it.
 *
 * Sessions are only swept once they have *ended*: a row with no `endedAt` is a
 * session that is either running or was orphaned by a crash, and deleting the
 * second kind would take the audit rows pointing at it with it.
 */
export async function sweepRemoteHistory(
  policy: RetentionPolicy = retentionPolicy(),
  now: Date = new Date(),
): Promise<{ sessions: number; audit: number }> {
  const sessionsBefore = new Date(now.getTime() - policy.sessionDays * DAY_MS);
  const auditBefore = new Date(now.getTime() - policy.auditDays * DAY_MS);

  // Audit first. A session's rows cascade when the session goes, so sweeping
  // the other way round would delete audit rows that are still inside their own
  // retention window - the trail is the record, and it outlives the session.
  const audit = await prisma.remoteAudit.deleteMany({ where: { createdAt: { lt: auditBefore } } });
  const sessions = await prisma.remoteSession.deleteMany({
    where: { endedAt: { not: null, lt: sessionsBefore } },
  });

  return { sessions: sessions.count, audit: audit.count };
}

@Injectable()
export class RetentionSweeper implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(private readonly logger: Logger) {}

  onModuleInit(): void {
    const policy = retentionPolicy();
    this.first = setTimeout(() => {
      void this.run(policy);
      this.timer = setInterval(() => void this.run(policy), INTERVAL_MS);
      this.timer.unref?.();
    }, FIRST_RUN_DELAY_MS);
    this.first.unref?.();
  }

  private async run(policy: RetentionPolicy): Promise<void> {
    try {
      const removed = await sweepRemoteHistory(policy);
      if (removed.sessions === 0 && removed.audit === 0) return;
      this.logger.info('Swept remote history', { ...removed, ...policy });
    } catch (error) {
      // A sweep that cannot run is not an outage. It runs again tomorrow.
      this.logger.warn('Could not sweep remote history', { reason: String(error) });
    }
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
