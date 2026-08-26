/**
 * The carrom board: nineteen men, four pockets, and an aim.
 *
 * Two things here are worth reading before the code.
 *
 * **The animation is the physics, not an impression of it.** When a shot comes
 * back from the gateway, this does not tween the coins from where they were to
 * where they ended up. It takes the board as it was *before* the shot, runs the
 * same simulation the gateway ran with the same three numbers, and draws the
 * frames that come out. The last of those frames is the board the gateway
 * already sent, because the simulation is deterministic - so the animation
 * cannot end anywhere except the truth.
 *
 * **The aim is a drag, backwards.** Pull away from the striker and let go, the
 * way a real flick works and the way every pool game already taught everybody's
 * hands. Distance is power. The striker itself slides along your own baseline,
 * dragged left and right, which is the other half of a carrom shot and the half
 * that a board without it makes impossible.
 */
import { useEffect, useRef, useState } from 'react';
import {
  BASELINE_HALF_WIDTH,
  BOARD,
  COIN_RADIUS,
  POCKETS,
  POCKET_RADIUS,
  QUEEN,
  STRIKER,
  STRIKER_RADIUS,
  baselineY,
  carromPieces,
  carromShot,
  coinsOf,
  lastShot,
  placeStriker,
  queenPending,
  type GameSession,
  type GameState,
} from '@betweenus/shared-types';
import { canPlay, mySeat } from '../../stores/game';

/** Frames arrive at 60 a second, which is what the simulation samples at. */
const FRAME_MS = 1000 / 60;

/** Under this, a drag is a tap and not a shot. In board widths. */
const MIN_DRAG = 0.04;
/** A pull this long is full power. Longer is still full power. */
const MAX_DRAG = 0.42;

interface Props {
  session: GameSession;
  onMove: (move: number, params?: number[]) => void;
}

interface Aim {
  /** Where along the baseline the striker is, -1 to 1. */
  x: number;
  /** Where the pointer is, in board coordinates, while dragging. */
  pullX: number | null;
  pullY: number | null;
}

