/**
 * The ludo board: fifteen squares by fifteen, a cross, and eight tokens.
 *
 * The die is the part to be careful about. The number is the gateway's - it is
 * in the board that came back - and what happens here is a tumble that lands on
 * it. That order matters: a die animated first and reported afterwards would be
 * a client deciding its own sixes, and one animated to a *different* number
 * than the one in play would be worse, because both players would be reading a
 * different game off the same screen.
 *
 * So the sequence is: press roll, the gateway rolls, the board arrives with the
 * number in it, and this spins for a few hundred milliseconds before settling
 * on the number it was always going to settle on.
 */
import { useEffect, useRef, useState } from 'react';
import {
  GAMES,
  HOME,
  ROLL,
  SAFE,
  START,
  TOKENS,
  TRACK,
  YARD,
  dieOf,
  lastCapture,
  lastRoll,
  progressOf,
  tokenIndex,
  tokenMoves,
  type GameSession,
} from '@betweenus/shared-types';
import { canPlay, mySeat } from '../../stores/game';

/** The board is fifteen squares each way, and everything is in those units. */
const GRID = 15;

/**
 * The lap, square by square, clockwise from seat 0's starting square.
 *
 * Written out rather than generated: it is the shape of the cross, and a
 * generator for it is longer than the list and harder to check against a real
 * board.
 */
const PATH: [number, number][] = [
  // Along the left arm, outward edge
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  // Up the left side of the top arm
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  // Across the top
  [7, 0],
  // Down the right side of the top arm
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  // Along the right arm, upper edge
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  // Around the right point
  [14, 7],
  // Back along the right arm, lower edge
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  // Down the right side of the bottom arm
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  // Across the bottom
  [7, 14],
  // Up the left side of the bottom arm
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  // Back along the left arm, lower edge
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  // Around the left point, and back to the start
  [0, 7],
];

/** The five squares of each seat's home column, in walking order. */
const HOME_COLUMN: [number, number][][] = [
  [
    [1, 7],
    [2, 7],
    [3, 7],
    [4, 7],
    [5, 7],
  ],
  [
    [13, 7],
    [12, 7],
    [11, 7],
    [10, 7],
    [9, 7],
  ],
];

/** Where the four tokens wait, per seat. */
const YARD_SLOTS: [number, number][][] = [
  [
    [1.5, 1.5],
    [3.5, 1.5],
    [1.5, 3.5],
    [3.5, 3.5],
  ],
  [
    [10.5, 10.5],
    [12.5, 10.5],
    [10.5, 12.5],
    [12.5, 12.5],
  ],
];

/** The yards themselves, as blocks. */
const YARD_BLOCK: [number, number][] = [
  [0, 0],
  [9, 9],
];

/** How long the die tumbles before it shows what the gateway rolled. */
const TUMBLE_MS = 520;

interface Props {
  session: GameSession;
  onMove: (move: number, params?: number[]) => void;
}

