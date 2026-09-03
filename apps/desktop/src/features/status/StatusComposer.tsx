/**
 * Posting a status: pictures, a video, or words on a colour, full screen.
 *
 * Two kinds behind one screen rather than two screens, because they are the
 * same act - the only thing that differs is what gets attached. The text kind
 * exists precisely because it needs no camera and no file: it is the one
 * people use most, and making it a mode of the picture composer would bury it.
 *
 * One picker for both pictures and clips, because "photo or video" is a
 * question about the file rather than about the person: they reach for a
 * moment, not for a format, and the kind is read off `file.type`. Several at a
 * time, because a moment is usually more than one frame - each becomes its own
 * post, unless Layout is on and they are drawn onto a single one.
 *
 * Nothing is uploaded until Post: the preview is a local object URL, so
 * choosing files and changing your mind costs nothing and leaves nothing on
 * the server. That is also why posting sends the bytes and the caption in one
 * request - see `api.postStatus`.
 */
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import {
  STATUS_BACKGROUNDS,
  STATUS_CAPTION_MAX_LENGTH,
  STATUS_VIDEO_MAX_MS,
  type StatusKind,
} from '@betweenus/shared-types';
import { useStatusStore, type StatusDraft } from '../../stores/status';
import { shrinkImage } from '../../services/attachments';
import { useFocusTrap } from '../../services/focus-trap';
import { ImageIcon, LayoutSidebarIcon, PencilIcon, XIcon } from '../../components/icons';

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

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [layout, setLayout] = useState(false);
  const [text, setText] = useState('');
  const [caption, setCaption] = useState('');
  const [background, setBackground] = useState<string>(STATUS_BACKGROUNDS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const media = useRef<HTMLInputElement>(null);

  // Layout draws pictures onto one picture, and a video is not a picture. It
  // is offered on two or more, and only when every one of them is one.
  const layoutable = drafts.length > 1 && drafts.every((draft) => draft.kind === 'PHOTO');
  const collaging = layout && layoutable;

  const close = (): void => {
    drafts.forEach((draft) => URL.revokeObjectURL(draft.preview));
    useComposer.setState({ open: false });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const choose = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setError(null);
    const picked: Draft[] = [];
    for (const file of Array.from(files)) {
      try {
        if (file.type.startsWith('video/')) {
          const preview = URL.createObjectURL(file);
          const durationMs = await videoDuration(preview);
          picked.push({
            kind: 'VIDEO',
            blob: file,
            preview,
            // Clamped, not cut: the file goes up whole and the viewer stops at
            // the cap. See STATUS_VIDEO_MAX_MS.
            durationMs: Math.min(durationMs, STATUS_VIDEO_MAX_MS),
          });
          continue;
        }
        // The same shrink an attached photo gets: a status is looked at on a
        // phone for five seconds, and a 12-megapixel original is bytes nobody
        // sees. It also settles the format - the server takes the bytes it can
        // recognise, and this hands it a JPEG.
        const shrunk = await shrinkImage(file);
        const blob = shrunk?.blob ?? file;
        picked.push({ kind: 'PHOTO', blob, preview: URL.createObjectURL(blob) });
      } catch {
        setError('That file could not be read');
      }
    }
    setDrafts((was) => [...was, ...picked]);
  };

  const drop = (at: number): void => {
    setDrafts((was) => {
      const going = was[at];
      if (going) URL.revokeObjectURL(going.preview);
      return was.filter((_, index) => index !== at);
    });
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const words = caption.trim();
    try {
      if (drafts.length === 0) {
        await post({ kind: 'TEXT', caption: text.trim(), background });
      } else if (collaging) {
        const drawn = await collage(drafts.map((draft) => draft.blob));
        await post({ kind: 'PHOTO', ...(words ? { caption: words } : {}) }, drawn);
      } else {
        // One post each, in the order they were picked, so the run reads the
        // way the roll did. Sequential rather than parallel: each seals against
        // the audience and appends to the tray, and the tray is one list.
        for (const draft of drafts) {
          const request: StatusDraft = {
            kind: draft.kind,
            ...(words ? { caption: words } : {}),
            ...(draft.durationMs ? { durationMs: Math.round(draft.durationMs) } : {}),
          };
          await post(request, draft.blob);
        }
      }
      close();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'That could not be posted');
      setBusy(false);
    }
  };

  const ready = drafts.length > 0 ? true : text.trim().length > 0;

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="Add a moment"
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
        <h1 className="flex-1 text-sm font-semibold">Add a moment</h1>
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
        {drafts.length > 0 ? (
          <>
            <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
              {collaging ? (
                // What the drawn picture will look like, laid out the way
                // `collage` lays it out: a square grid, cover-cropped.
                <div
                  className="grid h-full w-full gap-0.5"
                  style={{
                    gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(drafts.length))}, minmax(0, 1fr))`,
                  }}
                >
                  {drafts.map((draft) => (
                    <img
                      key={draft.preview}
                      src={draft.preview}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ))}
                </div>
              ) : drafts[0]?.kind === 'PHOTO' ? (
                <img src={drafts[0].preview} alt="" className="h-full w-full object-contain" />
              ) : (
                <video
                  src={drafts[0]?.preview}
                  controls
                  playsInline
                  className="h-full w-full object-contain"
                />
              )}
            </div>

            {drafts.length > 1 && !collaging && (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {drafts.map((draft, at) => (
                  <button
                    key={draft.preview}
                    type="button"
                    onClick={() => drop(at)}
                    aria-label={`Remove item ${at + 1}`}
                    title="Remove"
                    className="relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-white/15"
                  >
                    <img src={draft.preview} alt="" className="h-full w-full object-cover" />
                    <span className="absolute right-0.5 top-0.5 rounded-full bg-black/70 px-1 text-[10px] text-white">
                      ✕
                    </span>
                  </button>
                ))}
              </div>
            )}

            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={STATUS_CAPTION_MAX_LENGTH}
              placeholder="Add a caption…"
              className="mt-3 w-full rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-accent focus:outline-none"
            />
          </>
        ) : (
          <>
            {/* The text status is the default, not a second tab: it is the one
                that needs nothing but the keyboard already on screen. */}
            <div
              className="flex min-h-0 flex-1 items-center justify-center rounded-xl px-6 transition-colors"
              style={{ backgroundColor: background }}
            >
              {/* Not `h-full`: a box that fills the panel puts its first line,
                  and the placeholder with it, hard against the top edge. Sized
                  to its rows and centred by the flex box around it, which is
                  where a moment of words belongs. */}
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={STATUS_CAPTION_MAX_LENGTH}
                rows={4}
                placeholder="Type a moment"
                aria-label="Moment text"
                className="max-h-full w-full resize-none bg-transparent py-6 text-center text-2xl font-semibold leading-snug text-white placeholder:text-white/50 focus:outline-none"
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
          </>
        )}

        <div className="mt-4 flex items-center justify-center gap-3">
          <Pick
            label="Media"
            icon={<ImageIcon className="h-5 w-5" />}
            onClick={() => media.current?.click()}
          />
          {layoutable && (
            <Pick
              label="Layout"
              icon={<LayoutSidebarIcon className="h-5 w-5" />}
              active={layout}
              onClick={() => setLayout((was) => !was)}
            />
          )}
          <Pick
            label="Text"
            icon={<PencilIcon className="h-5 w-5" />}
            active={drafts.length === 0}
            onClick={() => {
              drafts.forEach((draft) => URL.revokeObjectURL(draft.preview));
              setDrafts([]);
              setLayout(false);
              setCaption('');
            }}
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-center text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <input
        ref={media}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(event) => {
          void choose(event.target.files);
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
 * Several pictures drawn onto one, as a square grid.
 *
 * A grid rather than a designed collage: the point is that four photos of one
 * afternoon post as one moment, and a layout engine to arrange them is a
 * feature nobody asked for. Each cell is cover-cropped and clipped to itself,
 * so a portrait beside a landscape fills its square rather than spilling into
 * the next one.
 *
 * ponytail: fixed 512px cells and one grid shape. Per-count layouts - the big
 * one on the left, two stacked beside it - are the upgrade if the grid ever
 * looks wrong for three.
 */
async function collage(blobs: Blob[]): Promise<Blob> {
  const images = await Promise.all(blobs.map((blob) => createImageBitmap(blob)));
  const columns = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / columns);
  const cell = 512;

  const canvas = document.createElement('canvas');
  canvas.width = columns * cell;
  canvas.height = rows * cell;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('That layout could not be drawn');
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);

  images.forEach((image, at) => {
    const left = (at % columns) * cell;
    const top = Math.floor(at / columns) * cell;
    const scale = Math.max(cell / image.width, cell / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.save();
    context.beginPath();
    context.rect(left, top, cell, cell);
    context.clip();
    context.drawImage(image, left + (cell - width) / 2, top + (cell - height) / 2, width, height);
    context.restore();
    image.close();
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('That layout could not be drawn'))),
      'image/jpeg',
      0.9,
    );
  });
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
