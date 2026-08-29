/**
 * A voice message, drawn as one.
 *
 * What this replaces was a browser `<audio controls>` inside a card with the
 * file name and a download button under it. Every part of that was wrong for a
 * spoken message: the chrome is the browser's rather than the app's, it is a
 * different width and colour in every engine, the file name is a timestamp
 * nobody wants to read, and the whole thing announces "here is a file" when the
 * thing that arrived was somebody talking.
 *
 * So: a play button, the shape of the recording, how long it is, and nothing
 * else. The waveform is the seek bar - there is no second slider, because the
 * waveform is already a picture of the timeline and putting a track under it
 * would be drawing the same axis twice.
 *
 * The bars come from the sender, measured while the message was being recorded
 * and carried in the encrypted manifest. That is what lets the shape be on
 * screen before the audio has been fetched, which is the whole reason to draw
 * one. See `MessageAttachment.waveform`.
 */
import { useEffect, useRef, useState } from 'react';
import { VOICE_WAVEFORM_BARS, type MessageAttachment } from '@betweenus/shared-types';
import { openAttachment } from '../../services/attachments';
import { Avatar } from '../../components/Avatar';
import { MicIcon, PauseIcon, PlayIcon } from '../../components/icons';

/**
 * What to draw when the sender's client never measured one - audio picked off
 * a disk, or a message sent before waveforms existed.
 *
 * A gentle repeating shape rather than a flat line or random noise. Flat reads
 * as a broken file; random reads as a real waveform and is a lie about where
 * the loud parts are. This is visibly a placeholder and still gives the eye
 * something to aim a click at.
 */
const PLACEHOLDER = Array.from({ length: VOICE_WAVEFORM_BARS }, (_, index) =>
  0.35 + 0.25 * Math.sin(index / 2.2),
);

export function VoiceMessage({
  channelId,
  attachment,
  author,
  mine,
}: {
  channelId: string;
  attachment: MessageAttachment;
  /** Drawn on the bubble the way every phone messenger draws a voice note. */
  author?: { displayName: string; avatarUrl: string | null };
  /** Whether this account sent it, which decides the accent. */
  mine?: boolean;
}): JSX.Element {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  /**
   * The length the element reports, once it knows one.
   *
   * Preferred over the manifest's number because it is the one the seek maths
   * has to agree with - a bar clicked at 40% has to land at 40% of what the
   * element will actually play. The manifest's value is what gets drawn before
   * there is an element at all, which is most of the time this is on screen.
   */
  const [measured, setMeasured] = useState<number | null>(null);

  const bars = attachment.waveform?.length ? attachment.waveform : PLACEHOLDER;
  const total = measured ?? attachment.duration ?? 0;
  const fraction = total > 0 ? Math.min(1, at / total) : 0;

  /**
   * Fetched and decrypted as soon as it is drawn, without being asked.
   *
   * A voice message is seconds long and tens of kilobytes. Making somebody
   * press a download button, wait, and then press play is three interactions
   * for something that should be one - and the button was the honest answer
   * only while the alternative was spending a video's worth of somebody's
   * connection on a message they scrolled past. That is not this.
   */
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    void openAttachment(channelId, attachment)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailure('This voice message could not be opened');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [channelId, attachment]);

  const toggle = (): void => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setFailure('That could not be played'));
    else element.pause();
  };

  /** Where in the message a click on the waveform lands. */
  const seekTo = (event: React.MouseEvent<HTMLDivElement>): void => {
    const element = audio.current;
    if (!element || total <= 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    element.currentTime = ratio * total;
    setAt(element.currentTime);
  };

  const accent = mine ? 'bg-accent' : 'bg-slate-200';
  const spent = Math.round(fraction * bars.length);

  return (
    <div className="mt-1 flex max-w-sm items-center gap-3 rounded-2xl border border-edge bg-surface-850 px-3 py-2.5">
      {author && (
        <div className="relative shrink-0">
          <Avatar
            name={author.displayName}
            avatarUrl={author.avatarUrl}
            ringColour="border-surface-850"
          />
          {/* The mark that says what kind of message this is, on the one part
              of the bubble that is otherwise just a face. */}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface-850">
            <MicIcon className={`h-3 w-3 ${mine ? 'text-accent' : 'text-slate-400'}`} />
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-100 transition-colors duration-200 disabled:cursor-progress disabled:opacity-50"
      >
        {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
      </button>

      <div className="min-w-0 flex-1">
        {/* The waveform *is* the seek bar. A slider underneath would be the
            same axis drawn twice. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(at)}
          onClick={seekTo}
          onKeyDown={(event) => {
            const element = audio.current;
            if (!element) return;
            if (event.key === 'ArrowLeft') element.currentTime = Math.max(0, element.currentTime - 5);
            if (event.key === 'ArrowRight') element.currentTime = Math.min(total, element.currentTime + 5);
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              toggle();
            }
          }}
          className="flex h-8 cursor-pointer items-center gap-[2px]"
        >
          {bars.map((height, index) => (
            <span
              key={index}
              className={`w-full rounded-full transition-colors duration-100 ${
                index < spent ? accent : 'bg-slate-600'
              }`}
              // A floor in pixels as well as in the data: a bar rounded to
              // less than two pixels disappears at some zoom levels, and a
              // waveform with holes in it reads as a damaged file.
              style={{ height: `${Math.max(3, Math.round(height * 26))}px` }}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="tabular-nums">
            {/* While it is playing, how far in; otherwise how long it is.
                Both are the number somebody wants at that moment, and showing
                "0:00 / 0:07" is showing one of them twice. */}
            {formatClock(playing || at > 0 ? at : total)}
          </span>
          {failure && <span className="truncate text-danger">{failure}</span>}
          {!failure && !url && <span className="truncate">Decrypting…</span>}
        </div>
      </div>

      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const length = event.currentTarget.duration;
            // A stream with no seekable length reports Infinity, which is what
            // a WebM written by MediaRecorder does until it has been played
            // through once. The manifest's number covers exactly that case.
            if (Number.isFinite(length) && length > 0) setMeasured(length);
          }}
          onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            // Back to the start, so the next press replays rather than doing
            // nothing - and so the waveform empties again.
            setAt(0);
            if (audio.current) audio.current.currentTime = 0;
          }}
          className="hidden"
        />
      )}
    </div>
  );
}

/** `m:ss`. Seconds are floored, so a message never reads one second long than it is. */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}`;
}
