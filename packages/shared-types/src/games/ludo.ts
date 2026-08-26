/**
 * Ludo: four tokens each, one die, and a lap of the board.
 *
 * The die is the only thing in this library that is not decided by the people
 * playing, and it is worth being exact about who decides it. **The gateway
 * rolls.** `apply` takes a `random` from whoever is refereeing, so the number
 * comes from one place, once. A client that rolled its own would be a client
 * that decides its own sixes; a client that *animated* its own would be one
 * where the die on screen and the die in the game are two different dice.
 *
 * So the roll is a move like any other - "I roll" - and the answer comes back
 * in the board. The tumbling die a client draws afterwards is an animation of a
 * number that has already been decided, exactly as the carrom shot is an
 * animation of a shot that has already been simulated.
 *
 * Two players, four tokens each. Four-seat ludo needs the turn to skip empty
 * chairs, which the rules cannot see - they are handed a board, not a table -
 * so it is a change to the session rather than to this file, and it is written
 * down in `TODO.md` rather than half-built here.
 */
import type { GameRules, GameState, RandomSource } from './types';

/** Squares in the lap. */
export const TRACK = 52;
/** Tokens per player. */
export const TOKENS = 4;
/** The last square of the lap, counted from a player's own starting square. */
export const LAST_TRACK_STEP = 50;
/** Home: five squares up the column, then the middle. */
export const HOME = 56;
/** In the yard, waiting for a six. */
export const YARD = -1;

/** Where each seat joins the lap. Opposite each other, as they are on a board. */
export const START = [0, 26];

/**
 * The squares nothing can be knocked off.
 *
 * The two starting squares and the two eight along from them, which is where
 * the stars are printed on a real board.
 */
export const SAFE = [0, 8, 26, 34];

/** Rolling the die is a move, and this is its index. Tokens are 0-3. */
export const ROLL = 4;

const DIE = TOKENS * 2;
const SIXES = DIE + 1;
const LAST_TOKEN = DIE + 2;
const LAST_CAPTURE = DIE + 3;
const DATA_LENGTH = DIE + 4;

function create(): GameState {
  const data = Array<number>(DATA_LENGTH).fill(0);
  for (let token = 0; token < TOKENS * 2; token += 1) data[token] = YARD;
  data[DIE] = 0;
  data[SIXES] = 0;
  data[LAST_TOKEN] = -1;
  data[LAST_CAPTURE] = -1;
  return {
    gameId: 'ludo',
    cells: [],
    boxes: [],
    data,
    turn: 0,
    winner: null,
    lastMove: null,
    moveCount: 0,
  };
}

/** The index into `data` of a seat's nth token. */
export function tokenIndex(seat: number, token: number): number {
  return seat * TOKENS + token;
}

/** How far a token has come: -1 in the yard, 56 home, anything between on the way. */
export function progressOf(state: GameState, seat: number, token: number): number {
  return state.data[tokenIndex(seat, token)] ?? YARD;
}

/** The die showing, or 0 when it has not been rolled this turn. */
export function dieOf(state: GameState): number {
  return state.data[DIE] ?? 0;
}

/** The token that last moved, as a `data` index, or -1. */
export function lastTokenMoved(state: GameState): number {
  return state.data[LAST_TOKEN] ?? -1;
}

/** The token last sent back to the yard, as a `data` index, or -1. */
export function lastCapture(state: GameState): number {
  return state.data[LAST_CAPTURE] ?? -1;
}

/**
 * Which square of the lap a token is standing on, or -1 when it is in the yard
 * or in its home column.
 *
 * The lap is shared, so this is the only coordinate where two seats can meet -
 * and therefore the only one a capture can happen on.
 */
export function trackSquare(seat: number, progress: number): number {
  if (progress < 0 || progress > LAST_TRACK_STEP) return -1;
  return (START[seat]! + progress) % TRACK;
}

/** Whether a token at `progress` can move `die` squares. */
function canMove(state: GameState, seat: number, token: number, die: number): boolean {
  const progress = progressOf(state, seat, token);
  if (progress === HOME) return false;
  // Out of the yard on a six, and only on a six.
  if (progress === YARD) return die === 6;
  // Home has to be reached exactly. Overshooting is a move that is not
  // available, which is what makes the end of a game take a while.
  return progress + die <= HOME;
}

/** Every token of the seat to move that could take the die that is showing. */
export function tokenMoves(state: GameState): number[] {
  const die = dieOf(state);
  if (die === 0) return [];
  const moves: number[] = [];
  for (let token = 0; token < TOKENS; token += 1) {
    if (canMove(state, state.turn, token, die)) moves.push(token);
  }
  return moves;
}

