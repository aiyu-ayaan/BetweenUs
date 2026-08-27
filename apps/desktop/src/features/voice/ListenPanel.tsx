/**
 * Listen Together, as one panel that takes the voice stage.
 *
 * It was a popover on the call controls and that was wrong twice over.
 *
 * **It drew itself twice.** `VoiceControls` is rendered in two places - the
 * sidebar and the channel view - so a single `open` flag in the store produced
 * two live panels side by side, each with its own seek bar, arguing. Shared
 * state may only have one render site, and this is it.
 *
 * **It was the wrong size for the job.** Picking the next thing to play is not
 * a thing anybody does in a 22rem popover: it wants the site, and the site
 * wants the screen. So the panel takes the stage the way a shared screen does,
 * and the tiles come straight back when it closes.
 *
 * Two tabs, because only one of them can have the space and because a native
 * browser view and an embedded player must never be on screen together - a
 * `WebContentsView` paints above every pixel of the DOM whatever any `z-index`
 * says, so "both at once" means "the player is invisible and nobody knows why".
 *
 *   Browse   - the real youtube.com, signed in as you, on desktop; search
 *              results in a browser tab, which is as close as a web page is
 *              allowed to get. The default, because looking for something to
 *              play is what opening this means.
 *   Playing  - the video everybody in the call is watching.
 *
 * Neither tab draws anything itself. Both offer an empty rectangle and
 * something the store owns is positioned over it, so that switching tabs,
 * closing the panel or leaving the screen cannot destroy what is playing. See
 * `stores/listen.ts`.
 */
import { useEffect, useRef, useState } from 'react';
import { listenPositionAt } from '@betweenus/shared-types';
import { claimListenSlot, useListenStore } from '../../stores/listen';
import { useAppsStore } from '../../stores/apps';
import { formatPosition } from '../../services/listen-sync';
import { isDesktopRuntime } from '../../services/platform';
import { ListenBrowser } from './ListenBrowser';
import { ListenSearch } from './ListenSearch';
import {
  ChevronLeftIcon,
  CompassIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerIcon,
  TrashIcon,
  XIcon,
} from '../../components/icons';

export function ListenPanel(): JSX.Element {
  const session = useListenStore((state) => state.session);
  const tab = useListenStore((state) => state.tab);
  const error = useListenStore((state) => state.error);

  const playerSlot = useRef<HTMLDivElement>(null);
  /**
   * The desktop app frames youtube.com itself; a browser tab cannot, and gets
   * search results instead. Both are the same gesture - find something, press
   * it, the call watches it - so both live on the same Browse tab rather than
   * one of them being a lesser thing hidden somewhere else.
   */
  const native = isDesktopRuntime() && Boolean(window.betweenus?.youtubeOpen);

  // The picture is handed this rectangle only while the player tab has the
  // space. On the browser tab it is released, which parks it - still playing,
  // and no longer sitting invisibly underneath a native view.
  useEffect(() => {
    if (tab !== 'playing' || !session) {
      claimListenSlot(null);
      return undefined;
    }
    claimListenSlot(playerSlot.current);
    return () => claimListenSlot(null);
  }, [tab, session]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        {/* Back to the chooser rather than out of the call - this screen was
            reached from Apps, and the music carries on either way. */}
        <button
          type="button"
          onClick={() => {
            useListenStore.getState().setOpen(false);
            useAppsStore.getState().setOpen(true);
          }}
          aria-label="Back to apps"
          title="Apps"
          className="-ml-1 cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <MusicIcon className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="text-sm font-medium text-slate-200">Listen together</span>

        <div className="ml-2 flex items-center gap-0.5 rounded-md bg-surface-900 p-0.5">
          <Tab active={tab === 'browse'} onClick={() => useListenStore.getState().setTab('browse')}>
            <CompassIcon className="h-3.5 w-3.5" />
            Browse
          </Tab>
          <Tab
            active={tab === 'playing'}
            disabled={!session}
            onClick={() => useListenStore.getState().setTab('playing')}
          >
            <PlayIcon className="h-3.5 w-3.5" />
            Playing
          </Tab>
        </div>

        <button
          type="button"
          onClick={() => useListenStore.getState().setOpen(false)}
          aria-label="Close listen together"
          title="Close - the music keeps playing"
          className="ml-auto cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="shrink-0 text-xs text-red-400">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tab === 'browse' ? (
            native ? <ListenBrowser /> : <ListenSearch />
          ) : session ? (
            /* Bounded on both axes, which is the whole of the "it filled the
               entire screen and ran off the bottom" bug.
        
               It was `aspect-video w-full`: at a 1750px stage that is a 984px
               tall box, and nothing above it was `min-h-0`, so flexbox let it
               push straight past the window. `flex-1 min-h-0` caps the height
               against the stage and `max-w-5xl` stops it spanning an ultrawide
               monitor.
        
               No aspect ratio here on purpose. Constraining a 16:9 box by both
               a max width and a max height cannot be done with `aspect-ratio`
               alone - whichever axis is definite wins and the other one breaks
               the shape. The player letterboxes inside whatever box it is
               given, exactly as it does on YouTube itself, so a black surround
               is both free and correct. */
            <div
              ref={playerSlot}
              aria-label="Shared video"
              className="mx-auto min-h-0 w-full max-w-5xl flex-1 rounded-lg bg-black"
            />
          ) : (
            <Empty />
          )}
        </div>

        <Queue />
      </div>

      {session && <Transport />}
    </div>
  );
}

