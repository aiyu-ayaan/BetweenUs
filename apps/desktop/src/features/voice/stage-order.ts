/**
 * Who goes where on the call stage, decided without React so it can be checked.
 *
 * Two rules, and both exist because a call grid that rearranges itself is the
 * thing people notice and hate:
 *
 * - **Order** only moves for a speaker when there is a page two to move them
 *   onto. A stage everybody already fits on is left exactly as it arrived.
 * - **The stage is other people.** The local tile comes out of the grid and is
 *   drawn small over the corner of it, unless there is nobody else in the call,
 *   in which case it is all there is to show.
 *
 * Pinning overrides the grid entirely: one face big, the rest in a strip.
 */

/** Tiles per page. Nine keeps every face big enough to read on a laptop. */
export const PAGE_SIZE = 9;

/** How long after speaking someone keeps their place at the front. */
export const PROMOTION_MS = 60_000;

export interface OrderableTile {
  key: string;
  isLocal: boolean;
  lastSpokeAt: number;
}

/**
 * Recent speakers first - but only when somebody would otherwise be off-screen.
 *
 * The promotion exists to keep an active speaker on page one. With everybody
 * already on page one it has nothing left to do but shuffle faces mid-sentence,
 * so the list is returned untouched. The local tile is not counted: it is a
 * floating window, not a grid cell.
 */
export function orderStage<T extends OrderableTile>(tiles: T[], now: number): T[] {
  if (tiles.filter((tile) => !tile.isLocal).length <= PAGE_SIZE) return tiles;

  const recent = (tile: T): number => (now - tile.lastSpokeAt < PROMOTION_MS ? tile.lastSpokeAt : 0);
  return [...tiles].sort((left, right) => recent(right) - recent(left));
}

export interface StageSplit<T> {
  /** Your own tile, if you are in the call. Drawn small, never in the grid. */
  self: T | null;
  /** What the grid pages through: the other people, or you if you are alone. */
  grid: T[];
  /** Pinned to fill the stage, if anybody is - the local tile included. */
  hero: T | null;
  /** Everyone else, as thumbnails under a hero. Empty when nothing is pinned. */
  strip: T[];
}

export function splitStage<T extends OrderableTile>(
  tiles: T[],
  pinned: string | null,
): StageSplit<T> {
  const self = tiles.find((tile) => tile.isLocal) ?? null;
  const others = tiles.filter((tile) => !tile.isLocal);
  // Alone in the call there is nobody else to look at, so your own camera takes
  // the stage rather than hiding in a thumbnail of an empty room.
  const grid = others.length > 0 ? others : tiles;
  const hero = pinned === null ? null : (tiles.find((tile) => tile.key === pinned) ?? null);
  const strip = hero ? grid.filter((tile) => tile.key !== hero.key) : [];

  return { self, grid, hero, strip };
}