export function LudoBoard({ session, onMove }: Props): JSX.Element {
  const { seatColours } = GAMES.ludo.definition;
  const seat = mySeat(session);
  const playable = new Set(seat === session.state.turn ? tokenMoves(session.state) : []);
  const captured = lastCapture(session.state);

  // The tumble: a face that changes quickly and then stops on the real one. It
  // is started by the *arrival* of a die, never by pressing the button, so what
  // it lands on is always what is in play.
  const roll = lastRoll(session.state);
  const [tumbling, setTumbling] = useState<number | null>(null);
  // Keyed on the *move count*, not on the die: the commonest roll in the game -
  // anything but a six with four tokens in the yard - is spent and cleared in
  // the same message it arrives in, so a tumble that waited for `dieOf` to
  // change never ran, and the number was never on screen at all. That was the
  // whole of "the dice roll does not work".
  const shown = useRef(-1);
  useEffect(() => {
    if (roll.value === 0 || session.state.moveCount === shown.current) {
      shown.current = session.state.moveCount;
      return undefined;
    }
    shown.current = session.state.moveCount;
    const spin = window.setInterval(() => setTumbling(1 + Math.floor(Math.random() * 6)), 60);
    const stop = window.setTimeout(() => {
      window.clearInterval(spin);
      setTumbling(null);
    }, TUMBLE_MS);
    return () => {
      window.clearInterval(spin);
      window.clearTimeout(stop);
      setTumbling(null);
    };
  }, [roll.value, session.state.moveCount]);

  const centreOf = (owner: number, token: number): { x: number; y: number } => {
    const progress = progressOf(session.state, owner, token);
    if (progress === YARD) {
      const slot = YARD_SLOTS[owner]![token]!;
      return { x: slot[0], y: slot[1] };
    }
    if (progress === HOME) {
      // Home, stacked slightly so four tokens in the middle are four tokens.
      return { x: 7.5 + (token - 1.5) * 0.16, y: 7.5 };
    }
    if (progress > 50) {
      const cell = HOME_COLUMN[owner]![progress - 51]!;
      return { x: cell[0] + 0.5, y: cell[1] + 0.5 };
    }
    const cell = PATH[(START[owner]! + progress) % TRACK]!;
    return { x: cell[0] + 0.5, y: cell[1] + 0.5 };
  };

  return (
    <div className="m-auto flex w-full max-w-[32rem] flex-col gap-2">
      <svg
        viewBox={`0 0 ${GRID} ${GRID}`}
        role="group"
        aria-label="Ludo board"
        className="aspect-square w-full rounded-lg bg-surface-950"
      >
        {/* The two yards. */}
        {YARD_BLOCK.map((block, owner) => (
          <g key={owner}>
            <rect
              x={block[0]}
              y={block[1]}
              width={6}
              height={6}
              rx={0.6}
              fill={`${seatColours[owner]}22`}
              stroke={seatColours[owner]}
              strokeWidth={0.08}
            />
            {YARD_SLOTS[owner]!.map((slot, index) => (
              <circle
                key={index}
                cx={slot[0]}
                cy={slot[1]}
                r={0.62}
                fill="#0f172a"
                stroke={`${seatColours[owner]}66`}
                strokeWidth={0.06}
              />
            ))}
          </g>
        ))}

        {/* The lap. A starred square is one nothing can be knocked off. */}
        {PATH.map((cell, index) => {
          const start = START.indexOf(index);
          const safe = SAFE.includes(index);
          return (
            <rect
              key={index}
              x={cell[0]}
              y={cell[1]}
              width={1}
              height={1}
              fill={start !== -1 ? `${seatColours[start]}55` : safe ? '#33415555' : '#1e293b'}
              stroke="#475569"
              strokeWidth={0.03}
            />
          );
        })}

        {/* The two home columns, in the colour of whoever walks up them. */}
        {HOME_COLUMN.map((column, owner) =>
          column.map((cell, index) => (
            <rect
              key={`${owner}-${index}`}
              x={cell[0]}
              y={cell[1]}
              width={1}
              height={1}
              fill={`${seatColours[owner]}77`}
              stroke="#475569"
              strokeWidth={0.03}
            />
          )),
        )}

        {/* Home. */}
        <rect x={6} y={6} width={3} height={3} fill="#0f172a" stroke="#475569" strokeWidth={0.04} />
        <polygon points="6,6 9,6 7.5,7.5" fill={`${seatColours[1]}99`} />
        <polygon points="6,9 9,9 7.5,7.5" fill={`${seatColours[0]}99`} />

        {/* The tokens. A playable one is ringed and takes a click; everything
            else is drawn and inert, including your own tokens on a turn where
            the number cannot move them. */}
        {[0, 1].map((owner) =>
          Array.from({ length: TOKENS }, (_, token) => {
            const at = centreOf(owner, token);
            const mineToPlay = owner === seat && playable.has(token) && canPlay(session, token);
            const justCaptured = captured === tokenIndex(owner, token);
            return (
              <g
                key={`${owner}-${token}`}
                onClick={mineToPlay ? () => onMove(token) : undefined}
                className={mineToPlay ? 'cursor-pointer' : ''}
              >
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={0.36}
                  fill={seatColours[owner]}
                  stroke={mineToPlay ? '#f8fafc' : justCaptured ? '#f87171' : '#0f172a'}
                  strokeWidth={mineToPlay ? 0.12 : 0.06}
                />
                {mineToPlay && (
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r={0.52}
                    fill="none"
                    stroke="#f8fafc"
                    strokeWidth={0.05}
                    strokeDasharray="0.2 0.16"
                  />
                )}
              </g>
            );
          }),
        )}
      </svg>

      <Die
        session={session}
        face={tumbling ?? roll.value}
        rolling={tumbling !== null}
        canRoll={canPlay(session, ROLL)}
        onRoll={() => onMove(ROLL)}
      />
    </div>
  );
}

