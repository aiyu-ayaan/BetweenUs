/**
 * Posting a status: a picture, a video, or words on a colour, full screen.
 *
 * Three kinds behind one screen rather than three screens, because they are
 * the same act - the only thing that differs is what gets attached. The text
 * kind exists precisely because it needs no camera and no file: it is the one
 * people use most, and making it a mode of the picture composer would bury it.
 *
 * Nothing is uploaded until Post: the preview is a local object URL, so
 * choosing a file and changing your mind costs nothing and leaves nothing on
 * the server. That is also why posting sends the bytes and the caption in one
 * request - see `api.postStatus`.
 */
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  STATUS_BACKGROUNDS,
  STATUS_CAPTION_MAX_LENGTH,
  STATUS_VIDEO_MAX_MS,
  type CreateStatusRequest,
  type StatusKind,
} from '@betweenus/shared-types';
import { useStatusStore } from '../../stores/status';
import { shrinkImage } from '../../services/attachments';
import { useFocusTrap } from '../../services/focus-trap';
import { ImageIcon, PencilIcon, VideoIcon, XIcon } from '../../components/icons';

const useComposer = create<{ open: boolean }>(() => ({ open: false }));

export function openStatusComposer(): void {
  useComposer.setState({ open: true });
}

export function StatusComposer(): JSX.Element | null {
  const open = useComposer((state) => state.open);
  return open ? <Composer /> : null;
}

interface Draft {
  kind: StatusKind;
  /** What will be uploaded: the shrunk picture, or the video as it was picked. */
  blob: Blob;
  /** A local object URL for the preview. Revoked when the draft is dropped. */
  preview: string;
  /** Measured from the file itself, for a video. */
  durationMs?: number;
}

function Composer(): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const post = useStatusStore((state) => state.post);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [background, setBackground] = useState<string>(STATUS_BACKGROUNDS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picture = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);

  const close = (): void => {
    if (draft) URL.revokeObjectURL(draft.preview);
    useComposer.setState({ open: false });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const choose = async (file: File | undefined, kind: 'PHOTO' | 'VIDEO'): Promise<void> => {
    if (!file) return;
    setError(null);
    try {
      if (kind === 'PHOTO') {
        // The same shrink an attached photo gets: a status is looked at on a
        // phone for five seconds, and a 12-megapixel original is bytes nobody
        // sees. It also settles the format - the server takes the bytes it can
        // recognise, and this hands it a JPEG.
        const shrunk = await shrinkImage(file);
        const blob = shrunk?.blob ?? file;
        setDraft({ kind, blob, preview: URL.createObjectURL(blob) });
        return;
      }
      const preview = URL.createObjectURL(file);
      const durationMs = await videoDuration(preview);
      setDraft({
        kind,
        blob: file,
        preview,
        // Clamped, not cut: the file goes up whole and the viewer stops at the
        // cap. See STATUS_VIDEO_MAX_MS.
        durationMs: Math.min(durationMs, STATUS_VIDEO_MAX_MS),
      });
    } catch {
      setError('That file could not be read');
    }
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const request: CreateStatusRequest = draft
        ? {
            kind: draft.kind,
            ...(caption.trim() ? { caption: caption.trim() } : {}),
            ...(draft.durationMs ? { durationMs: Math.round(draft.durationMs) } : {}),
          }
        : { kind: 'TEXT', caption: text.trim(), background };
      await post(request, draft?.blob);
      close();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'That could not be posted');
      setBusy(false);
    }
  };

  const ready = draft ? true : text.trim().length > 0;

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="Add an update"
      className="fixed inset-0 z-[70] flex animate-fade flex-col bg-black/95"
    >
      <header className="flex items-center gap-3 px-4 py-3 text-white">
        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label="Cancel"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <h1 className="flex-1 text-sm font-semibold">Add an update</h1>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready || busy}
          className="cursor-pointer rounded-full bg-accent px-5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pb-4">
        {draft ? (
          <>
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
              {draft.kind === 'PHOTO' ? (
                <img src={draft.preview} alt="" className="h-full w-full object-contain" />
              ) : (
                <video
                  src={draft.preview}
                  controls
                  playsInline
                  className="h-full w-full object-contain"
                />
              )}
            </div>
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={STATUS_CAPTION_MAX_LENGTH}
              placeholder="Add a caption…"
              className="mt-3 w-full rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(draft.preview);
                setDraft(null);
                setCaption('');
              }}
              className="mt-2 cursor-pointer self-center text-xs text-white/60 underline-offset-2 hover:text-white hover:underline"
            >
              Choose something else
            </button>
          </>
        ) : (
          <>
            {/* The text status is the default, not a third tab: it is the one
                that needs nothing but the keyboard already on screen. */}
            <div
              className="flex min-h-0 flex-1 items-center justify-center rounded-xl px-6 transition-colors"
              style={{ backgroundColor: background }}
            >
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={STATUS_CAPTION_MAX_LENGTH}
                placeholder="Type an update"
                aria-label="Update text"
                className="h-full w-full resize-none bg-transparent text-center text-2xl font-semibold leading-snug text-white placeholder:text-white/50 focus:outline-none"
              />
            </div>

            <div className="mt-3 flex items-center justify-center gap-2">
              {STATUS_BACKGROUNDS.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  onClick={() => setBackground(colour)}
                  aria-label={`Background ${colour}`}
                  aria-pressed={background === colour}
                  style={{ backgroundColor: colour }}
                  className={`h-7 w-7 cursor-pointer rounded-full border-2 transition-transform ${
                    background === colour ? 'scale-110 border-white' : 'border-transparent'
                  }`}
                />
              ))}
            </div>

            <div className="mt-4 flex items-center justify-center gap-3">
              <Pick
                label="Photo"
                icon={<ImageIcon className="h-5 w-5" />}
                onClick={() => picture.current?.click()}
              />
              <Pick
                label="Video"
                icon={<VideoIcon className="h-5 w-5" />}
                onClick={() => video.current?.click()}
              />
              <Pick label="Text" icon={<PencilIcon className="h-5 w-5" />} active />
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-center text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <input
        ref={picture}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void choose(event.target.files?.[0], 'PHOTO');
          event.target.value = '';
        }}
      />
      <input
        ref={video}
        type="file"
        accept="video/mp4,video/webm"
        hidden
        onChange={(event) => {
          void choose(event.target.files?.[0], 'VIDEO');
          event.target.value = '';
        }}
      />
    </div>
  );
}

function Pick({
  label,
  icon,
  onClick,
  active = false,
}: {
  label: string;
  icon: JSX.Element;
  onClick?: () => void;
  active?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors ${
        active ? 'bg-white/20 text-white' : 'bg-white/10 text-white/80 hover:bg-white/20'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * How long a picked video runs.
 *
 * Read from a detached `<video>` because that is the only thing in a browser
 * that can answer it, and the answer can be `Infinity` for a stream-shaped
 * file - which is treated as the cap rather than as a failure, so a clip that
 * will not report its length still posts.
 */
function videoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const element = document.createElement('video');
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      const seconds = element.duration;
      resolve(Number.isFinite(seconds) ? seconds * 1000 : STATUS_VIDEO_MAX_MS);
    };
    element.onerror = () => resolve(STATUS_VIDEO_MAX_MS);
    element.src = url;
  });
}
