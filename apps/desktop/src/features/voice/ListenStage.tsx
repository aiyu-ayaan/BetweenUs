/**
 * The picture, and the transport under it.
 *
 * This component draws no video. It offers the player somewhere to *be* - an
 * empty box, whose rectangle the store's frame is positioned over - and draws
 * everything around it.
 *
 * That indirection is the whole trick, and it is not decoration. An iframe
 * removed from the document stops playing and loses its place, so a frame
 * rendered as a child of a React component dies every time that component
 * unmounts: closing a panel, switching to a text channel, paging the grid. A
 * remounted frame is a fresh player, back at zero, refused autoplay, and out of
 * step with the room. So the frame never moves in the DOM and this hands it a
 * rectangle instead - and when this unmounts, the music simply carries on from
 * a corner nobody is looking at.
 */
import { useEffect, useRef, useState } from 'react';
import { listenPositionAt } from '@betweenus/shared-types';
import { claimListenSlot, useListenStore } from '../../stores/listen';
import { formatPosition } from '../../services/listen-sync';
import {
  ChevronDownIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerIcon,
  XIcon,
} from '../../components/icons';

export function ListenStage(): JSX.Element | null {
  const session = useListenStore((state) => state.session);
  const volume = useListenStore((state) => state.volume);
  const ducking = useListenStore((state) => state.ducking);
  const needsGesture = useListenStore((state) => state.needsGesture);
  const collapsed = useListenStore((state) => state.collapsed);

  const slot = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const track = session ? (session.queue[session.index] ?? null) : null;

  // The claim, and the release. Releasing on the way out is what parks the
  // picture rather than leaving it floating over whatever replaced this screen.
  useEffect(() => {
    if (!session || collapsed) {
      claimListenSlot(null);
      return undefined;
    }
    claimListenSlot(slot.current);
    return () => claimListenSlot(null);
  }, [session, collapsed]);

  useEffect(() => {
    if (!session) return undefined;
    const tick = (): void =>
      setPosition(listenPositionAt(session, Date.now() + useListenStore.getState().clockOffset));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [session]);

  if (!session || !track) return null;

  const duration = track.durationMs;
  const shown = scrubbing ?? position;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => useListenStore.getState().setCollapsed(false)}
        className="flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-surface-900 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <MusicIcon className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="truncate text-xs text-slate-300">{track.title || track.ref}</span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-500">
          {formatPosition(shown)}
        </span>
      </button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <MusicIcon className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="truncate text-sm text-slate-200" title={track.title || track.ref}>
          {track.title || 'Loading…'}
        </span>
        <span className="shrink-0 text-xs text-slate-500">· {track.addedByUsername}</span>
        {ducking && (
          <span
            title="Turned down while somebody is talking"
            className="shrink-0 rounded bg-surface-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300"
          >
            ducked
          </span>
        )}
        <button
          type="button"
          onClick={() => useListenStore.getState().setCollapsed(true)}
          aria-label="Collapse the video"
          title="Collapse - the music keeps playing"
          className="ml-auto cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <ChevronDownIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => useListenStore.getState().stop()}
          aria-label="Stop listening together"
          title="Stop for everybody"
          className="cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {/* The slot. Deliberately empty - the player's frame is positioned over
          this rectangle rather than rendered into it, so that unmounting this
          component cannot take the music with it. */}
      <div
        ref={slot}
        className="aspect-video w-full overflow-hidden rounded-lg bg-black"
        aria-label="Shared video"
      />

      {needsGesture && (
        <button
          type="button"
          onClick={() => useListenStore.getState().allow()}
          className="flex items-center justify-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200 transition-colors hover:bg-amber-500/20"
        >
          <PlayIcon className="h-4 w-4" />
          Your browser blocked the audio - click to start listening
        </button>
      )}

      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-slate-500">
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
          onPointerUp={() => {
            if (scrubbing !== null) useListenStore.getState().seek(scrubbing);
            setScrubbing(null);
          }}
          onKeyUp={() => {
            if (scrubbing !== null) useListenStore.getState().seek(scrubbing);
            setScrubbing(null);
          }}
          className="h-1 flex-1 cursor-pointer accent-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
        />
        <span className="w-10 shrink-0 text-[11px] tabular-nums text-slate-500">
          {duration > 0 ? formatPosition(duration) : '--:--'}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <StageButton label="Previous" onClick={() => useListenStore.getState().skip(-1)}>
          <SkipBackIcon className="h-4 w-4" />
        </StageButton>
        <StageButton
          label={session.paused ? 'Play for everyone' : 'Pause for everyone'}
          onClick={() => useListenStore.getState().playPause()}
        >
          {session.paused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}
        </StageButton>
        <StageButton label="Next" onClick={() => useListenStore.getState().skip(1)}>
          <SkipForwardIcon className="h-4 w-4" />
        </StageButton>

        {/* The only local control here: what is playing is a thing the room
            agrees on, how loud it is in one person's headphones is not. */}
        <SpeakerIcon className="ml-2 h-4 w-4 shrink-0 text-slate-500" />
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          aria-label="Volume in this window"
          onChange={(event) => useListenStore.getState().setVolume(Number(event.target.value))}
          className="h-1 w-24 cursor-pointer accent-slate-400"
        />

        <span className="ml-auto text-[11px] text-slate-600">
          {session.queue.length} in the queue
        </span>
      </div>
    </div>
  );
}

function StageButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex cursor-pointer items-center justify-center rounded-md bg-surface-800 p-2 text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
    >
      {children}
    </button>
  );
}