export function CarromBoard({ session, onMove }: Props): JSX.Element {
  const seat = mySeat(session);
  const mine = canPlay(session, 0);
  const [aim, setAim] = useState<Aim>({ x: 0, pullX: null, pullY: null });
  /** The frames of the shot being replayed, or null when the board is at rest. */
  const [frame, setFrame] = useState<number[] | null>(null);
  const before = useRef<GameState | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  // Replay whatever the gateway just refereed. `before` is this window's own
  // copy of the board as it was, which is the one thing needed to reproduce a
  // shot from the three numbers that describe it.
  useEffect(() => {
    const previous = before.current;
    before.current = session.state;
    const shot = lastShot(session.state);
    if (!previous || !shot) return undefined;
    if (session.state.moveCount <= previous.moveCount) return undefined;

    const result = carromShot(previous, shot.seat, [shot.x, shot.angle, shot.power]);
    let index = 0;
    const timer = window.setInterval(() => {
      const next = result.frames[index];
      index += 1;
      if (!next) {
        window.clearInterval(timer);
        // Back to drawing the state itself. The last frame and the state are
        // the same board, so nothing jumps - but the state is the one that
        // carries a coin returned to the centre after a foul.
        setFrame(null);
        return;
      }
      setFrame(next);
    }, FRAME_MS);

    return () => {
      window.clearInterval(timer);
      setFrame(null);
    };
  }, [session.state]);

  const pieces = carromPieces(session.state);
  const shooting = mine && frame === null;
  const strikerAt = placeStriker(session.state, seat === -1 ? 0 : seat, aim.x);

  const toBoard = (event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - box.left) / box.width) * BOARD,
      y: ((event.clientY - box.top) / box.height) * BOARD,
    };
  };

  const release = (): void => {
    if (aim.pullX === null || aim.pullY === null) {
      setAim((current) => ({ ...current, pullX: null, pullY: null }));
      return;
    }
    const dx = strikerAt.x - aim.pullX;
    const dy = strikerAt.y - aim.pullY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    setAim((current) => ({ ...current, pullX: null, pullY: null }));
    // A tap is not a shot. Somebody who clicked the board to see what happens
    // should not lose a turn to a striker that dribbles two inches.
    if (distance < MIN_DRAG) return;
    const power = Math.min(1, (distance - MIN_DRAG) / (MAX_DRAG - MIN_DRAG) + 0.08);
    onMove(0, [aim.x, Math.atan2(dy, dx), power]);
  };

  const pull =
    aim.pullX !== null && aim.pullY !== null
      ? { x: aim.pullX, y: aim.pullY }
      : null;

  return (
    <div className="m-auto w-full max-w-[34rem]">
      <svg
        ref={svg}
        viewBox={`0 0 ${BOARD} ${BOARD}`}
        role="group"
        aria-label="Carrom board"
        className={`aspect-square w-full rounded-lg ${shooting ? 'cursor-crosshair' : ''}`}
        onPointerDown={(event) => {
          if (!shooting) return;
          const at = toBoard(event);
          event.currentTarget.setPointerCapture(event.pointerId);
          // Near your own line, a press means "move the striker". Anywhere else
          // it means "aim". One gesture each, decided by where it started, so
          // neither can steal the other.
          const onBaseline = Math.abs(at.y - baselineY(seat === -1 ? 0 : seat)) < 0.09;
          if (onBaseline) {
            setAim({ x: strikerXFrom(at.x), pullX: null, pullY: null });
            return;
          }
          setAim((current) => ({ ...current, pullX: at.x, pullY: at.y }));
        }}
        onPointerMove={(event) => {
          if (!shooting) return;
          if (aim.pullX === null) return;
          const at = toBoard(event);
          setAim((current) => ({ ...current, pullX: at.x, pullY: at.y }));
        }}
        onPointerUp={release}
        onPointerCancel={() => setAim((current) => ({ ...current, pullX: null, pullY: null }))}
      >
        <rect x={0} y={0} width={BOARD} height={BOARD} fill="#3b2a17" />
        <rect
          x={0.02}
          y={0.02}
          width={BOARD - 0.04}
          height={BOARD - 0.04}
          fill="#c99a5b"
          stroke="#7a4f22"
          strokeWidth={0.012}
        />

        {/* The printed circle in the middle, and the two rings around it. */}
        <circle cx={0.5} cy={0.5} r={0.085} fill="none" stroke="#8a5a28" strokeWidth={0.006} />
        <circle cx={0.5} cy={0.5} r={0.16} fill="none" stroke="#8a5a28" strokeWidth={0.004} />

        {/* Both baselines, with the shooter's own picked out. */}
        {[0, 1].map((line) => (
          <g key={line}>
            <line
              x1={0.5 - BASELINE_HALF_WIDTH - 0.02}
              y1={baselineY(line)}
              x2={0.5 + BASELINE_HALF_WIDTH + 0.02}
              y2={baselineY(line)}
              stroke={line === seat && shooting ? '#f8fafc' : '#8a5a28'}
              strokeWidth={line === seat && shooting ? 0.008 : 0.005}
            />
            <line
              x1={0.5 - BASELINE_HALF_WIDTH - 0.02}
              y1={baselineY(line) + (line === 0 ? 0.03 : -0.03)}
              x2={0.5 + BASELINE_HALF_WIDTH + 0.02}
              y2={baselineY(line) + (line === 0 ? 0.03 : -0.03)}
              stroke="#8a5a28"
              strokeWidth={0.005}
            />
          </g>
        ))}

        {POCKETS.map((pocket, index) => (
          <circle
            key={index}
            cx={pocket.x}
            cy={pocket.y}
            r={POCKET_RADIUS}
            fill="#160d05"
            stroke="#7a4f22"
            strokeWidth={0.006}
          />
        ))}

        {/* The men. During a replay these come from the frame that is being
            drawn; the rest of the time from the state itself. */}
        {pieces.map((piece, index) => {
          const x = frame ? frame[index * 3]! : piece.x;
          const y = frame ? frame[index * 3 + 1]! : piece.y;
          const onBoard = frame ? frame[index * 3 + 2] === 1 : piece.onBoard;
          if (!onBoard) return null;
          if (index === STRIKER) {
            return (
              <circle
                key={index}
                cx={x}
                cy={y}
                r={STRIKER_RADIUS}
                fill="#fef3c7"
                stroke="#92400e"
                strokeWidth={0.005}
              />
            );
          }
          return (
            <circle
              key={index}
              cx={x}
              cy={y}
              r={COIN_RADIUS}
              fill={index === QUEEN ? '#dc2626' : coinsOf(0).includes(index) ? '#f8fafc' : '#1e293b'}
              stroke="#00000055"
              strokeWidth={0.003}
            />
          );
        })}

        {/* The striker waiting to be hit, and the line it will go along. Drawn
            only for whoever is shooting: everybody else is watching a board
            with no striker on it, which is what a real one looks like between
            shots. */}
        {shooting && (
          <>
            <circle
              cx={strikerAt.x}
              cy={strikerAt.y}
              r={STRIKER_RADIUS}
              fill="#fef3c7"
              stroke="#f59e0b"
              strokeWidth={0.007}
            />
            {pull && (
              <>
                <line
                  x1={strikerAt.x}
                  y1={strikerAt.y}
                  x2={strikerAt.x + (strikerAt.x - pull.x) * 2.2}
                  y2={strikerAt.y + (strikerAt.y - pull.y) * 2.2}
                  stroke="#fbbf24"
                  strokeWidth={0.006}
                  strokeDasharray="0.02 0.015"
                />
                <line
                  x1={strikerAt.x}
                  y1={strikerAt.y}
                  x2={pull.x}
                  y2={pull.y}
                  stroke="#f8fafc66"
                  strokeWidth={0.004}
                />
              </>
            )}
          </>
        )}
      </svg>

      <p className="mt-1.5 text-center text-[11px] text-slate-500">
        {frame !== null
          ? 'Playing the shot…'
          : shooting
            ? 'Drag the striker along your line to place it, then pull back anywhere on the board and let go.'
            : queenPending(session.state) !== -1
              ? 'The queen is uncovered - whoever took her must pocket one of their own next.'
              : 'Watching.'}
      </p>
    </div>
  );
}

/** A board x, turned into the -1..1 the rules take. */
function strikerXFrom(x: number): number {
  const offset = (x - BOARD / 2) / BASELINE_HALF_WIDTH;
  return Math.max(-1, Math.min(1, offset));
}
