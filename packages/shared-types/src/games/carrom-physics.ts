/**
 * The carrom board, as physics.
 *
 * Twenty discs on a square with four holes in the corners, sliding, colliding
 * and slowing down. This file is the simulation: rigid bodies, Coulomb
 * friction, elastic collisions with restitution, cushions, and a piece that
 * disappears when its centre reaches a pocket.
 *
 * ## Why the simulation is in the contract
 *
 * Because both ends run it, and they must agree exactly.
 *
 * The gateway runs it to decide what the board became - that is the refereeing,
 * and it is the only answer that counts. The client runs the *same function on
 * the same numbers* to animate the shot, because a shot that arrived as a set
 * of final positions would be twenty coins teleporting. What it shows is
 * therefore not a guess at the physics: it is the physics, replayed.
 *
 * That only works because this is deterministic. Fixed timestep, fixed
 * iteration order, no clock, no randomness, no `Set` iteration and no
 * floating-point that depends on how fast a machine is. Two IEEE-754 doubles
 * doing the same operations in the same order give the same answer on every
 * machine that will ever run this, so the last frame the client draws is the
 * position the gateway already sent.
 *
 * ## The units
 *
 * The playing surface is 1 x 1. Everything else is in fractions of it, taken
 * from a real board (74 cm playing area, 3.18 cm men, 4.13 cm striker, 4.45 cm
 * pockets), so the coins are the size they are relative to the board rather
 * than the size that felt right.
 */

/** Playing surface, corner to corner. Everything is a fraction of this. */
export const BOARD = 1;

/** A carrom man: 3.18 cm across on a 74 cm board. */
export const COIN_RADIUS = 0.0215;
/** The striker: 4.13 cm, and heavier, which is what makes a break work. */
export const STRIKER_RADIUS = 0.0279;
/** A pocket: 4.45 cm across, centred on the corner circle. */
export const POCKET_RADIUS = 0.0301;
/** How far a pocket's centre sits from each edge. */
export const POCKET_INSET = 0.043;

/** Grams. The ratio is what matters: a striker outweighs a man three to one. */
const COIN_MASS = 5.5;
const STRIKER_MASS = 15;

/**
 * Sliding friction, as a deceleration in board-widths per second squared.
 *
 * Coulomb rather than viscous - a real coin loses speed at a constant rate and
 * stops, where a `v *= 0.99` per step never quite does and leaves the board
 * creeping for ever. This is the number that decides whether a gentle shot
 * crosses the board, so it is the one to change if the board feels wrong.
 */
const FRICTION = 0.62;

/** Coin on coin. Ivory-ish: lively, not perfectly elastic. */
const RESTITUTION = 0.94;
/** Cushions take more out of a shot than a coin does. */
const WALL_RESTITUTION = 0.72;

/** Below this a piece has stopped, and the shot is over when they all have. */
const REST_SPEED = 0.012;

/** Fixed step. Small enough that a fast striker cannot pass through a coin. */
export const DT = 1 / 480;
/** Longest a shot may run before it is declared over, in seconds. */
const MAX_SECONDS = 9;
/** How many steps make one drawn frame, so a client animates at about 60 Hz. */
export const STEPS_PER_FRAME = 8;

/** One disc on the board. */
export interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  /** False once it has gone down a hole. It stops being simulated. */
  onBoard: boolean;
}

/** Where the four pockets are. Ordered, because everything here is ordered. */
export const POCKETS: { x: number; y: number }[] = [
  { x: POCKET_INSET, y: POCKET_INSET },
  { x: BOARD - POCKET_INSET, y: POCKET_INSET },
  { x: POCKET_INSET, y: BOARD - POCKET_INSET },
  { x: BOARD - POCKET_INSET, y: BOARD - POCKET_INSET },
];

/** What one shot did, once everything has stopped. */
export interface ShotResult {
  pieces: Piece[];
  /** Indices that went down a hole, in the order they did. */
  pocketed: number[];
  /** Every `STEPS_PER_FRAME`th step, for a client to animate. */
  frames: number[][];
  /** Whether the striker touched anything at all. Missing entirely is a foul. */
  contact: boolean;
}

function speedSquared(piece: Piece): number {
  return piece.vx * piece.vx + piece.vy * piece.vy;
}

/**
 * Runs a shot to a standstill.
 *
 * `frames` is the whole point of returning more than the final position: the
 * client draws them in order and the coins move the way they actually moved.
 * They are sampled rather than kept per step, because a nine-second shot at
 * 480 Hz is four thousand snapshots of twenty coins and only sixty of them a
 * second are ever drawn.
 */
