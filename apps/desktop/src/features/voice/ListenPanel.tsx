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
 * **Listen Together is audio.** There is no picture and no rectangle for one,
 * which is most of why this file is shorter than it was: the player is a hidden
 * view on desktop and a parked frame on the web, and neither is ever shown. The
 * shared thing is the track, the queue and the position - a picture would only
 * be a second screen share nobody asked for, costing everybody the upload the
 * feature exists to avoid.
 *
 * Two tabs, because only one of them can have the space:
 *
 *   Browse   - the real youtube.com, signed in as you, on desktop; search
 *              results in a browser tab, which is as close as a web page is
 *              allowed to get. The default, because looking for something to
 *              play is what opening this means.
 *   Playing  - what the call is listening to, and the queue beside it.
 *
 * The browse tab draws nothing itself: it offers an empty rectangle and the
 * main process puts a `WebContentsView` over it, so switching tabs or closing
 * the panel cannot destroy a sign-in or a half-typed search. See
 * `stores/listen.ts` and `electron/youtube-view.ts`.
 */
import { useEffect, useState } from 'react';
import { listenPositionAt } from '@betweenus/shared-types';
import { useListenStore } from '../../stores/listen';
import { useAppsStore } from '../../stores/apps';
import { formatPosition } from '../../services/listen-sync';
import { isDesktopRuntime } from '../../services/platform';
import { ListenBrowser } from './ListenBrowser';
import { ListenSearch } from './ListenSearch';
import {
  ChevronLeftIcon,
  CompassIcon,
  InfoIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  TrashIcon,
  XIcon,
} from '../../components/icons';

