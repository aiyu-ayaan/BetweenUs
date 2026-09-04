/**
 * How long a moment has been on screen, across the pauses.
 *
 * One line, extracted from `Bar` because it is the line that got it wrong. A
 * bar accumulates the time it has actually been running so that resuming does
 * not restart the post - and the mistake was accumulating for a bar that had
 * never started, which charged it for however long the earlier posts in the
 * run had been up. A five-second photo then opened already spent, ended in the
 * same frame, and the run fell through to the next person's.
 *
 * `startedAt` is null for a bar that is not running, which is every bar that
 * has just become the current one and is waiting for its picture to arrive.
 */
export function spentAfter(spent: number, startedAt: number | null, now: number): number {
  return startedAt === null ? spent : spent + Math.max(now - startedAt, 0);
}
