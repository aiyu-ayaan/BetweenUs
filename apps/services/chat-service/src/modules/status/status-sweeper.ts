/**
 * Collects statuses whose 24 hours are up.
 *
 * The sweep is housekeeping, not the feature: the read path already filters on
 * `expiresAt`, so a post is invisible the moment it is due whether or not this
 * has run. That is deliberate - a status that outlives its window because a
 * timer was late would be the feature not working, and no interval is short
 * enough to be relied on for correctness.
 *
 * What it actually recovers is disk. The blob goes before the row, the same
 * order as everywhere else: a failure between the two leaves a row pointing at
 * nothing, which the next pass deletes anyway, rather than a blob nothing can
 * ever name.
 *
 * ponytail: a timer in the process, like the sweeps beside it. Two replicas
 * will overlap; deleting an already-deleted row is a no-op and the second pass
 * simply finds nothing.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma } from '@betweenus/database';
import { Logger } from '@betweenus/logger';
import { getStorage } from '@betweenus/storage';

/**
 * How often to look. Five minutes, not the disappearing sweep's one: nothing
 * is waiting on this, because the read path has already stopped serving what
 * it collects.
 */
const INTERVAL_MS = 5 * 60_000;

/** Not at boot: a service starting is the worst moment to add database work. */
const FIRST_RUN_DELAY_MS = 45_000;

/** How many one pass takes, so a backlog is spread rather than dropped at once. */
const BATCH = 200;

/** Destroys what is past its stamp and returns how many went. */
export async function sweepExpiredStatuses(now: Date = new Date()): Promise<number> {
  const doomed = await prisma.status.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true, mediaKey: true },
    orderBy: { expiresAt: 'asc' },
    take: BATCH,
  });
  if (doomed.length === 0) return 0;

  const storage = getStorage();
  for (const row of doomed) {
    if (row.mediaKey) await storage.delete(row.mediaKey).catch(() => undefined);
  }
  // The view rows go with them: `status_views.statusId` cascades.
  await prisma.status.deleteMany({ where: { id: { in: doomed.map((row) => row.id) } } });
  return doomed.length;
}

@Injectable()
export class StatusSweeper implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(private readonly logger: Logger) {}

  onModuleInit(): void {
    this.first = setTimeout(() => {
      void this.run();
      this.timer = setInterval(() => void this.run(), INTERVAL_MS);
      this.timer.unref?.();
    }, FIRST_RUN_DELAY_MS);
    this.first.unref?.();
  }

  private async run(): Promise<void> {
    try {
      const removed = await sweepExpiredStatuses();
      if (removed > 0) this.logger.info('Swept expired statuses', { removed });
    } catch (error) {
      this.logger.warn('Could not sweep expired statuses', { reason: String(error) });
    }
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