export function ListenPanel(): JSX.Element {
  const session = useListenStore((state) => state.session);
  const tab = useListenStore((state) => state.tab);
  const error = useListenStore((state) => state.error);
  const currentTrack = session ? session.queue[session.index] : undefined;

  /**
   * The desktop app frames youtube.com itself; a browser tab cannot, and gets
   * search results instead. Both are the same gesture - find something, press
   * it, the call watches it - so both live on the same Browse tab rather than
   * one of them being a lesser thing hidden somewhere else.
   */
  const native = isDesktopRuntime() && Boolean(window.betweenus?.youtubeOpen);

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
          className="spring-press -ms-1 cursor-pointer rounded p-1 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <MusicIcon className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="text-sm font-medium text-slate-200">Listen together</span>
        <span className="relative group/tag inline-flex items-center">
          <span
            title="Listening together is in alpha phase and will not able to play songs."
            className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300 cursor-help"
          >
            <InfoIcon className="h-2.5 w-2.5 shrink-0 text-amber-300" />
            <span>alpha</span>
          </span>
          <span
            role="tooltip"
            className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-30 hidden w-52 rounded bg-slate-900/95 px-2 py-1 text-center text-[10px] leading-tight text-slate-200 shadow-xl border border-white/15 group-hover/tag:block"
          >
            Listening together is in alpha phase and will not able to play songs.
          </span>
        </span>

        <div className="ms-2 flex items-center gap-0.5 rounded-md bg-surface-900 p-0.5">
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
          className="spring-press ms-auto cursor-pointer rounded p-1 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {error && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 font-medium text-amber-400">Notice:</span>
            <span className="truncate">{error}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {currentTrack && (
              <a
                href={`https://www.youtube.com/watch?v=${currentTrack.ref}`}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded bg-white/10 px-2 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:bg-white/20"
              >
                Watch on YouTube
              </a>
            )}
            <button
              type="button"
              onClick={() => useListenStore.getState().skip(1)}
              className="cursor-pointer rounded bg-amber-500/20 px-2 py-1 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/30"
            >
              Skip Track
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tab === 'browse' ? (
            native ? <ListenBrowser /> : <ListenSearch />
          ) : session ? (
            <NowPlaying />
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

/**
 * What is on, with no picture to show for it.
 *
 * The transport under the panel already carries the title, the position and the
 * controls, so this is deliberately not a second copy of them - it is the
 * answer to "is anything happening", which a blank rectangle used to give
 * wrongly once the video went away.
 */
function NowPlaying(): JSX.Element {
  const session = useListenStore((state) => state.session);
  const ducking = useListenStore((state) => state.ducking);
  const track = session?.queue[session.index] ?? null;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-white/5 bg-surface-900/60 p-6 text-center">
      <MusicIcon className="h-10 w-10 text-slate-700" />
      <div className="min-w-0 max-w-full">
        <p className="truncate text-sm font-medium text-slate-200">
          {track?.title || 'Loading track...'}
        </p>
        {track?.addedByUsername && (
          <p className="mt-0.5 truncate text-xs text-slate-500">
            added by {track.addedByUsername}
          </p>
        )}
      </div>
      {/* Not decoration: two people with microphones open otherwise wonder why
          the music went quiet, and reach for the volume rather than waiting. */}
      {ducking && (
        <p className="text-[11px] text-amber-300/80">Turned down while somebody is talking</p>
      )}
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
        Anybody here can change what is playing. Audio only: nothing is
        streamed between you, just the queue and a timestamp.
      </p>
      {/* One button on both clients. What Browse *is* differs - the site on
          desktop, search results in a browser tab - and that is a difference
          worth having behind one word rather than in front of it. */}
      <button
        type="button"
        onClick={() => useListenStore.getState().setTab('browse')}
        className="spring-press flex cursor-pointer items-center gap-2 rounded-md bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
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
          className="spring-press flex cursor-pointer items-center justify-center rounded-md bg-surface-800 px-2 text-slate-300 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
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
                className="min-w-0 flex-1 cursor-pointer text-start"
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
                className="spring-press cursor-pointer rounded p-1 text-slate-600 opacity-0 transition-opacity hover:text-slate-300 group-hover:opacity-100"
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

  const [previousVolume, setPreviousVolume] = useState(60);

  const toggleMute = (): void => {
    if (volume > 0) {
      setPreviousVolume(volume);
      useListenStore.getState().setVolume(0);
    } else {
      useListenStore.getState().setVolume(previousVolume > 0 ? previousVolume : 60);
    }
  };

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
        className="spring-press cursor-pointer rounded p-1.5 text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"
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
        className={`spring-press cursor-pointer rounded p-1.5 hover:bg-white/[0.06] ${
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
        className="spring-press cursor-pointer rounded p-1.5 text-slate-300 hover:bg-white/[0.06] hover:text-slate-100"
      >
        <SkipForwardIcon className="h-4 w-4" />
      </button>

      <div className="ms-1 flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {!open ? (
            <button
              type="button"
              onClick={() => useListenStore.getState().setOpen(true)}
              className="truncate text-start text-xs font-medium text-slate-200 transition-colors hover:text-amber-200 cursor-pointer"
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
          <span className="w-9 shrink-0 text-end text-[10px] tabular-nums text-slate-500">
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
          <button
            type="button"
            onClick={toggleMute}
            className="spring-press ms-1 cursor-pointer rounded p-1 text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
            title={volume === 0 ? 'Unmute music' : 'Mute music'}
            aria-label={volume === 0 ? 'Unmute music' : 'Mute music'}
          >
            {volume === 0 ? (
              <SpeakerOffIcon className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <SpeakerIcon className="h-4 w-4 shrink-0 text-slate-400" />
            )}
          </button>
          <div className="flex items-center gap-1.5" title={`Volume: ${volume}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              aria-label="Volume in this window"
              onChange={(event) => useListenStore.getState().setVolume(Number(event.target.value))}
              className="h-1 w-20 cursor-pointer accent-amber-400"
            />
            <span className="w-6 shrink-0 text-[10px] tabular-nums text-slate-500">
              {volume}%
            </span>
          </div>
          {!open && (
            <button
              type="button"
              onClick={() => useListenStore.getState().setOpen(true)}
              className="spring-press shrink-0 cursor-pointer rounded bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25"
              title="Open the Listen Together stage"
            >
              Open
            </button>
          )}
          <button
            type="button"
            onClick={() => useListenStore.getState().stop()}
            className="spring-press shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
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
      className={`spring-press flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs ${
        active
          ? 'bg-surface-700 text-slate-100'
          : 'text-slate-400 hover:text-slate-200 disabled:cursor-not-allowed disabled:text-slate-700 disabled:active:scale-100'
      }`}
    >
      {children}
    </button>
  );
}
