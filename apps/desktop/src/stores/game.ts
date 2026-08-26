/**
 * Play Together: one board, two chairs, and everybody else watching.
 *
 * There is almost nothing in this store, and that is the design. The gateway
 * is the referee - it holds the board, applies the rules and says what came of
 * a move - so this keeps what it was last told and sends what was clicked. No
 * optimistic move is applied locally, deliberately: a board that showed a move
 * before it was refereed would show a different game to the person who made it
 * for as long as the round trip takes, and "my disc was there a second ago" is
 * the one thing a shared board must never do.
 *
 * What it does own is which panel is on the screen, which is local for the
 * same reason the listening panel's is: somebody folding the board away to
 * read a channel is not asking the other player to stop playing.
 */
import { create } from 'zustand';
import type { GameId, GameSession } from '@betweenus/shared-types';
import type { Mesh } from '../services/mesh';
import { canPlayMove, seatFor, turnLineFor } from '../services/game-view';
import { useAuthStore } from './auth';
import { useListenStore } from './listen';

interface GameState {
  /** What the call is playing, as the gateway last said. Null for nothing. */
  session: GameSession | null;
  /**
   * Whether the games panel has the voice stage.
   *
   * Local, and with a single render site in `VoiceChannelView` - the same rule
   * the listening panel learned the hard way, because `VoiceControls` is drawn
   * twice and a flag it drew from would draw two live panels side by side.
   */
  open: boolean;
  /**
   * Whether the board has the whole window.
   *
   * Local, like `open`, and for the same reason: how big a board is on one
   * person's screen is not a thing the other player is entitled to decide.
   * Carrom in particular wants the room - the coins are a fiftieth of the board
   * across, and a board sharing a stage with a seat rail and a row of faces is
   * a board where the difference between a thin cut and a miss is four pixels.
   */
  fullscreen: boolean;

  attach: (mesh: Mesh) => void;
  detach: () => void;
  receive: (session: GameSession | null) => void;

  setOpen: (open: boolean) => void;
  setFullscreen: (fullscreen: boolean) => void;
  /** Put a game on the table. Whoever does it takes the first chair. */
  openGame: (gameId: GameId) => void;
  sit: (seat: number) => void;
  stand: () => void;
  move: (move: number, params?: number[]) => void;
  rematch: () => void;
  close: () => void;
}

let mesh: Mesh | null = null;

export const useGameStore = create<GameState>((set, get) => ({
  session: null,
  open: false,
  fullscreen: false,

  attach: (next) => {
    mesh = next;
  },

  detach: () => {
    mesh = null;
    set({ session: null, open: false, fullscreen: false });
  },

  receive: (session) => {
    const previous = get().session;
    // The gateway numbers every change, so this client's echo of a state it has
    // already applied cannot undo a later one somebody else caused. Two people
    // moving within a second of each other is the ordinary case here, not an
    // edge: one of them is always answering the other.
    if (session && previous && session.rev <= previous.rev) return;
    set({ session });
  },

  setOpen: (open) => {
    // One stage, one thing on it. The listening panel and the board are both
    // full-width takeovers of the call, so opening either closes the other -
    // and a native browser view painting over a board would be the worse half
    // of that failure. The music itself carries on; only the panel folds away.
    if (open) useListenStore.getState().setOpen(false);
    // Closing the panel drops fullscreen with it. A hidden panel that is still
    // "fullscreen" is a flag waiting to swallow the window the next time
    // somebody opens a game.
    set(open ? { open } : { open, fullscreen: false });
  },

  setFullscreen: (fullscreen) => set({ fullscreen }),

  openGame: (gameId) => mesh?.sendGame({ type: 'game.open', gameId }),
  sit: (seat) => mesh?.sendGame({ type: 'game.sit', seat }),
  stand: () => mesh?.sendGame({ type: 'game.sit', seat: -1 }),
  move: (move, params) => mesh?.sendGame({ type: 'game.move', move, params }),
  rematch: () => mesh?.sendGame({ type: 'game.rematch' }),
  close: () => mesh?.sendGame({ type: 'game.close' }),
}));

/**
 * The same three questions as `services/game-view.ts`, asked about whoever is
 * signed in here. The arithmetic is there; this is the binding to this window.
 */
export function mySeat(session: GameSession | null): number {
  return seatFor(session, useAuthStore.getState().user?.id ?? null);
}

export function canPlay(session: GameSession | null, move: number): boolean {
  return canPlayMove(session, useAuthStore.getState().user?.id ?? null, move);
}

export function turnLine(session: GameSession | null): string {
  return turnLineFor(session, useAuthStore.getState().user?.id ?? null);
}
