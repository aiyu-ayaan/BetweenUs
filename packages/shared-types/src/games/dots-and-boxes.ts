/**
 * Dots and Boxes: draw a line between two dots, close a square, go again.
 *
 * The board is a 5x5 grid of dots, so a move is one of the forty lines between
 * them and the prize is one of the sixteen squares. `cells` holds the lines and
 * `boxes` holds the squares, which is the one game in the library that needs
 * both halves of `GameState` - see the note on that type.
 *
 * Closing a box means playing again, and that is the rule that makes the game:
 * a chain of five boxes is five moves in a row and the reason the endgame is
 * the whole endgame. It is also the rule a naive "alternate the turn" reducer
 * silently loses, which is why the turn here is decided by what the move did.
 */
import type { GameRules, GameState } from './types';

/** Dots per side. Boxes per side is one less. */
export const DOTS = 5;
export const CELLS = DOTS - 1;
/** Lines across the top of a row of boxes: `DOTS` rows of `CELLS`. */
export const HORIZONTALS = DOTS * CELLS;
export const LINES = HORIZONTALS * 2;

/** The horizontal line below dot-row `r`, at column `c`. */
export function horizontal(r: number, c: number): number {
  return r * CELLS + c;
}

/** The vertical line right of dot-column `c`, in row `r`. */
export function vertical(r: number, c: number): number {
  return HORIZONTALS + r * DOTS + c;
}

/** The four lines around box (r, c): top, bottom, left, right. */
export function boxLines(r: number, c: number): number[] {
  return [horizontal(r, c), horizontal(r + 1, c), vertical(r, c), vertical(r, c + 1)];
}

function create(): GameState {
  return {
    gameId: 'dots-and-boxes',
    cells: Array<number>(LINES).fill(-1),
    boxes: Array<number>(CELLS * CELLS).fill(-1),
    data: [],
    turn: 0,
    winner: null,
    lastMove: null,
    moveCount: 0,
  };
}

function counts(boxes: number[]): number[] {
  return [
    boxes.filter((owner) => owner === 0).length,
    boxes.filter((owner) => owner === 1).length,
  ];
}

export const dotsAndBoxes: GameRules = {
  definition: {
    id: 'dots-and-boxes',
    name: 'Dots and Boxes',
    blurb: 'Join the dots. Close a square and you go again - so save the chains.',
    seats: 2,
    seatNames: ['Blue', 'Green'],
    seatColours: ['#60a5fa', '#4ade80'],
    length: '10 min',
  },

  create,

  moves: (state) => {
    if (state.winner !== null) return [];
    return state.cells.flatMap((owner, index) => (owner === -1 ? [index] : []));
  },

  apply: (state, seat, move) => {
    if (state.winner !== null) return null;
    if (seat !== state.turn) return null;
    if (!Number.isInteger(move) || move < 0 || move >= LINES) return null;
    if (state.cells[move] !== -1) return null;

    const cells = [...state.cells];
    cells[move] = seat;

    // A line can close two boxes at once - the one either side of it - and
    // both belong to whoever drew it.
    const boxes = [...state.boxes];
    let claimed = 0;
    for (let r = 0; r < CELLS; r += 1) {
      for (let c = 0; c < CELLS; c += 1) {
        const index = r * CELLS + c;
        if (boxes[index] !== -1) continue;
        if (boxLines(r, c).every((line) => cells[line] !== -1)) {
          boxes[index] = seat;
          claimed += 1;
        }
      }
    }

    const finished = cells.every((owner) => owner !== -1);
    const [blue, green] = counts(boxes);

    return {
      ...state,
      cells,
      boxes,
      // Closing a box is another go. This is the whole game.
      turn: claimed > 0 ? seat : seat === 0 ? 1 : 0,
      winner: !finished ? null : blue! === green! ? -1 : blue! > green! ? 0 : 1,
      lastMove: move,
      moveCount: state.moveCount + 1,
    };
  },

  score: (state) => counts(state.boxes),
};
