/**
 * Which messages in a list were written by somebody this account blocked, and
 * how they fold.
 *
 * A block closes the direct message; it does not take anybody out of a server
 * they share. So in a server channel their messages still arrive, and what
 * the person who blocked them asked for is not to have to read them - the
 * Discord answer, a quiet "Blocked message - Show" row in place of each run.
 * It is a client-side fold and nothing more: the rows are the same rows every
 * other member sees, and revealing one is a choice about this view only.
 *
 * One row per run rather than per message, because the point of blocking a
 * person who talks a lot is not to be shown a column of placeholders instead.
 * A run is broken by anybody else speaking, exactly as a bubble group is.
 *
 * Pure so the folding can be checked without a DOM.
 */

export interface FoldableMessage {
  id: string;
  author: { id: string };
  /** A webhook's message is not the person who created the webhook talking. */
  webhook?: unknown;
  /** Only ordinary messages fold; an arrival line is the channel talking. */
  kind?: string;
}

export interface BlockedRun {
  /** The first message of the run - the key a reveal is remembered under. */
  head: string;
  /** How many messages the run holds, for the row's wording. */
  count: number;
}

/**
 * Every folded message, mapped to the run it belongs to.
 *
 * A message that is absent from the map is drawn as it always was.
 */
export function blockedRuns(
  messages: readonly FoldableMessage[],
  blockedIds: ReadonlySet<string>,
): Map<string, BlockedRun> {
  const runs = new Map<string, BlockedRun>();
  if (blockedIds.size === 0) return runs;

  let current: BlockedRun | null = null;
  for (const message of messages) {
    const folds =
      blockedIds.has(message.author.id) &&
      (message.webhook === undefined || message.webhook === null) &&
      (message.kind === undefined || message.kind === 'USER');
    if (!folds) {
      current = null;
      continue;
    }
    if (current === null) current = { head: message.id, count: 0 };
    current.count += 1;
    runs.set(message.id, current);
  }
  return runs;
}

/** The words on the folded row. */
export function blockedRunLabel(count: number): string {
  return count === 1 ? 'Blocked message' : `${count} blocked messages`;
}

/**
 * The run to open before jumping to `id`, or null when it can be found as it
 * is. Only a run's first message carries an element while it is folded, so a
 * jump (search, pins, a reply quote, a reminder, a thread root) to any other
 * message in it must reveal the run first and scroll once its rows exist.
 */
export function runToReveal(
  runs: ReadonlyMap<string, BlockedRun>,
  revealed: ReadonlySet<string>,
  id: string,
): string | null {
  const run = runs.get(id);
  return run && !revealed.has(run.head) ? run.head : null;
}