function Empty(): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-white/10 p-6 text-center">
      <MusicIcon className="h-8 w-8 text-slate-700" />
      <p className="max-w-sm text-xs leading-relaxed text-slate-400">
        Everyone in the call hears the same track, in step, from their own
        connection - so it stays at full quality and costs nobody any upload.
        Anybody here can change what is playing.
      </p>
      {/* One button on both clients. What Browse *is* differs - the site on
          desktop, search results in a browser tab - and that is a difference
          worth having behind one word rather than in front of it. */}
      <button
        type="button"
        onClick={() => useListenStore.getState().setTab('browse')}
        className="flex cursor-pointer items-center gap-2 rounded-md bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/25"
      >
        <CompassIcon className="h-4 w-4" />
        Browse YouTube
      </button>
    </div>
  );
}

/** The shared queue, and the paste box - which is the only way in on the web. */
function Queue(): JSX.Element {
  const session = useListenStore((state) => state.session);
  const [input, setInput] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (): void => {
    const text = input.trim();
    if (!text) return;
    const failed = useListenStore.getState().add(text);
    setProblem(failed);
    if (!failed) setInput('');
  };

  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-2 lg:flex">
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder="Paste a link"
          aria-label="YouTube link"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-surface-800 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-white/20 focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!input.trim()}
          aria-label="Add to the queue"
          className="flex cursor-pointer items-center justify-center rounded-md bg-surface-800 px-2 text-slate-300 transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
      {problem && <p className="text-[11px] text-red-400">{problem}</p>}

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {(session?.queue ?? []).map((entry, index) => (
          <li key={entry.id}>
            <div
              className={`group flex items-center gap-1.5 rounded px-2 py-1.5 ${
                index === session?.index ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
              }`}
            >
              <button
                type="button"
                onClick={() => useListenStore.getState().playIndex(index)}
                className="min-w-0 flex-1 cursor-pointer text-left"
              >
                <span
                  className={`block truncate text-[11px] ${
                    index === session?.index ? 'text-slate-100' : 'text-slate-400'
                  }`}
                  title={entry.title || entry.ref}
                >
                  {entry.title || entry.ref}
                </span>
                <span className="block truncate text-[10px] text-slate-600">
                  {entry.addedByUsername}
                  {entry.durationMs > 0 ? ` · ${formatPosition(entry.durationMs)}` : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => useListenStore.getState().remove(entry.id)}
                aria-label={`Remove ${entry.title || entry.ref}`}
                className="cursor-pointer rounded p-1 text-slate-600 opacity-0 transition-opacity hover:text-slate-300 group-hover:opacity-100"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
        {!session && (
          <li className="px-2 py-1.5 text-[11px] text-slate-600">Nothing queued yet.</li>
        )}
      </ul>
    </aside>
  );
}

/**
 * The transport, and the only clock on screen drawn from a local tick.
 *
 * It has to be: the gateway sends a state when somebody presses something, not
 * sixty times a minute while nothing happens - so between messages the position
 * is worked out here, four times a second, on the offset measured against the
 * gateway's clock.
 */
export function Transport({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const session = useListenStore((state) => state.session);
  const open = useListenStore((state) => state.open);
  const volume = useListenStore((state) => state.volume);
  const ducking = useListenStore((state) => state.ducking);
  /**
   * This window's player was refused permission to start, and the room's
   * transport is not the fix for that - a click in *this* window is.
   *
   * Drawn here rather than only in the open panel, and it is the bug behind
   * "the pause button does nothing": the button's shape came from the session,
   * so a blocked window showed `pause` while it was silent. Pressing it paused
   * the track for everybody, pressing it again played it for everybody, and
   * this window stayed exactly as quiet as it was. The one press that would
   * have helped had no button at all once the panel was closed.
   */
  const blocked = useListenStore((state) => state.needsGesture);
  const [position, setPosition] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  /**
   * Where a released seek asked to be, held until the gateway agrees.
   *
   * Without this the bar visibly snaps back. Letting go clears `scrubbing`, and
   * the position underneath is still computed from the session as it was - the
   * old one - until this client's own request has gone to the gateway, been
   * ordered and come back. That is a round trip, plus up to 250ms of tick, on
   * every seek: the thumb jumps home and then forward again, which reads as
   * "seek does not work" rather than as latency, and reads worst on the person
   * furthest from the gateway.
   *
   * The rev it was sent against is what clears it, because that is the thing
   * that says the answer has arrived. The timeout is for the answer that never
   * does - a clamp to the same number, or a socket that dropped the message -
   * where holding a stale thumb for ever would be the worse failure.
   */
  const [pending, setPending] = useState<{ rev: number; positionMs: number } | null>(null);

  useEffect(() => {
    if (!session) return undefined;
    const tick = (): void =>
      setPosition(listenPositionAt(session, Date.now() + useListenStore.getState().clockOffset));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!pending) return undefined;
    if (session && session.rev > pending.rev) {
      setPending(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setPending(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [pending, session]);

  if (!session) return null;
  const track = session.queue[session.index];
  if (!track) return null;

  const duration = track.durationMs;
  const shown = scrubbing ?? pending?.positionMs ?? position;

  const release = (): void => {
    if (scrubbing === null) return;
    useListenStore.getState().seek(scrubbing);
    setPending({ rev: session.rev, positionMs: scrubbing });
    setScrubbing(null);
  };

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg bg-surface-900 px-3 py-2">
      <button
        type="button"
        onClick={() => useListenStore.getState().skip(-1)}
        aria-label="Previous"
        title="Previous"
        className="cursor-pointer rounded p-1.5 text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
      >
        <SkipBackIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() =>
          blocked ? useListenStore.getState().allow() : useListenStore.getState().playPause()
        }
        aria-label={
          blocked
            ? 'Start listening in this window'
            : session.paused
              ? 'Play for everyone'
              : 'Pause for everyone'
        }
        title={
          blocked
            ? 'This window was refused permission to start the audio - click to start it here'
            : session.paused
              ? 'Play for everyone'
              : 'Pause for everyone'
        }
        className={`cursor-pointer rounded p-1.5 transition-colors hover:bg-white/[0.06] ${
          blocked ? 'text-amber-300' : 'text-slate-100'
        }`}
      >
        {session.paused || blocked ? (
          <PlayIcon className="h-4 w-4" />
        ) : (
          <PauseIcon className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        onClick={() => useListenStore.getState().skip(1)}
        aria-label="Next"
        title="Next"
        className="cursor-pointer rounded p-1.5 text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
      >
        <SkipForwardIcon className="h-4 w-4" />
      </button>

      <div className="ml-1 flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {!open ? (
            <button
              type="button"
              onClick={() => useListenStore.getState().setOpen(true)}
              className="truncate text-left text-xs font-medium text-slate-200 transition-colors hover:text-amber-200 cursor-pointer"
              title={`${track.title || track.ref} · Click to open Listen Together`}
            >
              {track.title || 'Loading…'}
            </button>
          ) : (
            <span className="truncate text-xs text-slate-200" title={track.title || track.ref}>
              {track.title || 'Loading…'}
            </span>
          )}
          <span className="shrink-0 text-[10px] text-slate-600">{track.addedByUsername}</span>
          {blocked && (
            <span
              title="Nothing is playing in this window until it is clicked"
              className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] uppercase tracking-wide text-amber-300"
            >
              press play here
            </span>
          )}
          {ducking && (
            <span
              title="Turned down while somebody is talking"
              className="shrink-0 rounded bg-surface-800 px-1 text-[9px] uppercase tracking-wide text-amber-300"
            >
              ducked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
            {formatPosition(shown)}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(1, duration)}
            value={Math.min(shown, Math.max(1, duration))}
            disabled={duration === 0}
            aria-label="Seek for everyone"
            onChange={(event) => setScrubbing(Number(event.target.value))}
            onPointerUp={release}
            // A pointer released off the input still ends the drag: a range
            // input captures the pointer, so the browser sends the up event
            // here - but a drag cancelled by the window losing focus does not,
            // and without this the thumb would stay stuck under the hand that
            // left.
            onLostPointerCapture={release}
            onKeyUp={release}
            onBlur={release}
            className="h-1 flex-1 cursor-pointer accent-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="w-9 shrink-0 text-[10px] tabular-nums text-slate-500">
            {duration > 0 ? formatPosition(duration) : '--:--'}
          </span>
        </div>
      </div>

      {!compact && (
        <>
          {/* The only local control here: what is playing is a thing the room
              agrees on, how loud it is in one person's headphones is not. */}
          <SpeakerIcon className="ml-1 h-4 w-4 shrink-0 text-slate-500" />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            aria-label="Volume in this window"
            onChange={(event) => useListenStore.getState().setVolume(Number(event.target.value))}
            className="h-1 w-20 cursor-pointer accent-slate-400"
          />
          {!open && (
            <button
              type="button"
              onClick={() => useListenStore.getState().setOpen(true)}
              className="shrink-0 cursor-pointer rounded bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/25"
              title="Open the Listen Together stage"
            >
              Open
            </button>
          )}
          <button
            type="button"
            onClick={() => useListenStore.getState().stop()}
            className="shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
          >
            Stop
          </button>
        </>
      )}
    </div>
  );
}

/**
 * What is playing, while the panel is closed.
 *
 * One line above the tiles, so the call goes back to being a call and the music
 * is still visibly a thing that is happening - and pressing it brings the panel
 * back. The picture is parked while this is what is on screen: it carries on
 * playing in a corner nobody is looking at.
 */
export function ListenBar(): JSX.Element | null {
  const session = useListenStore((state) => state.session);
  const open = useListenStore((state) => state.open);
  if (!session || open) return null;
  return (
    <div className="shrink-0">
      <Transport />
    </div>
  );
}

function Tab({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'bg-surface-700 text-slate-100'
          : 'text-slate-400 hover:text-slate-200 disabled:cursor-not-allowed disabled:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
