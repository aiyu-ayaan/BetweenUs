/**
 * Apps: the one button in the call controls that everything shared lives
 * behind.
 *
 * It used to be two buttons, a music note and a gamepad, sitting in a row that
 * already had a microphone, a camera, a screen, an invite, a connection meter
 * and a settings cog. Two of the eight were activities and six were the call
 * itself, and nothing about the row said which was which. A third activity
 * would have made it nine.
 *
 * So they are stacked: one **Apps** button, and a first screen that lists what
 * is behind it. Picking one opens that app's own screen - the games library,
 * or what is playing - inside the same popover, with a way back. Adding a
 * fourth app is a row in a list rather than another icon in the controls.
 *
 * ## Two things about how it is drawn
 *
 * **It is a portal.** The sidebar is a `.panel`, and `.panel` is
 * `overflow-hidden` - an absolutely positioned menu inside it is clipped to
 * nothing, which is a menu that was rendered, is in the DOM, and looks exactly
 * like a button that does nothing. It hangs off the button's own rectangle in
 * `document.body` instead, where no ancestor can crop it.
 *
 * **Its state is local.** `VoiceControls` is rendered twice - the sidebar and
 * the channel view - and the last thing it drew from a store appeared twice,
 * side by side, both live. Which screen this menu is showing belongs to the
 * copy that was clicked.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GAMES, GAME_LIBRARY, type GameId } from '@betweenus/shared-types';
import { useGameStore } from '../../stores/game';
import { useListenStore } from '../../stores/listen';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CompassIcon,
  GamepadIcon,
  MusicIcon,
  PlusIcon,
} from '../../components/icons';

/** How wide the menu is, and how far it keeps from the edge of the window. */
const MENU_WIDTH = 272;
const MARGIN = 8;

/** Which screen the menu is on. `apps` is the list; the others are one app. */
type Screen = 'apps' | 'listen' | 'game';

/**
 * Where the menu sits, given the button it belongs to, and when it closes.
 *
 * Measured in a layout effect so it is never in the wrong place for a frame on
 * its way to the right one, and re-measured on resize and on any scroll: a
 * `fixed` element anchored to a rectangle that moved is pointing at nothing.
 */
