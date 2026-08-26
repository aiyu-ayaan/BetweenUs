/**
 * The games library: every set of rules, keyed by the id that travels on the
 * wire.
 *
 * One registry rather than a switch in each place that needs one. The gateway
 * looks a game up to referee it, the client looks the same game up to draw it,
 * and adding a fifth game is a file and a line here - not a case in the
 * gateway, a case in the store and a case in the panel, three places that can
 * disagree.
 */
import { carrom } from './carrom';
import { connectFour } from './connect-four';
import { dotsAndBoxes } from './dots-and-boxes';
import { ludo } from './ludo';
import { reversi } from './reversi';
import { ticTacToe } from './tic-tac-toe';
import type { GameId, GameRules, GameSession, GameState } from './types';

export * from './types';
export type { Piece, ShotResult } from './carrom-physics';
export { COLUMNS, ROWS, at as connectFourAt, landing, winningRun } from './connect-four';
export { CELLS, DOTS, LINES, boxLines, horizontal, vertical } from './dots-and-boxes';
export { SIZE as REVERSI_SIZE, at as reversiAt, flips, movesFor } from './reversi';
export { lineWinner, winningLine } from './tic-tac-toe';
export {
  BASELINE,
  BASELINE_HALF_WIDTH,
  BLACK,
  PIECES,
  QUEEN,
  QUEEN_VALUE,
  STRIKER,
  WHITE,
  aimOf,
  baselineY,
  carromPieces,
  carromShot,
  coinsOf,
  lastShot,
  placeStriker,
  queenOwner,
  queenPending,
} from './carrom';
export {
  BOARD,
  COIN_RADIUS,
  DT,
  POCKETS,
  POCKET_INSET,
  POCKET_RADIUS,
  STEPS_PER_FRAME,
  STRIKER_RADIUS,
  coin,
  simulate,
} from './carrom-physics';
export {
  HOME,
  LAST_TRACK_STEP,
  ROLL,
  SAFE,
  START,
  TOKENS,
  TRACK,
  YARD,
  dieOf,
  lastCapture,
  lastTokenMoved,
  progressOf,
  tokenIndex,
  tokenMoves,
  trackSquare,
} from './ludo';

export const GAMES: Record<GameId, GameRules> = {
  'tic-tac-toe': ticTacToe,
  'connect-four': connectFour,
  reversi,
  'dots-and-boxes': dotsAndBoxes,
  ludo,
  carrom,
};

/**
 * The library, in the order it is shown.
 *
 * Shortest first, because the person opening this panel for the first time is
 * looking for something to try rather than something to commit to.
 */
export const GAME_LIBRARY: GameId[] = [
  'tic-tac-toe',
  'connect-four',
  'reversi',
  'dots-and-boxes',
  'ludo',
  'carrom',
];

/** The rules for an id, or null when a client sent one this build has never heard of. */
export function gameRules(gameId: string): GameRules | null {
  return (GAMES as Record<string, GameRules | undefined>)[gameId] ?? null;
}

/** Which seat this user is in, or -1 when they are watching. */
export function seatOf(session: GameSession, userId: string): number {
  return session.seats.findIndex((seat) => seat?.userId === userId);
}

/** Whether it is this user's move - the one question every board asks. */
export function isTurnOf(session: GameSession, userId: string): boolean {
  if (session.state.winner !== null) return false;
  return seatOf(session, userId) === session.state.turn;
}

/**
 * Whether a game can actually be played right now.
 *
 * Every chair filled. A board that accepted moves with one player is a game
 * against nobody, and one that hid itself until it was full would give the
 * first person nothing to look at while they wait.
 */
export function gameReady(session: GameSession): boolean {
  return session.seats.every((seat) => seat !== null);
}

/** The score, in the shape the seat rail draws it. */
export function gameScore(state: GameState): number[] {
  return gameRules(state.gameId)?.score(state) ?? [];
}
