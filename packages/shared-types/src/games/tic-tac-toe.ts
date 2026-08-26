/**
 * Tic-tac-toe: nine squares, and the shortest game in the library.
 *
 * It is here because it is the one everybody already knows the rules of, which
 * makes it the game that proves the machinery rather than the game anybody
 * plays twice: two people who have never used this before can tell within one
 * move whether the turn order, the board and the "your move" line are right.
 */
import type { GameRules, GameState } from './types';

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function create(): GameState {
  return {
    gameId: 'tic-tac-toe',
    cells: Array<number>(9).fill(-1),
    boxes: [],
    turn: 0,
    winner: null,
    lastMove: null,
    moveCount: 0,
  };
}

/** The seat holding a full line, or null. */
export function lineWinner(cells: number[]): number | null {
  for (const [a, b, c] of LINES) {
    const owner = cells[a!]!;
    if (owner !== -1 && owner === cells[b!] && owner === cells[c!]) return owner;
  }
  return null;
}

/** The three squares that won it, for the board to draw a stroke through. */
export function winningLine(cells: number[]): number[] | null {
  for (const line of LINES) {
    const owner = cells[line[0]!]!;
    if (owner !== -1 && owner === cells[line[1]!] && owner === cells[line[2]!]) return line;
  }
  return null;
}

export const ticTacToe: GameRules = {
  definition: {
    id: 'tic-tac-toe',
    name: 'Tic-tac-toe',
    blurb: 'Three in a row. Over in a minute, and everybody already knows how.',
    seats: 2,
    seatNames: ['X', 'O'],
    seatColours: ['#38bdf8', '#fb7185'],
    length: '1 min',
  },

  create,

  moves: (state) => {
    if (state.winner !== null) return [];
    return state.cells.flatMap((owner, index) => (owner === -1 ? [index] : []));
  },

  apply: (state, seat, move) => {
    if (state.winner !== null) return null;
    if (seat !== state.turn) return null;
    if (!Number.isInteger(move) || move < 0 || move >= 9) return null;
    if (state.cells[move] !== -1) return null;

    const cells = [...state.cells];
    cells[move] = seat;
    const won = lineWinner(cells);
    const moveCount = state.moveCount + 1;
    return {
      ...state,
      cells,
      // A draw is a full board with no line, and it is worth spelling out
      // rather than leaving the game to sit there finished-but-not-over: a
      // board nobody can play on and nobody has won reads as a bug.
      winner: won !== null ? won : moveCount === 9 ? -1 : null,
      turn: seat === 0 ? 1 : 0,
      lastMove: move,
      moveCount,
    };
  },

  score: (state) => [
    state.cells.filter((owner) => owner === 0).length,
    state.cells.filter((owner) => owner === 1).length,
  ],
};
