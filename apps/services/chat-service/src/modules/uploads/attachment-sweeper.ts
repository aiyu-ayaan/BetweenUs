/**
 * Removes attachment blobs nothing justifies keeping.
 *
 * Two kinds qualify, and which is which is now a column rather than an
 * inference. `PENDING` is an upload nobody ever sent - a client that sealed a
 * file, uploaded it and then closed the composer - and it is collected once
 * its grace has run. `ORPHANED` is a blob whose message is gone, deleted by
 * its author, by a moderator, or with the channel, the server or the account,
 * and it is collected at once however recently it was uploaded.
 *
 * Reading a state instead of re-deriving one is the change. The old query -
 * `messageId IS NULL`, or a join onto the message's `deletedAt` - could not
 * tell an upload still being composed from one abandoned an hour ago, nor a
 * blob whose message was hard-deleted from one that was never claimed, and it
 * resolved both ambiguities the same way: leave it. So objects accumulated
 * that nothing would ever name again.
 *
 * What this pass still cannot see is an object with no row at all. That is
 * `StorageReconciler`'s job, and it is the other direction entirely: it starts
 * from the bucket rather than from the table.
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
    { state: 'PENDING'; stateAt: { lte: Date } },
    { state: 'ORPHANED' },
    { state: 'LINKED'; messageId: null },
  ];
}

export function sweepWhere(now: Date = new Date(), grace: number = graceMs()): SweepWhere {
  return {
    OR: [
      { state: 'PENDING', stateAt: { lte: new Date(now.getTime() - grace) } },
      { state: 'ORPHANED' },
      // A row whose message was *hard*-deleted rather than tombstoned: a
      // cascade from the channel, the server or the account nulls `messageId`
      // and cannot run application code to update the state beside it. Without
      // this arm those rows would sit at LINKED forever, which is the leak the
      // state column would otherwise have introduced - a regression on the old
      // `messageId IS NULL` query rather than an improvement on it.
      { state: 'LINKED', messageId: null },
    ],
  };
}

/**
 * Moves rows to `LINKED` as the message carrying them is written.
 *
 * The other half of the state column. Without it every claimed attachment
 * would sit at `PENDING` and be collected the moment its grace ran out -
 * which is to say every photograph in the app would be deleted a day after it
 * was sent. The write happens in the same transaction as the message for that
 * reason: a claim that can be half-applied is a claim that is worse than none.
 */
export function linkWhere(messageId: string, keys: string[]) {
  return { key: { in: keys }, messageId: null as string | null, state: 'PENDING' as const };
}

/**
 * Moves rows to `ORPHANED` when the message naming them is gone.
 *
 * Recorded rather than derived, which is what lets the sweep read one column.
 * Deleting, burning and expiring all land here, and so does a cascade that
 * nulls `messageId` out from under a row - the one case the old expression
 * could not distinguish from an upload nobody had sent yet, so it waited a day
 * before collecting a blob whose message a moderator had just removed.
 */
export async function orphanMessageAttachments(messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  const result = await prisma.attachment.updateMany({
    where: { messageId: { in: messageIds }, state: { not: 'ORPHANED' } },
    data: { state: 'ORPHANED', stateAt: new Date() },
  });
  return result.count;
}

/**
 * Removes the blobs of specific messages now, rather than at the next sweep.
 *
 * The sweeper on its own is correct but slow: up to six hours pass between
 * somebody deleting a photo and the ciphertext leaving the object store, and
 * "I deleted it" meaning "in a few hours" is not what anybody who presses that
 * button is asking for. So a delete, a burn and an expiry all call this, and
 * the sweeper stays behind them as the backstop that catches whatever this
 * could not reach - storage that was down, a process that died mid-delete, a
 * row orphaned by somebody else's cascade.
 *
 * Deliberately quiet about failure. The caller is a user pressing delete, and
 * the message is deleted whether or not the object store answered; what is
 * left behind is exactly what the sweeper exists to collect.
 */
export async function purgeMessageAttachments(messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;

  // Marked first, deleted second. The mark is the durable part: if the object
  // store is down, or this process dies between the two, the rows are already
  // `ORPHANED` and the next sweep finishes the job. Doing it the other way
  // round - delete the objects, then notice you cannot write the state - is
  // how a row ends up pointing at bytes that are no longer there.
  await orphanMessageAttachments(messageIds);

  const rows = await prisma.attachment.findMany({
    where: { messageId: { in: messageIds } },
    select: { id: true, key: true },
  });
  if (rows.length === 0) return 0;

  const storage = getStorage();
  const gone: string[] = [];
  for (const row of rows) {
    // Object first, then row - the same order and for the same reason as the
    // sweep below: a row removed first is a blob nothing can ever name again.
    try {
      await storage.delete(row.key);
      gone.push(row.id);
    } catch {
      // Left for the sweeper, which will find it unclaimed and try again.
    }
  }

  if (gone.length > 0) await prisma.attachment.deleteMany({ where: { id: { in: gone } } });
  return gone.length;
}

/** Deletes the objects and their rows. Returns how many objects went. */
export async function sweepAttachments(now: Date = new Date()): Promise<number> {
  const doomed = await prisma.attachment.findMany({
    where: sweepWhere(now),
    select: { id: true, key: true },
    orderBy: { stateAt: 'asc' },
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
