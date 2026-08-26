/**
 * Carrom: nineteen men, a striker, and four holes.
 *
 * The rules are here; the physics is in `carrom-physics.ts`, and the split is
 * the interesting part. A move in this game is not a square - it is a shot:
 * where the striker sits on your baseline, which way it is pointed and how hard
 * it is hit. Three numbers, sent as `params`. What the board *becomes* is then
 * not a decision anybody makes - it is what nine seconds of sliding, colliding
 * and slowing down produce, and it is produced identically by the gateway (to
 * referee it) and by every client (to draw it).
 *
 * That is why this game can exist at all in a design where a client never sends
 * a board. The shot is small enough to relay and the result is reproducible, so
 * the gateway can check the aim and run the physics itself. A client that sent
 * twenty coin positions would be a client that can put every coin in a pocket.
 *
 * ## What is simplified
 *
 * The queen rule is the real one in outline: pocket the queen and you must
 * cover her with one of your own, or she goes back to the centre. Everything
 * around the edges of tournament carrom - the due, the board fouls, the three
 * consecutive fouls, the last-coin rule - is not here. This is the game two
 * people play on a table, not the one with an umpire.
 */
import {
  BOARD,
  COIN_RADIUS,
  STRIKER_RADIUS,
  simulate,
  striker as makeStriker,
  type Piece,
  type ShotResult,
} from './carrom-physics';
import type { GameRules, GameState } from './types';

/** Nine a side, the queen, and the striker - in that order, always. */
export const WHITE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
export const BLACK = [9, 10, 11, 12, 13, 14, 15, 16, 17];
export const QUEEN = 18;
export const STRIKER = 19;
export const PIECES = 20;

/** Three numbers per piece - x, y, still-on-the-board - then the tail below. */
const TAIL = PIECES * 3;
/** Which seat owns the queen, or -1. */
const QUEEN_OWNER = TAIL;
/** Which seat pocketed the queen and has yet to cover her, or -1. */
const QUEEN_PENDING = TAIL + 1;
/** The shot that produced this board: seat, striker x, angle, power. */
const SHOT_SEAT = TAIL + 2;
const SHOT_X = TAIL + 3;
const SHOT_ANGLE = TAIL + 4;
const SHOT_POWER = TAIL + 5;
/** Whether that shot was a foul, so the board can say so without re-deciding. */
const SHOT_FOUL = TAIL + 6;
const DATA_LENGTH = TAIL + 7;

/** How far the baseline sits from the near edge. */
export const BASELINE = 0.115;
/** How far along the baseline the striker may be placed, either way of centre. */
export const BASELINE_HALF_WIDTH = 0.25;

/** The slowest and fastest a striker may be sent, in board-widths per second. */
const MIN_SPEED = 0.35;
const MAX_SPEED = 2.6;

/** The queen counts three, as she does everywhere. */
export const QUEEN_VALUE = 3;

function create(): GameState {
  const data = Array<number>(DATA_LENGTH).fill(0);
  const centre = BOARD / 2;

  // The standard opening circle: the queen in the middle, six alternating men
  // around her touching, then twelve alternating around those. Built from the
  // geometry rather than from a table of coordinates, so it stays right if the
  // coin size ever changes.
  const layout: { index: number; x: number; y: number }[] = [];
  layout.push({ index: QUEEN, x: centre, y: centre });

  let white = 0;
  let black = 0;
  const rings: { count: number; radius: number; offset: number }[] = [
    { count: 6, radius: COIN_RADIUS * 2, offset: 0 },
    { count: 12, radius: COIN_RADIUS * 4, offset: Math.PI / 12 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i += 1) {
      const angle = ring.offset + (i * 2 * Math.PI) / ring.count;
      // Alternating, which is what makes a break scatter both colours.
      const index = i % 2 === 0 ? WHITE[white++]! : BLACK[black++]!;
      layout.push({
        index,
        x: centre + Math.cos(angle) * ring.radius,
        y: centre + Math.sin(angle) * ring.radius,
      });
    }
  }

  for (const piece of layout) {
    data[piece.index * 3] = piece.x;
    data[piece.index * 3 + 1] = piece.y;
    data[piece.index * 3 + 2] = 1;
  }
  // The striker starts off the board: it is placed by whoever is shooting, and
  // a striker sitting on the baseline before anybody has aimed is a coin in the
  // way of the break.
  data[STRIKER * 3] = centre;
  data[STRIKER * 3 + 1] = BOARD - BASELINE;
  data[STRIKER * 3 + 2] = 0;

  data[QUEEN_OWNER] = -1;
  data[QUEEN_PENDING] = -1;
  data[SHOT_SEAT] = -1;
  data[SHOT_FOUL] = 0;

  return {
    gameId: 'carrom',
    cells: [],
    boxes: [],
    data,
    turn: 0,
    winner: null,
    lastMove: null,
    moveCount: 0,
  };
}