function tokensHome(state: GameState, seat: number): number {
  let count = 0;
  for (let token = 0; token < TOKENS; token += 1) {
    if (progressOf(state, seat, token) === HOME) count += 1;
  }
  return count;
}

export const ludo: GameRules = {
  definition: {
    id: 'ludo',
    name: 'Ludo',
    blurb: 'Four tokens, one die, and a long way round. Sixes get you out.',
    seats: 2,
    seatNames: ['Red', 'Blue'],
    seatColours: ['#ef4444', '#3b82f6'],
    length: '20 min',
  },

  chance: true,

  create,

  moves: (state) => {
    if (state.winner !== null) return [];
    // Nothing to choose until the die has been thrown, and the throw is itself
    // the move - so a board with no die showing has exactly one button on it.
    if (dieOf(state) === 0) return [ROLL];
    return tokenMoves(state);
  },

  apply: (state, seat, move, _params, random?: RandomSource) => {
    if (state.winner !== null) return null;
    if (seat !== state.turn) return null;

    const die = dieOf(state);
    const data = [...state.data];
    const other = seat === 0 ? 1 : 0;

    if (move === ROLL) {
      // One roll per turn. A second is either a double-click or a client that
      // has decided it would like a better number.
      if (die !== 0) return null;
      const source = random ?? Math.random;
      const rolled = 1 + Math.floor(Math.min(0.999999, Math.max(0, source())) * 6);
      const sixes = rolled === 6 ? (state.data[SIXES] ?? 0) + 1 : 0;

      data[LAST_CAPTURE] = -1;
      data[LAST_TOKEN] = -1;

      // Three sixes and the turn is gone. Without it, a run of sixes is a run
      // of free moves and the rule everybody plays by is missing.
      if (sixes >= 3) {
        data[DIE] = 0;
        data[SIXES] = 0;
        return {
          ...state,
          data,
          turn: other,
          lastMove: ROLL,
          moveCount: state.moveCount + 1,
        };
      }

      data[DIE] = rolled;
      data[SIXES] = sixes;

      // Nothing this number can do: the turn passes without anybody having to
      // press a button that does nothing. A board that waited for a click on an
      // empty set of options is a board that has stopped.
      const playable = tokenMoves({ ...state, data, turn: seat });
      if (playable.length === 0) {
        data[DIE] = 0;
        data[SIXES] = 0;
        return {
          ...state,
          data,
          turn: other,
          lastMove: ROLL,
          moveCount: state.moveCount + 1,
        };
      }

      return { ...state, data, lastMove: ROLL, moveCount: state.moveCount + 1 };
    }

    if (die === 0) return null;
    if (!Number.isInteger(move) || move < 0 || move >= TOKENS) return null;
    if (!canMove(state, seat, move, die)) return null;

    const index = tokenIndex(seat, move);
    const from = data[index] ?? YARD;
    const to = from === YARD ? 0 : from + die;
    data[index] = to;
    data[LAST_TOKEN] = index;
    data[LAST_CAPTURE] = -1;

    // A capture is only possible on the shared lap, and only off the starred
    // squares. Landing on your own token is nothing at all - a real board would
    // stack them, and stacking changes no rule that matters here.
    let captured = false;
    const square = trackSquare(seat, to);
    if (square !== -1 && !SAFE.includes(square)) {
      for (let token = 0; token < TOKENS; token += 1) {
        const theirs = tokenIndex(other, token);
        const theirProgress = data[theirs] ?? YARD;
        if (theirProgress < 0 || theirProgress > LAST_TRACK_STEP) continue;
        if (trackSquare(other, theirProgress) !== square) continue;
        data[theirs] = YARD;
        data[LAST_CAPTURE] = theirs;
        captured = true;
      }
    }

    data[DIE] = 0;

    const home = tokensHome({ ...state, data }, seat) === TOKENS;
    // Another go for a six, for a capture, and for bringing one home. All three
    // are the rules people actually play; the six is the one that makes the
    // difference between a game and a queue.
    const again = die === 6 || captured || to === HOME;
    if (!again) data[SIXES] = 0;

    return {
      ...state,
      data,
      turn: again ? seat : other,
      winner: home ? seat : null,
      lastMove: move,
      moveCount: state.moveCount + 1,
    };
  },

  score: (state) => [0, 1].map((seat) => tokensHome(state, seat)),
};