export function simulate(input: Piece[], striker: number): ShotResult {
  const pieces = input.map((piece) => ({ ...piece }));
  const pocketed: number[] = [];
  const frames: number[][] = [];
  let contact = false;
  let step = 0;
  const maxSteps = Math.round(MAX_SECONDS / DT);

  while (step < maxSteps) {
    step += 1;

    // 1. Move, and slow down. Friction is applied along the direction of
    //    travel and clamped at zero, so a coin stops rather than reversing -
    //    which is what subtracting more than the remaining speed would do.
    for (const piece of pieces) {
      if (!piece.onBoard) continue;
      const speed = Math.sqrt(speedSquared(piece));
      if (speed > 0) {
        const drop = FRICTION * DT;
        const scale = speed > drop ? (speed - drop) / speed : 0;
        piece.vx *= scale;
        piece.vy *= scale;
      }
      piece.x += piece.vx * DT;
      piece.y += piece.vy * DT;
    }

    // 2. Cushions. Position is corrected as well as velocity, or a coin driven
    //    into a wall sticks to it: it would be pushed back in one step and out
    //    again the next, for ever.
    for (const piece of pieces) {
      if (!piece.onBoard) continue;
      if (piece.x - piece.radius < 0) {
        piece.x = piece.radius;
        piece.vx = Math.abs(piece.vx) * WALL_RESTITUTION;
      } else if (piece.x + piece.radius > BOARD) {
        piece.x = BOARD - piece.radius;
        piece.vx = -Math.abs(piece.vx) * WALL_RESTITUTION;
      }
      if (piece.y - piece.radius < 0) {
        piece.y = piece.radius;
        piece.vy = Math.abs(piece.vy) * WALL_RESTITUTION;
      } else if (piece.y + piece.radius > BOARD) {
        piece.y = BOARD - piece.radius;
        piece.vy = -Math.abs(piece.vy) * WALL_RESTITUTION;
      }
    }

    // 3. Collisions, every pair, in index order. Order matters for
    //    reproducibility far more than it matters for realism: a three-coin
    //    pile-up resolved in a different order is a different board.
    for (let a = 0; a < pieces.length; a += 1) {
      const first = pieces[a]!;
      if (!first.onBoard) continue;
      for (let b = a + 1; b < pieces.length; b += 1) {
        const second = pieces[b]!;
        if (!second.onBoard) continue;

        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const overlap = first.radius + second.radius - distance;
        if (overlap <= 0 || distance === 0) continue;

        const nx = dx / distance;
        const ny = dy / distance;

        // Push them apart in proportion to mass, so a struck coin moves more
        // than the striker does. Without this discs sink into each other and
        // the next step resolves the same collision again.
        const total = first.mass + second.mass;
        first.x -= nx * overlap * (second.mass / total);
        first.y -= ny * overlap * (second.mass / total);
        second.x += nx * overlap * (first.mass / total);
        second.y += ny * overlap * (first.mass / total);

        // Only the component along the line of centres is exchanged. The
        // tangential part is untouched, which is what makes a cut shot cut.
        const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
        if (relative > 0) continue;

        const impulse = (-(1 + RESTITUTION) * relative) / (1 / first.mass + 1 / second.mass);
        first.vx -= (impulse * nx) / first.mass;
        first.vy -= (impulse * ny) / first.mass;
        second.vx += (impulse * nx) / second.mass;
        second.vy += (impulse * ny) / second.mass;

        if (a === striker || b === striker) contact = true;
      }
    }

    // 4. Pockets. A piece is down when its *centre* is inside the hole, which
    //    is how a real one behaves - a coin overhanging the pocket stays up.
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index]!;
      if (!piece.onBoard) continue;
      for (const pocket of POCKETS) {
        const dx = piece.x - pocket.x;
        const dy = piece.y - pocket.y;
        if (dx * dx + dy * dy <= POCKET_RADIUS * POCKET_RADIUS) {
          piece.onBoard = false;
          piece.vx = 0;
          piece.vy = 0;
          pocketed.push(index);
          break;
        }
      }
    }

    if (step % STEPS_PER_FRAME === 0) frames.push(snapshot(pieces));

    // 5. Still? Then the shot is over. Checked after everything else so a
    //    collision in this very step is not mistaken for a standstill.
    let moving = false;
    for (const piece of pieces) {
      if (piece.onBoard && speedSquared(piece) > REST_SPEED * REST_SPEED) {
        moving = true;
        break;
      }
    }
    if (!moving) break;
  }

  // Anything still crawling is stopped, so the board the gateway stores is a
  // board at rest rather than one that would carry on if it were asked again.
  for (const piece of pieces) {
    piece.vx = 0;
    piece.vy = 0;
  }
  frames.push(snapshot(pieces));

  return { pieces, pocketed, frames, contact };
}

/** One frame: x, y and on-board for every piece, flat. */
function snapshot(pieces: Piece[]): number[] {
  const flat: number[] = [];
  for (const piece of pieces) {
    flat.push(piece.x, piece.y, piece.onBoard ? 1 : 0);
  }
  return flat;
}

/** A carrom man at rest. */
export function coin(x: number, y: number): Piece {
  return { x, y, vx: 0, vy: 0, radius: COIN_RADIUS, mass: COIN_MASS, onBoard: true };
}

/** The striker, aimed and struck. */
export function striker(x: number, y: number, vx: number, vy: number): Piece {
  return { x, y, vx, vy, radius: STRIKER_RADIUS, mass: STRIKER_MASS, onBoard: true };
}
