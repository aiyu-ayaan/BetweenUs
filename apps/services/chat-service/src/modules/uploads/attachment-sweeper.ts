/**
 * Removes attachment blobs nothing justifies keeping.
 *
 * Two kinds qualify. One is an upload nobody ever sent: a client that sealed a
 * file, uploaded it and then closed the composer leaves a paid-for object that
 * no message names. The other is a blob whose message is gone - deleted by its
 * author, deleted by a moderator, or destroyed with the channel, the server or
 * the account, all of which the null-on-delete foreign key turns into the same
 * unclaimed row.
 *
 * A message is soft-deleted, so a claimed row is collected on `deletedAt`
 * rather than on the row disappearing. The tombstone stays; the ciphertext it
 * used to point at does not.
 *
 * ponytail: a timer in the process, like the two sweeps either side of it.
 * Two replicas will overlap and both try to delete the same object, which is
 * why a delete that finds nothing is not an error.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { envNumber } from '@betweenus/config';
import { prisma } from '@betweenus/database';
import { Logger } from '@betweenus/logger';
import { getStorage } from '@betweenus/storage';

const HOUR_MS = 60 * 60 * 1000;

/** How often to look. Nothing here is urgent; it is disk, not correctness. */
const INTERVAL_MS = 6 * HOUR_MS;

/** Not at boot: a service starting is the worst moment to add storage work. */
const FIRST_RUN_DELAY_MS = 10 * 60_000;

/** How many objects one pass will delete, so a backlog is spread over passes. */
const BATCH = 500;

/**
 * How long an unclaimed upload is left alone.
 *
 * An upload is claimed by the message that carries it, which is sent seconds
 * later - but a client that uploads a large file, then waits for the user to
 * finish typing, is still holding a legitimately unclaimed blob. A day is far
 * longer than that gap and short enough that abandoned uploads do not
 * accumulate.
 */
function graceMs(): number {
  return envNumber('ATTACHMENT_GRACE_HOURS', 24) * HOUR_MS;
}

/**
 * Which rows a pass collects, as the query that finds them.
 *
 * Two arms, and the difference between them is the whole policy. A row that no
 * message ever claimed is only fair game once the grace period has passed,
 * because an upload in progress looks exactly like an abandoned one. A row
 * whose message has been deleted is fair game at once, however recently it was
 * uploaded - the message it belonged to is gone, and waiting a day to remove
 * what a moderator deleted is the wrong answer.
 *
 * Kept separate from the sweep so the decision can be asserted on without a
 * database: see `attachment-sweeper.check.ts`.
 */
export interface SweepWhere {
  OR: [
    { messageId: null; createdAt: { lte: Date } },
    { message: { deletedAt: { not: null } } },
  ];
}

export function sweepWhere(now: Date = new Date(), grace: number = graceMs()): SweepWhere {
  return {
    OR: [
      { messageId: null, createdAt: { lte: new Date(now.getTime() - grace) } },
      { message: { deletedAt: { not: null } } },
    ],
  };
}

/** Deletes the objects and their rows. Returns how many objects went. */
export async function sweepAttachments(now: Date = new Date()): Promise<number> {
  const doomed = await prisma.attachment.findMany({
    where: sweepWhere(now),
    select: { id: true, key: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  if (doomed.length === 0) return 0;

  const storage = getStorage();
  const gone: string[] = [];
  for (const row of doomed) {
    // The object goes first. A row removed before its object is a blob nothing
    // can ever name again; an object removed before its row is retried next
    // pass and deletes nothing the second time.
    try {
      await storage.delete(row.key);
      gone.push(row.id);
    } catch {
      // Storage that is unhappy now will be asked again in six hours.
    }
  }

  if (gone.length > 0) await prisma.attachment.deleteMany({ where: { id: { in: gone } } });
  return gone.length;
}

@Injectable()
export class AttachmentSweeper implements OnModuleInit, OnModuleDestroy {
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
      const removed = await sweepAttachments();
      if (removed > 0) this.logger.info('Swept attachment blobs', { removed });
    } catch (error) {
      this.logger.warn('Could not sweep attachment blobs', { reason: String(error) });
    }
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