/** Whoever is in a seat, or the colour's name when the chair is empty. */
function nameOf(session: GameSession, seat: number): string {
  if (seat < 0) return 'Nobody';
  return session.seats[seat]?.username ?? GAMES.ludo.definition.seatNames[seat] ?? 'They';
}

/** The die: a button before it is thrown, a face afterwards. */
function Die({
  session,
  face,
  rolling,
  canRoll,
  onRoll,
}: {
  session: GameSession;
  face: number;
  rolling: boolean;
  canRoll: boolean;
  onRoll: () => void;
}): JSX.Element {
  const { seatColours } = GAMES.ludo.definition;
  const roll = lastRoll(session.state);
  const pips: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [
      [0.28, 0.28],
      [0.72, 0.72],
    ],
    3: [
      [0.26, 0.26],
      [0.5, 0.5],
      [0.74, 0.74],
    ],
    4: [
      [0.28, 0.28],
      [0.72, 0.28],
      [0.28, 0.72],
      [0.72, 0.72],
    ],
    5: [
      [0.27, 0.27],
      [0.73, 0.27],
      [0.5, 0.5],
      [0.27, 0.73],
      [0.73, 0.73],
    ],
    6: [
      [0.28, 0.24],
      [0.72, 0.24],
      [0.28, 0.5],
      [0.72, 0.5],
      [0.28, 0.76],
      [0.72, 0.76],
    ],
  };

  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={onRoll}
        disabled={!canRoll}
        title={canRoll ? 'Roll' : 'Not your roll'}
        className={`flex h-14 w-14 items-center justify-center rounded-xl border transition-transform ${
          canRoll
            ? 'cursor-pointer border-white/30 bg-surface-800 hover:bg-white/[0.08] active:scale-95'
            : 'cursor-default border-white/10 bg-surface-900'
        } ${rolling ? 'animate-pulse' : ''}`}
      >
        {face > 0 ? (
          <svg viewBox="0 0 1 1" className="h-9 w-9">
            <rect x={0} y={0} width={1} height={1} rx={0.16} fill="#f8fafc" />
            {(pips[face] ?? []).map(([x, y], index) => (
              <circle key={index} cx={x} cy={y} r={0.085} fill="#0f172a" />
            ))}
          </svg>
        ) : (
          <span className="text-[11px] font-medium text-slate-400">Roll</span>
        )}
      </button>

      <p className="max-w-[15rem] text-[11px] leading-relaxed text-slate-500">
        {session.state.winner !== null
          ? 'That is the game.'
          : dieOf(session.state) > 0
            ? canPlay(session, tokenMoves(session.state)[0] ?? -1)
              ? 'Pick a token. A six gets one out of the yard, and gives you another go.'
              : `${session.seats[session.state.turn]?.username ?? 'They'} are choosing a token.`
            : roll.dead
              // The line that was missing. A roll nothing could take used to
              // clear itself and pass the turn in silence, which reads as a
              // button that did nothing at all.
              ? `${nameOf(session, roll.seat)} rolled ${roll.value} - nothing could take it, so the turn passed.`
              : roll.value > 0
                ? `${nameOf(session, roll.seat)} rolled ${roll.value}.`
                : 'The die is rolled by the server, so both of you get the same number - the tumble is only the animation.'}
      </p>
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ background: seatColours[session.state.turn] }}
      />
    </div>
  );
}
