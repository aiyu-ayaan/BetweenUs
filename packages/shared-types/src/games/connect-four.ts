/**
 * Connect Four: seven columns, six rows, four in a line.
 *
 * The move is a *column*, not a square, which is the one thing about this game
 * that has to be right in a shared board: two people clicking the same column
 * within a moment of each other must produce two discs stacked, never two discs
 * in one hole. Sending a square would make that a race the gateway could not
 * see - it would receive two legal-looking placements. Sending a column makes
 * the second click land on top of the first, because the drop is computed after
 * the ordering rather than before it.
 */
import type { GameRules, GameState } from './types';

export const COLUMNS = 7;
export const ROWS = 6;

/** Index of the square at row `r` (0 is the top), column `c`. */
export function at(r: number, c: number): number {
  return r * COLUMNS + c;
}

function create(): GameState {
  return {
    gameId: 'connect-four',
    cells: Array<number>(COLUMNS * ROWS).fill(-1),
    boxes: [],
    data: [],
    turn: 0,
    winner: null,
    lastMove: null,
    moveCount: 0,
  };
}

/** The lowest empty row in a column, or -1 when it is full. */
export function landing(cells: number[], column: number): number {
  for (let r = ROWS - 1; r >= 0; r -= 1) {
    if (cells[at(r, column)] === -1) return r;
  }
  return -1;
}

/** The four squares that won it, or null - so the board can light them up. */
export function winningRun(cells: number[], from: number): number[] | null {
  const owner = cells[from];
  if (owner === undefined || owner === -1) return null;
  const r0 = Math.floor(from / COLUMNS);
  const c0 = from % COLUMNS;

  // Only the four directions, each explored both ways: a run through the last
  // disc is the only run that can be new, which is why this takes `from`
  // rather than sweeping the whole board on every move.
  for (const [dr, dc] of [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]) {
    const run = [from];
    for (const sign of [1, -1]) {
      let r = r0 + dr! * sign;
      let c = c0 + dc! * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLUMNS && cells[at(r, c)] === owner) {
        run.push(at(r, c));
        r += dr! * sign;
        c += dc! * sign;
      }
    }
    if (run.length >= 4) return run;
  }
  return null;
}

export const connectFour: GameRules = {
  definition: {
    id: 'connect-four',
    name: 'Connect Four',
    blurb: 'Drop a disc, take a column, get four in a line before they do.',
    seats: 2,
    seatNames: ['Red', 'Yellow'],
    seatColours: ['#f43f5e', '#facc15'],
    length: '5 min',
  },

  create,

  moves: (state) => {
    if (state.winner !== null) return [];
    const open: number[] = [];
    for (let c = 0; c < COLUMNS; c += 1) if (landing(state.cells, c) !== -1) open.push(c);
    return open;
  },

  apply: (state, seat, move) => {
    if (state.winner !== null) return null;
    if (seat !== state.turn) return null;
    if (!Number.isInteger(move) || move < 0 || move >= COLUMNS) return null;

    const row = landing(state.cells, move);
    if (row === -1) return null;

    const square = at(row, move);
    const cells = [...state.cells];
    cells[square] = seat;
    const moveCount = state.moveCount + 1;
    const won = winningRun(cells, square) !== null;
    return {
      ...state,
      cells,
      winner: won ? seat : moveCount === COLUMNS * ROWS ? -1 : null,
      turn: seat === 0 ? 1 : 0,
      lastMove: square,
      moveCount,
    };
  },

  score: (state) => [
    state.cells.filter((owner) => owner === 0).length,
    state.cells.filter((owner) => owner === 1).length,
  ],
};
