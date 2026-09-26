/**
 * The pinned tile, kept for the length of a call rather than a component.
 *
 * A pin used to be component state, so a reload - which on the web ends the
 * call outright - or a rejoin after a dropped call put the stage back to the
 * grid, and the face somebody chose to watch had to be found and pinned again.
 * It now lives in `sessionStorage`, which is per window (a second window keeps
 * its own) and per browsing session, keyed by the channel the call is in.
 *
 * What survives: a reload, leaving and rejoining the **same** call, and the
 * pinned person's peer id changing - a reconnect gives them a new one, so the
 * pin also remembers their user id and resolves through it.
 *
 * What ends it: unpinning, the pinned person leaving while this window watches,
 * and the call ending - its voice roster emptying, which is the only "over"
 * every client sees the same way (`endStagePin`). Somebody not back yet after a
 * rejoin has not "left": the pin waits, because the stage fills one peer at a
 * time.
 *
 * Every storage touch is wrapped: a private window, a blocked origin or a full
 * quota throws, and a pin is not worth failing a call over.
 */

/** One entry, not one per channel: only one call is ever live per window. */
export const STAGE_PIN_KEY = 'betweenus.stagePin';

export interface StagePin {
  /** The voice channel the call is in. A pin is never restored anywhere else. */
  channelId: string;
  /** The tile key: a peer id, or the local key for yourself. */
  key: string;
  /** Who it is, so a new peer id for the same person still resolves. */
  userId: string | null;
  /** Yourself. Resolves to the local tile, whatever its key is. */
  isLocal: boolean;
}

export interface PinnableTile {
  key: string;
  userId: string | null;
  isLocal: boolean;
}

export type PinStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** This window's `sessionStorage`, or null where touching it throws. */
export function sessionPinStorage(): PinStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isStagePin(value: unknown): value is StagePin {
  if (typeof value !== 'object' || value === null) return false;
  const pin = value as Record<string, unknown>;
  return (
    typeof pin.channelId === 'string' &&
    typeof pin.key === 'string' &&
    (pin.userId === null || typeof pin.userId === 'string') &&
    typeof pin.isLocal === 'boolean'
  );
}

/** The pin saved for this channel, or null - including for anything unreadable. */
export function readStagePin(storage: PinStorage | null, channelId: string): StagePin | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STAGE_PIN_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStagePin(parsed) || parsed.channelId !== channelId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Saves a pin, or removes the saved one for `null`. */
export function writeStagePin(storage: PinStorage | null, pin: StagePin | null): void {
  if (!storage) return;
  try {
    if (pin === null) storage.removeItem(STAGE_PIN_KEY);
    else storage.setItem(STAGE_PIN_KEY, JSON.stringify(pin));
  } catch {
    // See the header: a pin that cannot be kept is merely not kept.
  }
}

/** The pin for a tile that was just pressed. */
export function pinFor(channelId: string, tile: PinnableTile): StagePin {
  return { channelId, key: tile.key, userId: tile.userId, isLocal: tile.isLocal };
}

/**
 * Which tile on the stage the pin means, or null if they are not on it.
 *
 * The key first; then, for yourself, whichever tile is local; then, for anybody
 * else, a tile with the same user id - their peer id is new after a reconnect.
 */
export function resolveStagePin<T extends PinnableTile>(
  pin: StagePin | null,
  tiles: T[],
  channelId: string,
): string | null {
  if (!pin || pin.channelId !== channelId) return null;
  if (tiles.some((tile) => tile.key === pin.key && tile.isLocal === pin.isLocal)) return pin.key;
  if (pin.isLocal) return tiles.find((tile) => tile.isLocal)?.key ?? null;
  if (pin.userId === null) return null;
  return tiles.find((tile) => !tile.isLocal && tile.userId === pin.userId)?.key ?? null;
}

export interface PinWatch {
  pin: StagePin | null;
  /** The pin has been on the stage since the call last connected. */
  seen: boolean;
}

/**
 * One step of "drop the pin when that person leaves".
 *
 * Only a pin that has been on the stage during this connection can be dropped:
 * straight after a reload or a rejoin nobody is on the stage yet, and a pin
 * dropped then would never survive anything. Not connected resets `seen`,
 * because the stage is the presence roster then, not the call.
 */
export function watchStagePin(
  watch: PinWatch,
  resolved: boolean,
  connected: boolean,
  channelId: string,
): PinWatch {
  // A pin belongs to the call it was set in: somebody with the same user id
  // leaving another call says nothing about it.
  if (watch.pin !== null && watch.pin.channelId !== channelId) return watch;
  if (!connected || watch.pin === null) return { pin: watch.pin, seen: false };
  if (resolved) return { pin: watch.pin, seen: true };
  return watch.seen ? { pin: null, seen: false } : watch;
}

/**
 * Clears the saved pin when its call ends: the channel's roster went from
 * somebody to nobody. Only on that transition - a roster that was already
 * empty when first heard (straight after a reload) says nothing about a call.
 */
export function endStagePin(
  storage: PinStorage | null,
  channelId: string,
  before: readonly string[],
  after: readonly string[],
): void {
  if (before.length === 0 || after.length > 0) return;
  if (readStagePin(storage, channelId) !== null) writeStagePin(storage, null);
}