/** The board as the physics wants it: twenty pieces, striker last. */
export function carromPieces(state: GameState): Piece[] {
  const pieces: Piece[] = [];
  for (let index = 0; index < PIECES; index += 1) {
    const radius = index === STRIKER ? STRIKER_RADIUS : COIN_RADIUS;
    pieces.push({
      x: state.data[index * 3] ?? 0,
      y: state.data[index * 3 + 1] ?? 0,
      vx: 0,
      vy: 0,
      radius,
      mass: index === STRIKER ? 15 : 5.5,
      onBoard: (state.data[index * 3 + 2] ?? 0) === 1,
    });
  }
  return pieces;
}

/** Which colour a seat plays. Seat 0 is white, as it is on a real board. */
export function coinsOf(seat: number): number[] {
  return seat === 0 ? WHITE : BLACK;
}

/** The line a seat shoots from: the near edge, from their point of view. */
export function baselineY(seat: number): number {
  return seat === 0 ? BOARD - BASELINE : BASELINE;
}

/** Which seat holds the queen, or -1 while she is on the board. */
export function queenOwner(state: GameState): number {
  return state.data[QUEEN_OWNER] ?? -1;
}

/** Which seat has pocketed the queen and still has to cover her, or -1. */
export function queenPending(state: GameState): number {
  return state.data[QUEEN_PENDING] ?? -1;
}

/** The shot that made this board: seat, x, angle, power - or null at the start. */
export function lastShot(
  state: GameState,
): { seat: number; x: number; angle: number; power: number; foul: boolean } | null {
  const seat = state.data[SHOT_SEAT] ?? -1;
  if (seat < 0) return null;
  return {
    seat,
    x: state.data[SHOT_X] ?? 0,
    angle: state.data[SHOT_ANGLE] ?? 0,
    power: state.data[SHOT_POWER] ?? 0,
    foul: (state.data[SHOT_FOUL] ?? 0) === 1,
  };
}

/**
 * Where the striker ends up when a seat asks for `x` along its baseline.
 *
 * Clamped rather than refused, and then nudged clear of anything sitting in the
 * way: a striker placed inside a coin is a shot that begins by exploding, and
 * a refusal here would be a legal-looking aim that silently does nothing.
 */
export function placeStriker(state: GameState, seat: number, x: number): { x: number; y: number } {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
  const y = baselineY(seat);
  const wanted = BOARD / 2 + clamped * BASELINE_HALF_WIDTH;

  const blocked = (at: number): boolean => {
    for (let index = 0; index < PIECES; index += 1) {
      if (index === STRIKER) continue;
      if ((state.data[index * 3 + 2] ?? 0) !== 1) continue;
      const dx = (state.data[index * 3] ?? 0) - at;
      const dy = (state.data[index * 3 + 1] ?? 0) - y;
      const reach = COIN_RADIUS + STRIKER_RADIUS;
      if (dx * dx + dy * dy < reach * reach) return true;
    }
    return false;
  };

  if (!blocked(wanted)) return { x: wanted, y };
  // Out from where they asked, both ways, in coin-widths. The first free spot
  // wins, so the striker lands as near as it can to the aim that was taken.
  for (let step = 1; step <= 40; step += 1) {
    const offset = step * COIN_RADIUS * 0.5;
    for (const candidate of [wanted - offset, wanted + offset]) {
      const limit = BOARD / 2 + BASELINE_HALF_WIDTH;
      if (candidate < BOARD / 2 - BASELINE_HALF_WIDTH || candidate > limit) continue;
      if (!blocked(candidate)) return { x: candidate, y };
    }
  }
  return { x: wanted, y };
}

