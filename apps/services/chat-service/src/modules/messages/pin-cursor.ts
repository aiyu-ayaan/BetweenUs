/**
 * Paging for the pinned list.
 *
 * Pins are ordered by when they were pinned, newest first, with the message id
 * as the tiebreak so two pins stamped in the same millisecond still have one
 * fixed order. The cursor names the last row of a page (its pin time and id)
 * rather than an offset, so a pin added or removed while somebody scrolls
 * moves nothing they have already seen and repeats nothing.
 */

export const PIN_PAGE_DEFAULT = 25;
export const PIN_PAGE_MAX = 100;

export interface PinCursor {
  pinnedAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodePinCursor(cursor: PinCursor): string {
  return Buffer.from(`${cursor.pinnedAt.getTime()}.${cursor.id}`, 'utf8').toString('base64url');
}

/** Null for anything that is not a cursor this module handed out. */
export function decodePinCursor(raw: string): PinCursor | null {
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const dot = text.indexOf('.');
  if (dot < 1) return null;
  const ms = Number(text.slice(0, dot));
  const id = text.slice(dot + 1);
  if (!Number.isInteger(ms) || ms < 0 || !UUID.test(id)) return null;
  const pinnedAt = new Date(ms);
  if (Number.isNaN(pinnedAt.getTime())) return null;
  return { pinnedAt, id };
}

/** Clamps a requested page size into [1, PIN_PAGE_MAX]. */
export function pinPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return PIN_PAGE_DEFAULT;
  return Math.min(PIN_PAGE_MAX, Math.max(1, Math.trunc(requested)));
}

/**
 * Rows fetched with one extra: the extra proves there is a next page without a
 * count query, and is dropped from the page itself.
 */
export function pinPage<T extends { id: string; pinnedAt: Date | null }>(
  rows: T[],
  size: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  if (rows.length <= size || !last || !last.pinnedAt) return { items, nextCursor: null };
  return { items, nextCursor: encodePinCursor({ pinnedAt: last.pinnedAt, id: last.id }) };
}