function useAnchored(
  anchor: React.RefObject<HTMLElement>,
  onClose: () => void,
  screen: Screen,
): { box: React.RefObject<HTMLDivElement>; style: React.CSSProperties } {
  const box = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    left: 0,
    top: 0,
    opacity: 0,
  });

  useLayoutEffect(() => {
    const place = (): void => {
      const button = anchor.current?.getBoundingClientRect();
      if (!button) return;
      const height = box.current?.offsetHeight ?? 320;
      // Above the button when there is room - these controls sit at the bottom
      // of the window - and below it when there is not.
      const above = button.top - MARGIN - height;
      const top =
        above >= MARGIN
          ? above
          : Math.min(button.bottom + MARGIN, window.innerHeight - height - MARGIN);
      const left = Math.max(
        MARGIN,
        Math.min(button.left, window.innerWidth - MENU_WIDTH - MARGIN),
      );
      setStyle({ position: 'fixed', left, top, width: MENU_WIDTH, opacity: 1, zIndex: 60 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // `screen` is in here because each screen is a different height, and a menu
    // that grew downwards off the bottom of the window would be a games list
    // with three games visible.
  }, [anchor, screen]);

  useEffect(() => {
    const away = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (box.current?.contains(target)) return;
      // The button itself is left alone, so its own click closes the menu by
      // toggling rather than being handled twice and reopening it.
      if (anchor.current?.contains(target)) return;
      onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    // On the next tick: the click that opened this is still on its way up, and
    // without the delay the menu closes on its own opening.
    const timer = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [anchor, onClose]);

  return { box, style };
}

export function AppsMenu({
  anchor,
  onClose,
  onOpened,
}: {
  /** The button this hangs off. The menu is placed against its rectangle. */
  anchor: React.RefObject<HTMLElement>;
  onClose: () => void;
  /** Called after an app is opened, so the caller can go to where it is drawn. */
  onOpened: () => void;
}): JSX.Element {
  const [screen, setScreen] = useState<Screen>('apps');
  const { box, style } = useAnchored(anchor, onClose, screen);

  const done = (): void => {
    onClose();
    onOpened();
  };

  return createPortal(
    <div
      ref={box}
      style={style}
      role="menu"
      aria-label="Apps"
      className="rounded-xl border border-white/10 bg-surface-900 p-2 shadow-2xl"
    >
      {screen === 'apps' ? (
        <AppList onPick={setScreen} />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setScreen('apps')}
            className="mb-1 flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-left text-[11px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            Apps
          </button>
          {screen === 'game' ? <GameScreen onOpened={done} /> : <ListenScreen onOpened={done} />}
        </>
      )}
    </div>,
    document.body,
  );
}

/**
 * The first screen: what there is.
 *
 * Each row says whether that app is *already* doing something, because the
 * commonest reason to open this is to get back to a game or a queue somebody
 * else started rather than to start one.
 */
function AppList({ onPick }: { onPick: (screen: Screen) => void }): JSX.Element {
  const game = useGameStore((state) => state.session);
  const listen = useListenStore((state) => state.session);
  const track = listen?.queue[listen.index];

  return (
    <ul className="flex flex-col">
      <li>
        <AppRow
          icon={<MusicIcon className="h-4 w-4 text-amber-300" />}
          name="Listen together"
          detail={
            track
              ? `${listen?.paused ? 'Paused' : 'Playing'} · ${track.title || track.ref}`
              : 'A shared queue, in step, from everybody’s own connection'
          }
          live={Boolean(listen)}
          onClick={() => onPick('listen')}
        />
      </li>
      <li>
        <AppRow
          icon={<GamepadIcon className="h-4 w-4 text-emerald-300" />}
          name="Play together"
          detail={
            game
              ? `${GAMES[game.gameId].definition.name} · round ${game.round}`
              : 'Six board games, refereed by the server'
          }
          live={Boolean(game)}
          onClick={() => onPick('game')}
        />
      </li>
    </ul>
  );
}

function AppRow({
  icon,
  name,
  detail,
  live,
  onClick,
}: {
  icon: JSX.Element;
  name: string;
  detail: string;
  live: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs text-slate-100">{name}</span>
          {live && (
            <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] uppercase tracking-wide text-slate-300">
              on
            </span>
          )}
        </span>
        <span className="block truncate text-[10px] text-slate-500">{detail}</span>
      </span>
      <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-600" />
    </button>
  );
}

/**
 * The games, as a list you can start one from.
 *
 * The whole library rather than "open the panel", because the panel's first
 * screen *is* this list - and a screen whose only entry opens another screen
 * showing the same thing is a click spent on nothing.
 */
function GameScreen({ onOpened }: { onOpened: () => void }): JSX.Element {
  const session = useGameStore((state) => state.session);

  const start = (gameId: GameId): void => {
    useGameStore.getState().openGame(gameId);
    useGameStore.getState().setOpen(true);
    onOpened();
  };

  return (
    <>
      {session && (
        <button
          type="button"
          onClick={() => {
            useGameStore.getState().setOpen(true);
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

      <ul className="flex max-h-80 flex-col overflow-y-auto">
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
    </>
  );
}

/**
 * What is playing, and the two ways to change it.
 *
 * The paste box is here rather than only in the panel because it is the one
 * thing somebody wants to do without leaving the list of faces: drop a link in
 * and carry on talking.
 */
function ListenScreen({ onOpened }: { onOpened: () => void }): JSX.Element {
  const session = useListenStore((state) => state.session);
  const link = useRef<HTMLInputElement>(null);
  const track = session?.queue[session.index];

  const open = (tab: 'browse' | 'playing'): void => {
    useListenStore.getState().setTab(tab);
    useListenStore.getState().setOpen(true);
    onOpened();
  };

  return (
    <>
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
          // Adding without leaving: the queue is the point of this screen, and
          // sending somebody to a full-width panel to paste one link is the
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
    </>
  );
}
