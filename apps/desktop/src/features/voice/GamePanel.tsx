/**
 * Play Together, as one panel that takes the voice stage.
 *
 * The same shape as the listening panel, and for the same reasons: a board is
 * a thing people look at with their whole attention for a minute at a time, so
 * it takes the stage rather than living in a popover, and it is drawn in
 * exactly one place - `VoiceChannelView` - because `VoiceControls` is rendered
 * twice and anything it drew from shared state would be drawn twice.
 *
 * Two states, not two tabs. With nothing on the table this is the library;
 * with a game on it, it is the board and the chairs. There is no "back to the
 * library" that abandons a game by accident - changing the game is a deliberate
 * thing, and it is behind the same button that started this one.
 */
import { useState } from 'react';
import {
  GAMES,
  GAME_LIBRARY,
  gameReady,
  gameScore,
  type GameId,
  type GameSession,
} from '@betweenus/shared-types';
import { mySeat, turnLine, useGameStore } from '../../stores/game';
import { GameBoard } from './GameBoards';
import { GamepadIcon, RotateIcon, TrophyIcon, UserIcon, XIcon } from '../../components/icons';

export function GamePanel(): JSX.Element {
  const session = useGameStore((state) => state.session);
  const [choosing, setChoosing] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <GamepadIcon className="h-4 w-4 shrink-0 text-emerald-300" />
        <span className="text-sm font-medium text-slate-200">
          {session ? GAMES[session.gameId].definition.name : 'Play together'}
        </span>
        {session && (
          <span className="rounded bg-surface-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
            round {session.round}
          </span>
        )}

        {session && (
          <button
            type="button"
            onClick={() => setChoosing((open) => !open)}
            className="ml-2 cursor-pointer rounded px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
          >
            {choosing ? 'Back to the board' : 'Change game'}
          </button>
        )}

        <button
          type="button"
          onClick={() => useGameStore.getState().setOpen(false)}
          aria-label="Close play together"
          title="Close - the game stays on the table"
          className="ml-auto cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {!session || choosing ? (
        <Library
          onPick={(gameId) => {
            useGameStore.getState().openGame(gameId);
            setChoosing(false);
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-3">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {/* The chairs, above the board, on any window too narrow for the
                rail beside it. This is the whole of the "the game is not
                clickable" bug: the rail was `lg:` only, so on an ordinary
                window nobody could see an empty chair, let alone take one - and
                a board with an empty chair takes no moves, correctly and
                silently. A control that decides whether the thing works may not
                be the first thing a breakpoint hides. */}
            <SeatStrip session={session} />
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
              <GameBoard session={session} onMove={(move, params) => useGameStore.getState().move(move, params)} />
              <WaitingOverlay session={session} />
            </div>
          </div>
          <Table session={session} />
        </div>
      )}

      {session && !choosing && <Status session={session} />}
    </div>
  );
}

/**
 * The library.
 *
 * Four games, each a card that starts one. Everything here is playable by two
 * people with the same board in front of them and nothing hidden, which is not
 * a taste in games: the session is broadcast whole to the whole call, so a game
 * needing a secret hand would be one with everybody's hand in the message.
 */
