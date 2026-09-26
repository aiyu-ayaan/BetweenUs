/**
 * Pure rules for searching a conversation on the device.
 *
 * The server holds ciphertext and will not be given a way to read it, so a word
 * can only be found by fetching older pages, opening them here and matching.
 * This file is that loop with its I/O injected: which pages exist, how they
 * are opened and what the caller wants to hear are all arguments, so the
 * ordering, the batch bound and the stop rules can be checked without a
 * server, a key or a screen.
 *
 * The bound matters. Nobody typed "hello" to decrypt a year of a busy channel,
 * so one run reads at most `WALK_MESSAGE_CAP` messages and then waits to be
 * asked again.
 */

export const SEARCH_MIN_TERM = 2;
/** Most messages one run opens. A further run is a deliberate press. */
export const WALK_MESSAGE_CAP = 1000;
/** Most matches drawn; the newest are kept. */
export const SEARCH_HIT_CAP = 200;

export interface Searchable {
  id: string;
  content: string;
  createdAt: string;
  deletedAt?: string | null;
}

/** Lower-cased term, or null while it is too short to be worth a search. */
export function normaliseTerm(query: string): string | null {
  const term = query.trim().toLowerCase();
  return term.length >= SEARCH_MIN_TERM ? term : null;
}

/** Newest first: by time, then id, so equal stamps keep one fixed order. */
export function newestFirst(a: Searchable, b: Searchable): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The matches among some messages, newest first. Deleted rows never match. */
export function matchMessages<T extends Searchable>(messages: T[], term: string): T[] {
  return messages
    .filter((message) => !message.deletedAt && message.content.toLowerCase().includes(term))
    .sort(newestFirst);
}

/** Adds matches to the ones already shown: no repeats, still newest first, capped. */
export function mergeHits<T extends Searchable>(current: T[], more: T[]): T[] {
  const seen = new Set(current.map((message) => message.id));
  const added = more.filter((message) => !seen.has(message.id));
  if (added.length === 0) return current;
  return [...current, ...added].sort(newestFirst).slice(0, SEARCH_HIT_CAP);
}

export interface WalkPage<T> {
  /** Oldest first, as the server returns a page. */
  items: T[];
  nextCursor: string | null;
}

export type WalkStop =
  /** The first message of the channel was reached. */
  | 'end'
  /** This run read its allowance; another run continues from `cursor`. */
  | 'cap'
  /** The caller asked it to stop. */
  | 'stopped'
  /** A page could not be fetched or opened. */
  | 'error';

export interface WalkProgress<T> {
  /** Matches found in the page just read. */
  hits: T[];
  /** Messages opened so far in this run. */
  scanned: number;
  /** When the oldest message read so far was written, or null before any. */
  oldestAt: string | null;
  /** Where the next page starts; null once the channel is exhausted. */
  cursor: string | null;
}

export interface WalkOptions<T extends Searchable> {
  term: string;
  /** The cursor the walk continues from - the oldest page not yet searched. */
  cursor: string;
  /** Fetches one page and opens it. May throw. */
  fetchPage: (cursor: string) => Promise<WalkPage<T>>;
  /** Called after every page, so results appear as they are found. */
  onProgress: (progress: WalkProgress<T>) => void;
  isStopped: () => boolean;
  maxMessages?: number;
}

export interface WalkResult {
  stop: WalkStop;
  scanned: number;
  oldestAt: string | null;
  cursor: string | null;
}

export async function walkOlder<T extends Searchable>(
  options: WalkOptions<T>,
): Promise<WalkResult> {
  const max = options.maxMessages ?? WALK_MESSAGE_CAP;
  let cursor: string | null = options.cursor;
  let scanned = 0;
  let oldestAt: string | null = null;

  while (cursor !== null) {
    if (options.isStopped()) return { stop: 'stopped', scanned, oldestAt, cursor };
    if (scanned >= max) return { stop: 'cap', scanned, oldestAt, cursor };

    let page: WalkPage<T>;
    try {
      page = await options.fetchPage(cursor);
    } catch {
      return { stop: 'error', scanned, oldestAt, cursor };
    }
    // A stop that arrived while the page was in flight discards it: the caller
    // has moved on to another term or channel and its list is not ours to touch.
    if (options.isStopped()) return { stop: 'stopped', scanned, oldestAt, cursor };

    scanned += page.items.length;
    const first = page.items[0];
    if (first && (oldestAt === null || first.createdAt < oldestAt)) oldestAt = first.createdAt;
    cursor = page.nextCursor;
    options.onProgress({
      hits: matchMessages(page.items, options.term),
      scanned,
      oldestAt,
      cursor,
    });
  }
  return { stop: 'end', scanned, oldestAt, cursor: null };
}

/**
 * How many messages a step covers, for the one-line status. Kept here so the
 * wording and the arithmetic are checked together.
 */
export function walkStatus(stop: WalkStop | null, scanned: number, oldestLabel: string | null): string {
  const reach = oldestLabel ? ` back to ${oldestLabel}` : '';
  switch (stop) {
    case null:
      return `Searching${reach}… ${scanned} older messages read`;
    case 'end':
      return `Searched the whole conversation${reach ? ` (${oldestLabel})` : ''}`;
    case 'cap':
      return `Searched${reach}. Stopped after ${scanned} older messages`;
    case 'stopped':
      return `Stopped${reach}`;
    case 'error':
      return `Could not read further${reach}`;
  }
}
