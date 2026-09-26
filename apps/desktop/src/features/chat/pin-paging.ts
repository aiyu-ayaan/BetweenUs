/**
 * Merging pinned pages.
 *
 * The server pages by (pinned-at, id), so a page never repeats or skips a row
 * that was already seen. What the client still has to get right is the seams:
 * a reload after somebody pins something must not throw away the pages already
 * scrolled to, and a page landing twice (a double scroll event) must not show a
 * pin twice.
 */

export interface PinRow {
  id: string;
}

export interface PinPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** A further page appended to what is shown: no repeats, order kept. */
export function appendPinPage<T extends PinRow>(shown: T[], page: T[]): T[] {
  const seen = new Set(shown.map((pin) => pin.id));
  const fresh = page.filter((pin) => !seen.has(pin.id));
  return fresh.length === 0 ? shown : [...shown, ...fresh];
}

/**
 * A fresh first page over pins already loaded. The new page leads, since it is
 * the newest; what was loaded behind it stays (minus repeats) and so does its
 * cursor, so the list neither collapses back to one page nor forgets how far
 * down it had read.
 */
export function refreshPinPages<T extends PinRow>(
  shown: T[],
  shownCursor: string | null,
  first: PinPage<T>,
): { pins: T[]; cursor: string | null } {
  if (shown.length <= first.items.length) return { pins: first.items, cursor: first.nextCursor };
  const firstIds = new Set(first.items.map((pin) => pin.id));
  const tail = shown.filter((pin) => !firstIds.has(pin.id));
  return { pins: [...first.items, ...tail], cursor: shownCursor };
}
