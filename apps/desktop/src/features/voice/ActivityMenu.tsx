/**
 * What the music and gamepad buttons open when they are pressed in the sidebar.
 *
 * The buttons used to do one thing: set a flag and walk you to the voice
 * channel, where the panel is drawn. From inside the channel that reads
 * correctly. From the sidebar - which is where somebody in a call actually is,
 * looking at a list of who else is in it - it reads as a button that navigates
 * for no stated reason and may or may not have done anything.
 *
 * So in the sidebar they open a menu of the things behind them: the six games,
 * or what is playing and how to add to it. Picking something both does it and
 * takes you to the board, which is the order those two have to happen in - a
 * game started on a screen you cannot see is the same complaint again.
 *
 * The menu is local state in one instance of `VoiceControls`, not a flag in a
 * store. That matters here: this component is rendered twice, in the sidebar
 * and in the channel view, and the last thing drawn from shared state appeared
 * twice, side by side, both live. A `useState` belongs to the copy that was
 * clicked.
 */
import { useEffect, useRef } from 'react';
import { GAMES, GAME_LIBRARY, type GameId } from '@betweenus/shared-types';
import { useGameStore } from '../../stores/game';
import { useListenStore } from '../../stores/listen';
import { CompassIcon, GamepadIcon, MusicIcon, PlusIcon } from '../../components/icons';

/** Closes on a click anywhere else, and on Escape. Both are expected of a menu. */
function useDismiss(onClose: () => void): React.RefObject<HTMLDivElement> {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    // Captured, and on the next tick: the click that opened this is still on
    // its way up, and without the delay the menu closes on its own opening.
    const timer = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return box;
}

const SHELL =
  'absolute bottom-full z-30 mb-2 w-64 rounded-xl border border-white/10 bg-surface-900 p-2 shadow-2xl';

/**
 * The games, as a list you can start one from.
 *
 * The whole library rather than "open the panel", because the panel's first
 * screen *is* this list - and a menu that only opens another menu is a click
 * spent on nothing.
 */
export function GameMenu({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  /** Called after something is started, so the caller can go to the board. */
  onOpened: () => void;
}): JSX.Element {
  const session = useGameStore((state) => state.session);
  const box = useDismiss(onClose);

  const start = (gameId: GameId): void => {
    useGameStore.getState().openGame(gameId);
    useGameStore.getState().setOpen(true);
    onClose();
    onOpened();
  };

  return (
    <div ref={box} className={SHELL}>
      <div className="flex items-center gap-2 px-1.5 pb-1.5">
        <GamepadIcon className="h-3.5 w-3.5 text-emerald-300" />
        <span className="text-[11px] font-medium text-slate-300">Play together</span>
      </div>

      {session && (
        <button
          type="button"
          onClick={() => {
            useGameStore.getState().setOpen(true);
            onClose();
            onOpened();
          }}
          className="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-lg bg-emerald-500/15 px-2 py-1.5 text-left transition-colors hover:bg-emerald-500/25"
        >
          <span className="truncate text-[11px] font-medium text-emerald-100">
            Back to {GAMES[session.gameId].definition.name}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-emerald-200/70">
            round {session.round}
          </span>
        </button>
      )}

      <ul className="flex flex-col">
        {GAME_LIBRARY.map((gameId) => {
          const { name, blurb, seatColours, length } = GAMES[gameId].definition;
          return (
            <li key={gameId}>
              <button
                type="button"
                onClick={() => start(gameId)}
                className="flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span className="mt-1 flex shrink-0 gap-0.5">
                  {seatColours.map((colour) => (
                    <span
                      key={colour}
                      className="h-2 w-2 rounded-full"
                      style={{ background: colour }}
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[11px] text-slate-200">{name}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-slate-600">{length}</span>
                  </span>
                  <span className="block truncate text-[10px] text-slate-500">{blurb}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * What is playing, and the two ways to change it.
 *
 * The paste box is here rather than only in the panel because it is the one
 * thing somebody wants to do without leaving the list of faces: drop a link in
 * and carry on talking.
 */
export function ListenMenu({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: () => void;
}): JSX.Element {
  const session = useListenStore((state) => state.session);
  const box = useDismiss(onClose);
  const link = useRef<HTMLInputElement>(null);

  const open = (tab: 'browse' | 'playing'): void => {
    useListenStore.getState().setTab(tab);
    useListenStore.getState().setOpen(true);
    onClose();
    onOpened();
  };

  const track = session?.queue[session.index];

  return (
    <div ref={box} className={SHELL}>
      <div className="flex items-center gap-2 px-1.5 pb-1.5">
        <MusicIcon className="h-3.5 w-3.5 text-amber-300" />
        <span className="text-[11px] font-medium text-slate-300">Listen together</span>
      </div>

      {track && (
        <button
          type="button"
          onClick={() => open('playing')}
          className="mb-1 flex w-full cursor-pointer flex-col gap-0.5 rounded-lg bg-amber-500/15 px-2 py-1.5 text-left transition-colors hover:bg-amber-500/25"
        >
          <span className="truncate text-[11px] font-medium text-amber-100">
            {track.title || 'Loading…'}
          </span>
          <span className="truncate text-[10px] text-amber-200/70">
            {session?.paused ? 'Paused' : 'Playing'} · added by {track.addedByUsername}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={() => open('browse')}
        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
      >
        <CompassIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <span className="text-[11px] text-slate-200">Browse for something to play</span>
      </button>

      <form
        className="mt-1 flex gap-1.5 px-1"
        onSubmit={(event) => {
          event.preventDefault();
          const value = link.current?.value.trim();
          if (!value) return;
          // Adding without leaving: the queue is the point of this menu, and
          // sending somebody to a full-screen panel to paste one link is the
          // long way round.
          const failed = useListenStore.getState().add(value);
          if (!failed && link.current) link.current.value = '';
        }}
      >
        <input
          ref={link}
          placeholder="Paste a link"
          aria-label="YouTube link"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-surface-800 px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-white/20 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Add to the queue"
          className="flex cursor-pointer items-center justify-center rounded-md bg-surface-800 px-2 text-slate-300 transition-colors hover:bg-white/[0.06]"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
