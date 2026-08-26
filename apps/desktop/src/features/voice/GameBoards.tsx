/**
 * The boards.
 *
 * One component per game, and each of them draws `session.state` and nothing
 * else: there is no local board here, no optimistic placement and no animation
 * that outlives a message. A move goes to the gateway, the gateway referees it,
 * and the state that comes back is what is on screen. That is a round trip of
 * latency on every click, and it is the right trade - a board that showed a
 * disc before it was agreed would show a different game to the person who
 * played it, which is the one thing a shared board must never do.
 *
 * What each of them *does* do locally is refuse a click that cannot be played,
 * using the same rules the gateway will use. That is not a permission check -
 * the gateway's is - it is so a square that is going to be ignored looks like
 * one before it is pressed.
 */
import {
  CELLS as DOTS_CELLS,
  COLUMNS,
  DOTS,
  GAMES,
  REVERSI_SIZE,
  ROWS,
  connectFourAt,
  horizontal,
  landing,
  vertical,
  winningLine,
  type GameSession,
} from '@betweenus/shared-types';
import { canPlay } from '../../stores/game';

interface BoardProps {
  session: GameSession;
  onMove: (move: number) => void;
}

/** The board for whichever game is on the table. */
export function GameBoard({ session, onMove }: BoardProps): JSX.Element {
  switch (session.gameId) {
    case 'tic-tac-toe':
      return <TicTacToeBoard session={session} onMove={onMove} />;
    case 'connect-four':
      return <ConnectFourBoard session={session} onMove={onMove} />;
    case 'reversi':
      return <ReversiBoard session={session} onMove={onMove} />;
    case 'dots-and-boxes':
      return <DotsAndBoxesBoard session={session} onMove={onMove} />;
    default:
      // A game this build has never heard of, which is what an older client
      // looking at a newer call looks like. Saying so beats an empty rectangle.
      return (
        <p className="m-auto max-w-xs text-center text-xs text-slate-500">
          Somebody started a game this version does not know how to draw. Update
          to join in.
        </p>
      );
  }
}

/** The colour a seat plays in, from the rules rather than from each board. */
function colourOf(session: GameSession, seat: number): string {
  return GAMES[session.gameId].definition.seatColours[seat] ?? '#94a3b8';
}

function TicTacToeBoard({ session, onMove }: BoardProps): JSX.Element {
  const { cells, lastMove } = session.state;
  const line = winningLine(cells);

  return (
    <div className="m-auto grid aspect-square w-full max-w-[22rem] grid-cols-3 gap-1.5">
      {cells.map((owner, index) => {
        const playable = canPlay(session, index);
        return (
          <button
            key={index}
            type="button"
            disabled={!playable}
            onClick={() => onMove(index)}
            aria-label={`Square ${index + 1}`}
            className={`flex items-center justify-center rounded-lg border text-4xl font-semibold transition-colors ${
              line?.includes(index)
                ? 'border-white/30 bg-white/[0.10]'
                : 'border-white/10 bg-surface-900'
            } ${playable ? 'cursor-pointer hover:bg-white/[0.06]' : 'cursor-default'} ${
              lastMove === index ? 'ring-1 ring-white/25' : ''
            }`}
            style={{ color: owner === -1 ? undefined : colourOf(session, owner) }}
          >
            {owner === -1 ? '' : GAMES['tic-tac-toe'].definition.seatNames[owner]}
          </button>
        );
      })}
    </div>
  );
}

