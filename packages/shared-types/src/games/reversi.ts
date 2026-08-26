/**
 * Reversi: eight by eight, and the only game here where a turn can be skipped.
 *
 * The pass is the part worth reading. A player with no legal move does not sit
 * there being asked for one - the rules hand the turn back, and the board says
 * so. Leaving the pass to a button would be a game that can deadlock on the
 * person who does not know they have to press it, which is the sort of rule
 * that is obvious at the table and invisible on a screen.
 */
import type { GameRules, GameState } from './types';

export const SIZE = 8;

const DIRECTIONS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

/** Index of the square at row `r`, column `c`. */
export function at(r: number, c: number): number {
  return r * SIZE + c;
}

function create(): GameState {
  const cells = Array<number>(SIZE * SIZE).fill(-1);
  // The standard opening four, diagonally opposed. Seat 0 is black and moves
  // first, as it does everywhere this game is played.
  cells[at(3, 3)] = 1;
  cells[at(3, 4)] = 0;
  cells[at(4, 3)] = 0;
  cells[at(4, 4)] = 1;
  return {
    gameId: 'reversi',
    cells,
    boxes: [],
    data: [],
    turn: 0,
    winner: null,
    lastMove: null,
    moveCount: 0,
  };
}

/**
 * The discs a move would turn over, in every direction at once. Empty means the
 * move is illegal: capturing nothing is not a move in this game.
 */
export function flips(cells: number[], seat: number, move: number): number[] {
  if (cells[move] !== -1) return [];
  const r0 = Math.floor(move / SIZE);
  const c0 = move % SIZE;
  const taken: number[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    const run: number[] = [];
    let r = r0 + dr!;
    let c = c0 + dc!;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
      const owner = cells[at(r, c)]!;
      if (owner === -1) break;
      if (owner === seat) {
        // Bracketed: everything between the two of ours turns over.
        taken.push(...run);
        break;
      }
      run.push(at(r, c));
      r += dr!;
      c += dc!;
    }
  }
  return taken;
}

/** Every square `seat` may play, whether or not it is their turn. */
export function movesFor(cells: number[], seat: number): number[] {
  const legal: number[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] !== -1) continue;
    if (flips(cells, seat, index).length > 0) legal.push(index);
  }
  return legal;
}

function counts(cells: number[]): number[] {
  return [
    cells.filter((owner) => owner === 0).length,
    cells.filter((owner) => owner === 1).length,
  ];
}

export const reversi: GameRules = {
  definition: {
    id: 'reversi',
    name: 'Reversi',
    blurb: 'Trap a line of their discs and every one of them turns over.',
    seats: 2,
    seatNames: ['Black', 'White'],
    seatColours: ['#1e293b', '#e2e8f0'],
    length: '10 min',
  },

  create,

  moves: (state) => (state.winner === null ? movesFor(state.cells, state.turn) : []),

  apply: (state, seat, move) => {
    if (state.winner !== null) return null;
    if (seat !== state.turn) return null;
    if (!Number.isInteger(move) || move < 0 || move >= SIZE * SIZE) return null;

    const turned = flips(state.cells, seat, move);
    if (turned.length === 0) return null;

    const cells = [...state.cells];
    cells[move] = seat;
    for (const index of turned) cells[index] = seat;

    // Who is to move next is a rule and not an alternation: the turn goes to
    // the opponent if they have anything to play, stays put if they do not,
    // and the game is over when neither of them has.
    const other = seat === 0 ? 1 : 0;
    const opponentCanPlay = movesFor(cells, other).length > 0;
    const moverCanPlay = movesFor(cells, seat).length > 0;
    const [black, white] = counts(cells);

    return {
      ...state,
      cells,
      turn: opponentCanPlay ? other : seat,
      winner:
        opponentCanPlay || moverCanPlay
          ? null
          : black! === white!
            ? -1
            : black! > white!
              ? 0
              : 1,
      lastMove: move,
      moveCount: state.moveCount + 1,
    };
  },

  score: (state) => counts(state.cells),
};
