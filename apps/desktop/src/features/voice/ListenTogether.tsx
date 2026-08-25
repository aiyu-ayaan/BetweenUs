/**
 * The Listen Together panel: what is playing, what is next, and the buttons
 * anybody in the call may press.
 *
 * A popover on the call controls rather than a rail in the voice screen,
 * because `VoiceControls` is shared by the sidebar and the full-screen view -
 * hanging it there means it works in both without either of them knowing it
 * exists.
 *
 * Nothing here decides anything. Every button sends an action to the gateway
 * and the panel redraws when the gateway says what came of it, which is what
 * makes two people pressing skip at the same moment resolve to one skip instead
 * of two. There is deliberately no optimistic update: a queue that moved on
 * this screen and nowhere else is the exact failure this feature is about.
 *
 * The position on the seek bar is the only thing drawn from a local clock, and
 * it is drawn four times a second from the shared one. It has to be: the
 * gateway sends a state when something happens, not sixty times a minute while
 * nothing does.
 */
import { useEffect, useRef, useState } from 'react';
import { listenPositionAt } from '@betweenus/shared-types';
import { useListenStore } from '../../stores/listen';
import { useVoiceStore } from '../../stores/voice';
import { formatPosition } from '../../services/listen-sync';
import {
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

export function ListenTogether({ onClose }: { onClose: () => void }): JSX.Element {
  const session = useListenStore((state) => state.session);
  const volume = useListenStore((state) => state.volume);
  const ducking = useListenStore((state) => state.ducking);
  const needsGesture = useListenStore((state) => state.needsGesture);
  const error = useListenStore((state) => state.error);
  const tiles = useVoiceStore((state) => state.tiles);

  const [input, setInput] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const track = session ? (session.queue[session.index] ?? null) : null;
  const duration = track?.durationMs ?? 0;

  // Redrawn from the shared clock rather than from a message, because the
  // gateway speaks when something happens and a seek bar has to move when
  // nothing does. Four times a second is smooth to a person and nothing to a
  // renderer that is already drawing a call.
  useEffect(() => {
    if (!session) return undefined;
    const tick = (): void =>
      setPosition(listenPositionAt(session, Date.now() + serverOffset()));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (): void => {
    const text = input.trim();
    if (!text) return;
    const failed = useListenStore.getState().add(text);
    setProblem(failed);
    if (!failed) setInput('');
  };

  const shown = scrubbing ?? position;
  const named = (userId: string): string =>
    tiles.find((tile) => tile.userId === userId)?.name ?? 'someone';

  return (
    <div className="absolute bottom-full right-0 z-30 mb-2 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border border-white/10 bg-surface-900 p-3 shadow-xl">
      <div className="flex items-center gap-2">
        <MusicIcon className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-medium text-slate-200">Listen together</span>
        {ducking && (
          <span
            className="rounded bg-surface-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300"
            title="Turned down while somebody is talking"
          >
            ducked
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close listen together"
          className="ml-auto cursor-pointer rounded p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {/* The whole feature, in one line, for whoever opens this and wonders
          why it is not a screen share. */}
      {!session && (
        <p className="text-xs leading-relaxed text-slate-400">
          Paste a YouTube link and everyone in the call hears it, in step, from
          their own connection. Nothing is streamed between you, so it stays at
          full quality - and anybody here can change what is playing.
        </p>
      )}

      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder="Paste a YouTube link"
          aria-label="YouTube link"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-surface-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-white/20 focus:outline-none"
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

      {(problem ?? error) && <p className="text-xs text-red-400">{problem ?? error}</p>}

      {/* The browser refused to start audio nobody in this window asked for.
          Nothing in here can fix that; a click can, and saying so beats a
          session that looks like it is playing and is silent. */}
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

      {session && track && (
        <>
          <div className="flex flex-col gap-1">
            <span className="truncate text-sm text-slate-200" title={track.title || track.ref}>
              {track.title || 'Loading…'}
            </span>
            <span className="text-xs text-slate-500">
              Added by {track.addedByUsername}
              {session.byUserId && session.byUserId !== track.addedByUserId
                ? ` · ${named(session.byUserId)} last changed it`
                : ''}
            </span>
          </div>

          {/* Disabled until a length is known: a scrubber with no scale is a
              control that does something unpredictable, which is worse than one
              that is plainly not ready. */}
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
              aria-label="Seek"
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
            <TransportButton
              label="Previous track"
              onClick={() => useListenStore.getState().skip(-1)}
            >
              <SkipBackIcon className="h-4 w-4" />
            </TransportButton>
            <TransportButton
              label={session.paused ? 'Play for everyone' : 'Pause for everyone'}
              onClick={() => useListenStore.getState().playPause()}
            >
              {session.paused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}
            </TransportButton>
            <TransportButton label="Next track" onClick={() => useListenStore.getState().skip(1)}>
              <SkipForwardIcon className="h-4 w-4" />
            </TransportButton>

            {/* Local, and the only control here that is: what is playing is a
                thing the room agrees on, how loud it is in one person's
                headphones is not. */}
            <SpeakerIcon className="ml-2 h-4 w-4 shrink-0 text-slate-500" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              aria-label="Volume in this window"
              onChange={(event) => useListenStore.getState().setVolume(Number(event.target.value))}
              className="h-1 w-20 cursor-pointer accent-slate-400"
            />

            <button
              type="button"
              onClick={() => useListenStore.getState().stop()}
              className="ml-auto cursor-pointer rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
            >
              Stop
            </button>
          </div>

          <ul className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
            {session.queue.map((entry, index) => (
              <li key={entry.id}>
                <div
                  className={`group flex items-center gap-2 rounded px-2 py-1.5 ${
                    index === session.index ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => useListenStore.getState().playIndex(index)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                  >
                    <span
                      className={`block truncate text-xs ${
                        index === session.index ? 'text-slate-100' : 'text-slate-400'
                      }`}
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
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The gateway's clock offset, read straight rather than subscribed to.
 *
 * It changes by a millisecond or two every fifteen seconds and nothing on
 * screen should re-render for that; the seek bar reads it on its own tick.
 */
function serverOffset(): number {
  return useListenStore.getState().clockOffset;
}

function TransportButton({
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