function ConnectFourBoard({ session, onMove }: BoardProps): JSX.Element {
  const { cells, lastMove } = session.state;

  return (
    <div className="m-auto flex w-full max-w-[30rem] flex-col gap-1">
      {/* Whole columns, not squares: a click means "drop one in here", which is
          what the move on the wire says as well. Two people pressing the same
          column stack rather than racing for one hole. */}
      <div className="grid grid-cols-7 gap-1 rounded-lg bg-sky-950/60 p-2">
        {Array.from({ length: COLUMNS }, (_, column) => {
          const playable = canPlay(session, column);
          const next = landing(cells, column);
          return (
            <button
              key={column}
              type="button"
              disabled={!playable}
              onClick={() => onMove(column)}
              aria-label={`Drop a disc in column ${column + 1}`}
              className={`group flex flex-col gap-1 rounded ${
                playable ? 'cursor-pointer hover:bg-white/[0.06]' : 'cursor-default'
              }`}
            >
              {Array.from({ length: ROWS }, (_, row) => {
                const index = connectFourAt(row, column);
                const owner = cells[index] ?? -1;
                return (
                  <span
                    key={row}
                    className={`aspect-square w-full rounded-full ${
                      owner === -1 ? 'bg-surface-950' : ''
                    } ${lastMove === index ? 'ring-2 ring-white/40' : ''}`}
                    style={{
                      background: owner === -1 ? undefined : colourOf(session, owner),
                      // A ghost of the disc that would land, so a column reads
                      // as a move before it is one.
                      boxShadow:
                        playable && row === next
                          ? `inset 0 0 0 2px ${colourOf(session, session.state.turn)}55`
                          : undefined,
                    }}
                  />
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReversiBoard({ session, onMove }: BoardProps): JSX.Element {
  const { cells, lastMove } = session.state;
  // The legal squares, drawn as faint spots. Reversi is the one game here where
  // "what may I play" is not obvious from looking, and a beginner who cannot
  // see it plays three illegal moves and assumes the board is broken.
  const legal = new Set(GAMES.reversi.moves(session.state));
  const mine = legal.size > 0 && canPlay(session, [...legal][0]!);

  return (
    <div className="m-auto grid aspect-square w-full max-w-[30rem] grid-cols-8 gap-px rounded-lg bg-emerald-950 p-1">
      {cells.map((owner, index) => (
        <button
          key={index}
          type="button"
          disabled={!canPlay(session, index)}
          onClick={() => onMove(index)}
          aria-label={`Square ${Math.floor(index / REVERSI_SIZE) + 1}, ${(index % REVERSI_SIZE) + 1}`}
          className={`flex items-center justify-center bg-emerald-900/70 transition-colors ${
            canPlay(session, index) ? 'cursor-pointer hover:bg-emerald-800' : 'cursor-default'
          }`}
        >
          {owner !== -1 ? (
            <span
              className={`h-[78%] w-[78%] rounded-full ${
                lastMove === index ? 'ring-2 ring-amber-300/70' : ''
              }`}
              style={{ background: colourOf(session, owner) }}
            />
          ) : mine && legal.has(index) ? (
            <span className="h-[26%] w-[26%] rounded-full bg-white/25" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

function DotsAndBoxesBoard({ session, onMove }: BoardProps): JSX.Element {
  const { cells, boxes, lastMove } = session.state;
  // One SVG unit per box, plus a margin, so the whole board scales with the
  // stage and the click targets scale with it - a line drawn at a fixed pixel
  // width is unhittable on a laptop and enormous on a monitor.
  const step = 10;
  const pad = 5;
  const size = pad * 2 + step * DOTS_CELLS;

  const line = (index: number, x: number, y: number, w: number, h: number): JSX.Element => {
    const owner = cells[index] ?? -1;
    const playable = canPlay(session, index);
    return (
      <rect
        key={index}
        x={x - 1.2}
        y={y - 1.2}
        width={w + 2.4}
        height={h + 2.4}
        rx={1.2}
        fill={owner === -1 ? (playable ? '#ffffff14' : 'transparent') : colourOf(session, owner)}
        stroke={lastMove === index ? '#fff' : 'none'}
        strokeWidth={0.4}
        className={playable ? 'cursor-pointer' : ''}
        onClick={playable ? () => onMove(index) : undefined}
      >
        <title>{owner === -1 ? 'Draw this line' : 'Drawn'}</title>
      </rect>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="group"
      aria-label="Dots and boxes"
      className="m-auto aspect-square w-full max-w-[28rem]"
    >
      {boxes.map((owner, index) =>
        owner === -1 ? null : (
          <rect
            key={`box-${index}`}
            x={pad + (index % DOTS_CELLS) * step}
            y={pad + Math.floor(index / DOTS_CELLS) * step}
            width={step}
            height={step}
            fill={`${colourOf(session, owner)}33`}
          />
        ),
      )}

      {Array.from({ length: DOTS }, (_, r) =>
        Array.from({ length: DOTS_CELLS }, (_, c) =>
          line(horizontal(r, c), pad + c * step, pad + r * step, step, 0),
        ),
      )}
      {Array.from({ length: DOTS_CELLS }, (_, r) =>
        Array.from({ length: DOTS }, (_, c) =>
          line(vertical(r, c), pad + c * step, pad + r * step, 0, step),
        ),
      )}

      {Array.from({ length: DOTS }, (_, r) =>
        Array.from({ length: DOTS }, (_, c) => (
          <circle
            key={`dot-${r}-${c}`}
            cx={pad + c * step}
            cy={pad + r * step}
            r={0.9}
            fill="#94a3b8"
          />
        )),
      )}

      {/* The initial of whoever closed each box, because two pale fills are
          hard to tell apart at a glance and the score is the whole game. */}
      {boxes.map((owner, index) =>
        owner === -1 ? null : (
          <text
            key={`mark-${index}`}
            x={pad + (index % DOTS_CELLS) * step + step / 2}
            y={pad + Math.floor(index / DOTS_CELLS) * step + step / 2 + 1.6}
            textAnchor="middle"
            fontSize={4}
            fill={colourOf(session, owner)}
          >
            {GAMES['dots-and-boxes'].definition.seatNames[owner]?.[0] ?? ''}
          </text>
        ),
      )}
    </svg>
  );
}
