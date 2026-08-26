/**
 * Apps, as one screen on the voice stage.
 *
 * The stage is where everything shared in a call is drawn - the tiles, a shared
 * video, a board - and this is the screen in front of all of it: what is there
 * to do together, and which of it is already happening.
 *
 * It replaced a popover, and the popover was wrong for the ordinary reasons a
 * popover usually is. A six-game library in a 17rem box is a list with three
 * rows visible and a scrollbar. A menu floating over a call covers the faces it
 * is meant to sit beside. And it needed portalling out of the sidebar, flipping
 * above or below the button, and re-measuring on every scroll - a page of
 * machinery to put a list somewhere the app already has a place for.
 *
 * Each card says whether that activity is already running, because the
 * commonest reason to open this is to get back to a game or a queue somebody
 * else started rather than to start one.
 */
import { GAMES, type GameSession, type ListenSession } from '@betweenus/shared-types';
import { useAppsStore } from '../../stores/apps';
import { useGameStore } from '../../stores/game';
import { useListenStore } from '../../stores/listen';
import { ChevronRightIcon, GamepadIcon, MusicIcon, XIcon } from '../../components/icons';

export function AppsPanel(): JSX.Element {
  const listen = useListenStore((state) => state.session);
  const game = useGameStore((state) => state.session);

  const openListen = (): void => {
    useAppsStore.getState().setOpen(false);
    useListenStore.getState().setOpen(true);
  };

  const openGame = (): void => {
    useAppsStore.getState().setOpen(false);
    useGameStore.getState().setOpen(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-medium text-slate-200">Apps</span>
        <span className="text-[11px] text-slate-500">Things to do together in this call</span>
        <button
          type="button"
          onClick={() => useAppsStore.getState().setOpen(false)}
          aria-label="Close apps"
          title="Back to the call"
          className="ml-auto cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2">
        <AppCard
          icon={<MusicIcon className="h-5 w-5 text-amber-300" />}
          name="Listen together"
          blurb="One queue, in step, playing from everybody's own connection - so it stays at full quality and costs nobody any upload. Anybody here can change what is on."
          status={listenStatus(listen)}
          accent="amber"
          onClick={openListen}
        />
        <AppCard
          icon={<GamepadIcon className="h-5 w-5 text-emerald-300" />}
          name="Play together"
          blurb="Six board games on one board everybody sees - two of you play, the rest watch. The server referees the moves, so nothing is played on trust."
          status={gameStatus(game)}
          accent="emerald"
          onClick={openGame}
        />
      </div>
    </div>
  );
}

function listenStatus(session: ListenSession | null): string | null {
  if (!session) return null;
  const track = session.queue[session.index];
  if (!track) return null;
  return `${session.paused ? 'Paused' : 'Playing'} · ${track.title || track.ref}`;
}

function gameStatus(session: GameSession | null): string | null {
  if (!session) return null;
  const seated = session.seats.filter((seat) => seat !== null).length;
  return `${GAMES[session.gameId].definition.name} · round ${session.round} · ${seated} of ${session.seats.length} seated`;
}

function AppCard({
  icon,
  name,
  blurb,
  status,
  accent,
  onClick,
}: {
  icon: JSX.Element;
  name: string;
  blurb: string;
  /** What it is doing right now, or null when it is not doing anything. */
  status: string | null;
  accent: 'amber' | 'emerald';
  onClick: () => void;
}): JSX.Element {
  const ring =
    accent === 'amber'
      ? 'border-amber-400/40 hover:border-amber-400/60'
      : 'border-emerald-400/40 hover:border-emerald-400/60';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
        status ? ring : 'border-white/10 hover:border-white/20'
      } bg-surface-900 hover:bg-white/[0.04]`}
    >
      <span className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-slate-100">{name}</span>
        {status && (
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
              accent === 'amber'
                ? 'bg-amber-500/20 text-amber-200'
                : 'bg-emerald-500/20 text-emerald-200'
            }`}
          >
            on
          </span>
        )}
        <ChevronRightIcon className="ml-auto h-4 w-4 text-slate-600" />
      </span>

      {status && (
        <span
          className={`truncate text-xs ${accent === 'amber' ? 'text-amber-200' : 'text-emerald-200'}`}
        >
          {status}
        </span>
      )}

      <span className="text-[11px] leading-relaxed text-slate-400">{blurb}</span>
    </button>
  );
}