/**
 * The direction a shot actually goes, given the angle asked for.
 *
 * Clamped into the half of the circle that points away from the shooter,
 * because a striker sent backwards is a coin in your own pocket and there is no
 * shot in carrom that means it.
 */
export function aimOf(seat: number, angle: number): { vxUnit: number; vyUnit: number } {
  const safe = Number.isFinite(angle) ? angle : -Math.PI / 2;
  let vx = Math.cos(safe);
  let vy = Math.sin(safe);
  // Seat 0 sits at the bottom of the board and plays up the screen, which is
  // negative y; seat 1 is the other way round.
  const forward = seat === 0 ? -1 : 1;
  if (Math.sign(vy) !== forward) {
    // Reflect rather than refuse: the nearest legal aim is the one along the
    // baseline, which is what a person pointing sideways meant.
    vy = 0.0001 * forward;
    const length = Math.sqrt(vx * vx + vy * vy);
    vx /= length;
    vy /= length;
  }
  return { vxUnit: vx, vyUnit: vy };
}

/**
 * Runs one shot, without deciding anything about the rules.
 *
 * Exported because the client draws with it: given the board before the shot
 * and the three numbers that describe it, this returns the frames the coins
 * actually moved through. The gateway calls the same function for the same
 * reason it applies the same rules - so the last frame a client draws is the
 * board the gateway already sent.
 */
export function carromShot(state: GameState, seat: number, params: number[]): ShotResult {
  const [x = 0, angle = -Math.PI / 2, power = 0.5] = params;
  const place = placeStriker(state, seat, x);
  const { vxUnit, vyUnit } = aimOf(seat, angle);
  const clampedPower = Math.max(0, Math.min(1, Number.isFinite(power) ? power : 0));
  const speed = MIN_SPEED + clampedPower * (MAX_SPEED - MIN_SPEED);

  const pieces = carromPieces(state);
  pieces[STRIKER] = makeStriker(place.x, place.y, vxUnit * speed, vyUnit * speed);
  return simulate(pieces, STRIKER);
}

function writePieces(data: number[], pieces: Piece[]): void {
  for (let index = 0; index < PIECES; index += 1) {
    const piece = pieces[index]!;
    data[index * 3] = piece.x;
    data[index * 3 + 1] = piece.y;
    data[index * 3 + 2] = piece.onBoard ? 1 : 0;
  }
}

/** Puts a coin back near the centre, in the first free spot spiralling out. */
function returnToCentre(data: number[], index: number): void {
  const centre = BOARD / 2;
  const free = (x: number, y: number): boolean => {
    for (let other = 0; other < PIECES; other += 1) {
      if (other === index || other === STRIKER) continue;
      if ((data[other * 3 + 2] ?? 0) !== 1) continue;
      const dx = (data[other * 3] ?? 0) - x;
      const dy = (data[other * 3 + 1] ?? 0) - y;
      if (dx * dx + dy * dy < (COIN_RADIUS * 2) ** 2) return false;
    }
    return true;
  };

  for (let ring = 0; ring < 12; ring += 1) {
    const radius = ring * COIN_RADIUS * 2;
    const points = ring === 0 ? 1 : ring * 6;
    for (let i = 0; i < points; i += 1) {
      const angle = (i * 2 * Math.PI) / points;
      const x = centre + Math.cos(angle) * radius;
      const y = centre + Math.sin(angle) * radius;
      if (free(x, y)) {
        data[index * 3] = x;
        data[index * 3 + 1] = y;
        data[index * 3 + 2] = 1;
        return;
      }
    }
  }
}

function pocketedCount(data: number[], indices: number[]): number {
  return indices.filter((index) => (data[index * 3 + 2] ?? 0) === 0).length;
}

