/**
 * Destroys messages whose disappearing window has closed.
 *
 * The window itself is a server's setting and is stamped onto each message as
 * it is sent (`Message.expiresAt`), so this pass has nothing to decide: it
 * collects whatever is past its own stamp. That is what makes changing a
 * server's window safe - it governs what is sent next, and never reaches back
 * through a channel to condemn what is already in it.
 *
 * The row is deleted rather than tombstoned, unlike an ordinary delete. A
 * conversation that fills up with "this message was deleted" for every message
 * that ever aged out is not a disappearing conversation; it is a conversation
 * with a very detailed index of what used to be in it.
 *
 * Blobs go first and by the same rule as everywhere else: the object before
 * the row, so a failure leaves something the attachment sweeper will collect
 * rather than something nothing can ever name again.
 *
 * ponytail: a timer in the process, like the two upload sweeps beside it. Two
 * replicas will overlap; the delete of an already-deleted row is a no-op and
 * the second one simply finds nothing.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { Logger } from '@betweenus/logger';
import { purgeMessageAttachments } from '../uploads/attachment-sweeper';

/**
 * How often to look.
 *
 * A minute, where the upload sweeps run every six hours, and the difference is
 * what the two are for. A stray blob costs disk. A message that outlives its
 * window is the feature not working, and the shortest window on offer is an
 * hour - so a minute is a rounding error against it and is still one small
 * indexed query per replica per minute.
 */
const INTERVAL_MS = 60_000;

/** Not at boot: a service starting is the worst moment to add database work. */
const FIRST_RUN_DELAY_MS = 30_000;

/** How many one pass destroys, so a backlog is spread rather than dropped at once. */
const BATCH = 200;

/** Which rows a pass takes. Kept out of the sweep so it can be asserted on. */
export function expiredWhere(now: Date = new Date()): { expiresAt: { lte: Date } } {
  return { expiresAt: { lte: now } };
}

/**
 * Destroys what is past its window and returns how many went.
 *
 * The event per message is deliberate and is the point of doing this on the
 * server at all: a client that is on screen when the window closes has the
 * plaintext in memory and would happily keep drawing it. It is told to forget.
 */
export async function sweepExpired(events: EventBus, now: Date = new Date()): Promise<number> {
  const doomed = await prisma.message.findMany({
    where: expiredWhere(now),
    select: { id: true, channelId: true },
    orderBy: { expiresAt: 'asc' },
    take: BATCH,
  });
  if (doomed.length === 0) return 0;

  await purgeMessageAttachments(doomed.map((row) => row.id));
  await prisma.message.deleteMany({ where: { id: { in: doomed.map((row) => row.id) } } });

  for (const row of doomed) {
    await events.publish(EVENTS.MESSAGE_DELETED, {
      messageId: row.id,
      channelId: row.channelId,
      // No tombstone: a disappearing message that leaves a permanent marker
      // saying something was here has not disappeared.
      message: null,
    });
  }
  return doomed.length;
}

@Injectable()
export class DisappearingSweeper implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(
    private readonly events: EventBus,
    private readonly logger: Logger,
  ) {}

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
      const removed = await sweepExpired(this.events);
      if (removed > 0) this.logger.info('Swept expired messages', { removed });
    } catch (error) {
      this.logger.warn('Could not sweep expired messages', { reason: String(error) });
    }
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