function Library({ onPick }: { onPick: (gameId: GameId) => void }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <p className="shrink-0 text-xs leading-relaxed text-slate-400">
        Pick something and take a chair. Everybody in the call sees the same
        board - two of you play it, the rest watch - and a move is a few bytes,
        so it costs nobody any upload and works wherever the call does.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {GAME_LIBRARY.map((gameId) => {
          const { name, blurb, seats, length, seatColours } = GAMES[gameId].definition;
          return (
            <button
              key={gameId}
              type="button"
              onClick={() => onPick(gameId)}
              className="flex cursor-pointer flex-col gap-2 rounded-lg border border-white/10 bg-surface-900 p-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-1.5">
                {seatColours.map((colour) => (
                  <span
                    key={colour}
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: colour }}
                  />
                ))}
                <span className="ml-auto text-[10px] uppercase tracking-wide text-slate-600">
                  {seats} players · {length}
                </span>
              </div>
              <span className="text-sm font-medium text-slate-100">{name}</span>
              <span className="text-[11px] leading-relaxed text-slate-400">{blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The chairs, on one line, for a window that has no room for the rail.
 *
 * Hidden on `lg` and up, where `Table` says the same things with space for the
 * tally. Below that this is the only way to sit down, so it is not decoration.
 */
function SeatStrip({ session }: { session: GameSession }): JSX.Element {
  const { definition } = GAMES[session.gameId];
  const seat = mySeat(session);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:hidden">
      {session.seats.map((who, index) => {
        const theirTurn = session.state.winner === null && session.state.turn === index;
        return (
          <button
            key={index}
            type="button"
            disabled={Boolean(who) && index !== seat}
            onClick={() =>
              index === seat
                ? useGameStore.getState().stand()
                : useGameStore.getState().sit(index)
            }
            title={
              who
                ? index === seat
                  ? 'Stand up - the chair is freed for somebody else'
                  : `${who.username} is playing here`
                : 'Take this chair'
            }
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
              theirTurn && gameReady(session)
                ? 'border-white/25 bg-white/[0.08] text-slate-100'
                : 'border-white/10 bg-surface-900 text-slate-300'
            } ${who && index !== seat ? 'cursor-default' : 'cursor-pointer hover:bg-white/[0.06]'}`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: definition.seatColours[index] }}
            />
            <span className="max-w-[9rem] truncate">
              {who ? who.username : 'Sit here'}
            </span>
            <span className="text-slate-600">{definition.seatNames[index]}</span>
            {session.wins[index]! > 0 && (
              <span className="text-amber-300">{session.wins[index]}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Why the board is not taking clicks.
 *
 * A board waiting for a second player is a board where every square is
 * correctly refused, and the first version said so only in a status line at
 * the bottom - which reads exactly like a game that is broken. It says it over
 * the board instead, with the chair to take right there.
 */
function WaitingOverlay({ session }: { session: GameSession }): JSX.Element | null {
  if (gameReady(session)) return null;
  const empty = session.seats.findIndex((seat) => seat === null);
  const watching = mySeat(session) === -1;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
      <div className="pointer-events-auto flex max-w-xs flex-col items-center gap-2 rounded-xl border border-white/10 bg-surface-950/90 px-4 py-3 text-center backdrop-blur-sm">
        <p className="text-xs text-slate-300">
          {watching
            ? 'There is an empty chair. Take it and the game starts.'
            : 'Waiting for somebody else in the call to take the other chair.'}
        </p>
        {watching && empty !== -1 && (
          <button
            type="button"
            onClick={() => useGameStore.getState().sit(empty)}
            className="flex cursor-pointer items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/30"
          >
            <UserIcon className="h-3.5 w-3.5" />
            Sit down as {GAMES[session.gameId].definition.seatNames[empty]}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The chairs, and what each of them has won.
 *
 * An empty chair is a button, because that is the whole of joining a game: the
 * person who opened it is already sitting down, and the second player is one
 * click away from being in it.
 */
function Table({ session }: { session: GameSession }): JSX.Element {
  const { definition } = GAMES[session.gameId];
  const score = gameScore(session.state);
  const seat = mySeat(session);

  return (
    <aside className="hidden w-52 shrink-0 flex-col gap-2 lg:flex">
      {session.seats.map((who, index) => {
        const playing = session.state.winner === null && session.state.turn === index;
        return (
          <div
            key={index}
            className={`rounded-lg border p-2.5 transition-colors ${
              playing && gameReady(session)
                ? 'border-white/25 bg-white/[0.06]'
                : 'border-white/10 bg-surface-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: definition.seatColours[index] }}
              />
              <span className="truncate text-xs text-slate-200">
                {who ? who.username : 'Empty chair'}
              </span>
              {session.wins[index]! > 0 && (
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-amber-300">
                  <TrophyIcon className="h-3 w-3" />
                  {session.wins[index]}
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-slate-600">
                {definition.seatNames[index]}
              </span>
              {score[index] !== undefined && (
                <span className="text-[10px] tabular-nums text-slate-500">{score[index]}</span>
              )}
              {!who && (
                <button
                  type="button"
                  onClick={() => useGameStore.getState().sit(index)}
                  className="ml-auto flex cursor-pointer items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25"
                >
                  <UserIcon className="h-3 w-3" />
                  Sit here
                </button>
              )}
              {who && index === seat && (
                <button
                  type="button"
                  onClick={() => useGameStore.getState().stand()}
                  className="ml-auto cursor-pointer rounded px-2 py-0.5 text-[10px] text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-300"
                >
                  Stand up
                </button>
              )}
            </div>
          </div>
        );
      })}

      <p className="text-[10px] leading-relaxed text-slate-600">
        Anybody in the call can take an empty chair. Leave the call and yours is
        freed - the board stays exactly as it is.
      </p>
    </aside>
  );
}

/** Whose move it is, and the two buttons that end a game. */
function Status({ session }: { session: GameSession }): JSX.Element {
  const seat = mySeat(session);
  const over = session.state.winner !== null;

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg bg-surface-900 px-3 py-2">
      <GamepadIcon
        className={`h-4 w-4 shrink-0 ${over ? 'text-amber-300' : 'text-emerald-300'}`}
      />
      <span className="truncate text-xs text-slate-200">{turnLine(session)}</span>

      {/* The score, spelled out for whoever is watching rather than playing -
          they have no chair to read it off. */}
      <span className="hidden truncate text-[11px] text-slate-500 sm:inline">
        {session.seats
          .map(
            (who, index) =>
              `${who?.username ?? GAMES[session.gameId].definition.seatNames[index]} ${session.wins[index] ?? 0}`,
          )
          .join(' · ')}
      </span>

      {over && seat !== -1 && (
        <button
          type="button"
          onClick={() => useGameStore.getState().rematch()}
          className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200 transition-colors hover:bg-emerald-500/25"
        >
          <RotateIcon className="h-3.5 w-3.5" />
          Play again
        </button>
      )}

      <button
        type="button"
        onClick={() => useGameStore.getState().close()}
        title="Take the board away for everybody"
        className={`${over && seat !== -1 ? '' : 'ml-auto'} shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200`}
      >
        End game
      </button>
    </div>
  );
}

/**
 * What is on the table, while the panel is closed.
 *
 * One line above the tiles, so the call goes back to being a call and the game
 * is still visibly a thing that is happening - and it says "your move", which
 * is the only part of it anybody needs while they are looking at faces.
 */
export function GameBar(): JSX.Element | null {
  const session = useGameStore((state) => state.session);
  const open = useGameStore((state) => state.open);
  if (!session || open) return null;

  const yours = mySeat(session) === session.state.turn && session.state.winner === null;
  return (
    <button
      type="button"
      onClick={() => useGameStore.getState().setOpen(true)}
      className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
        yours && gameReady(session)
          ? 'bg-emerald-500/15 hover:bg-emerald-500/25'
          : 'bg-surface-900 hover:bg-white/[0.06]'
      }`}
    >
      <GamepadIcon className="h-4 w-4 shrink-0 text-emerald-300" />
      <span className="truncate text-xs text-slate-200">
        {GAMES[session.gameId].definition.name}
      </span>
      <span className="truncate text-[11px] text-slate-400">{turnLine(session)}</span>
      <span className="ml-auto shrink-0 text-[11px] text-slate-500">Open</span>
    </button>
  );
}