export const carrom: GameRules = {
  definition: {
    id: 'carrom',
    name: 'Carrom',
    blurb: 'Flick the striker, sink your nine, and cover the queen. Real physics.',
    seats: 2,
    seatNames: ['White', 'Black'],
    seatColours: ['#f8fafc', '#334155'],
    length: '15 min',
  },

  aimed: true,

  create,

  // One kind of move - a shot - and the aim rides in `params`. The board draws
  // the aiming line itself, so there is nothing here to enumerate.
  moves: (state) => (state.winner === null ? [0] : []),

  apply: (state, seat, move, params) => {
    if (state.winner !== null) return null;
    if (seat !== state.turn) return null;
    if (move !== 0) return null;
    if (!params || params.length < 3) return null;
    if (!params.every((value) => Number.isFinite(value))) return null;
    // A shot with no power is not a shot. Refusing it beats a turn spent on a
    // striker that did not move.
    if ((params[2] ?? 0) <= 0.02) return null;

    const result = carromShot(state, seat, params);
    const data = [...state.data];
    writePieces(data, result.pieces);

    const mine = coinsOf(seat);
    const minePocketed = result.pocketed.filter((index) => mine.includes(index));
    const strikerDown = result.pocketed.includes(STRIKER);
    const queenDown = result.pocketed.includes(QUEEN);
    // Nothing touched at all: the striker crossed the board and hit nobody.
    // That is a foul everywhere the game is played.
    const foul = strikerDown || !result.contact;

    let owner = data[QUEEN_OWNER] ?? -1;
    let pending = data[QUEEN_PENDING] ?? -1;

    if (queenDown && owner === -1) {
      // Pocketed with one of your own in the same shot: she is covered, and
      // she is yours. Otherwise she waits on the next shot to be covered.
      if (minePocketed.length > 0 && !foul) {
        owner = seat;
        pending = -1;
      } else {
        pending = seat;
      }
    } else if (pending === seat) {
      if (minePocketed.length > 0 && !foul) {
        owner = seat;
        pending = -1;
      } else {
        // Uncovered. She goes back to the middle and the board is as it was
        // before anybody took her.
        returnToCentre(data, QUEEN);
        pending = -1;
      }
    }

    if (strikerDown) {
      // The penalty: one of your own comes back out. Nothing to give back is
      // simply a foul with no coin to pay it with.
      const paid = mine.find((index) => (data[index * 3 + 2] ?? 0) === 0);
      if (paid !== undefined) returnToCentre(data, paid);
    }

    // The striker never stays on the board between shots: it is placed by
    // whoever shoots next, on their own line.
    data[STRIKER * 3 + 2] = 0;

    data[QUEEN_OWNER] = owner;
    data[QUEEN_PENDING] = pending;
    data[SHOT_SEAT] = seat;
    data[SHOT_X] = params[0] ?? 0;
    data[SHOT_ANGLE] = params[1] ?? 0;
    data[SHOT_POWER] = params[2] ?? 0;
    data[SHOT_FOUL] = foul ? 1 : 0;

    // Pocket one of yours and you shoot again - which is the whole rhythm of
    // the game, and the reason a good player's turn lasts a while.
    const again = !foul && minePocketed.length > 0;

    const cleared = pocketedCount(data, mine) === mine.length;
    // Clearing your colour wins it. A tournament would make you take the queen
    // before your last coin; here she is awarded to whoever clears if she is
    // still unclaimed, which keeps the game from ending with nobody holding
    // her.
    let winner: number | null = null;
    if (cleared) {
      if (owner === -1) {
        owner = seat;
        data[QUEEN_OWNER] = seat;
        data[QUEEN_PENDING] = -1;
        data[QUEEN * 3 + 2] = 0;
      }
      winner = seat;
    }

    return {
      ...state,
      data,
      turn: again ? seat : seat === 0 ? 1 : 0,
      winner,
      lastMove: 0,
      moveCount: state.moveCount + 1,
    };
  },

  score: (state) => {
    const owner = state.data[QUEEN_OWNER] ?? -1;
    return [0, 1].map(
      (seat) =>
        pocketedCount(state.data, coinsOf(seat)) + (owner === seat ? QUEEN_VALUE : 0),
    );
  },
};
