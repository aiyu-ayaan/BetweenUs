/**
 * Attachments as they appear under a message.
 *
 * Nothing here can use a plain `<img src>`: what the server holds is
 * ciphertext, so every file is fetched, decrypted in the client and handed to
 * the DOM as an object URL. That is also why an image only starts loading when
 * its row is rendered, and why the bytes are cached - scrolling past the same
 * picture twice should not decrypt it twice.
 */
import { useEffect, useRef, useState } from 'react';
import type { MessageAttachment } from '@betweenus/shared-types';
import {
  formatBytes,
  openAttachment,
  readAttachmentText,
  saveAttachment,
} from '../../services/attachments';
import {
  DownloadIcon,
  EyeIcon,
  FileIcon,
  OneTimeIcon,
  PlayIcon,
  XIcon,
} from '../../components/icons';
import { useChatStore } from '../../stores/chat';

/** Text small enough to read in the message list without opening anything. */
const INLINE_TEXT_CHARS = 800;

export function AttachmentList({
  channelId,
  attachments,
  oneTime,
}: {
  channelId: string;
  attachments: MessageAttachment[];
  /**
   * Present when this message is one-time, which changes everything below:
   * nothing is drawn inline, nothing is cached to disk, and opening it is what
   * destroys it.
   */
  oneTime?: { messageId: string; viewedAt: string | null; mine: boolean };
}): JSX.Element | null {
  const [preview, setPreview] = useState<MessageAttachment | null>(null);
  if (attachments.length === 0) return null;

  // A one-time message is not an ordinary message with a flag on it. Its
  // pictures are never drawn in the list - a thumbnail is a look, and it would
  // be a look nobody chose to spend - so the whole block becomes one card that
  // has to be opened deliberately.
  if (oneTime) {
    return <OneTimeAttachments channelId={channelId} attachments={attachments} {...oneTime} />;
  }

  // Two or more photos are an album, not two attachments that happen to be
  // pictures: they get one tiled block, the way every phone messenger draws
  // them. A single photo is still a photo, at its own shape.
  const photos = attachments.filter((a) => a.contentType.startsWith('image/'));
  const album = photos.length > 1 ? photos : [];
  const rest = album.length > 0 ? attachments.filter((a) => !album.includes(a)) : attachments;

  return (
    <>
      {album.length > 0 && (
        <PhotoAlbum channelId={channelId} photos={album} onOpen={setPreview} />
      )}

      {rest.length > 0 && (
      <ul className="mt-1 flex flex-col gap-2">
        {rest.map((attachment) => (
          <li key={attachment.key} className="max-w-lg">
            {attachment.contentType.startsWith('image/') ? (
              <ImageAttachment
                channelId={channelId}
                attachment={attachment}
                onOpen={() => setPreview(attachment)}
              />
            ) : isPlayable(attachment) ? (
              <MediaAttachment channelId={channelId} attachment={attachment} />
            ) : isTextual(attachment) ? (
              <TextAttachment
                channelId={channelId}
                attachment={attachment}
                onOpen={() => setPreview(attachment)}
              />
            ) : (
              <FileCard channelId={channelId} attachment={attachment} />
            )}
          </li>
        ))}
      </ul>
      )}

      {preview && (
        <PreviewOverlay
          channelId={channelId}
          attachment={preview}
          // An album of five shows four tiles, so the fifth is only reachable
          // from in here. Everything in the album is, once one of them is open.
          siblings={album.includes(preview) ? album : []}
          onShow={setPreview}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

/** True for anything worth showing as text rather than offering as a download. */
function isTextual(attachment: MessageAttachment): boolean {
  return (
    attachment.contentType.startsWith('text/') ||
    attachment.contentType === 'application/json' ||
    attachment.contentType === 'application/xml'
  );
}

/** Video and audio the runtime can play back rather than only hand over. */
function isPlayable(attachment: MessageAttachment): boolean {
  return (
    attachment.contentType.startsWith('video/') || attachment.contentType.startsWith('audio/')
  );
}

/**
 * Video and audio up to this size fetch themselves when scrolled to. A phone
 * clip is a few megabytes; a screen recording is not, and that is the one worth
 * asking about first.
 */
const AUTO_LOAD_BYTES = 40 * 1024 * 1024;

// --- Images -----------------------------------------------------------------

/**
 * The box a preview is allowed to occupy in the message list. A photo from a
 * phone is 3000px tall; rendered at its own size one message would be the
 * whole channel. So it is fitted into this box with its aspect ratio kept, and
 * the full size is one click away.
 */
const PREVIEW_WIDTH = 360;
const PREVIEW_HEIGHT = 240;

/** The size a preview renders at: the original, shrunk to fit, never enlarged. */
function fitted(attachment: MessageAttachment): { width: number; height: number } | null {
  if (!attachment.width || !attachment.height) return null;
  const scale = Math.min(
    1,
    PREVIEW_WIDTH / attachment.width,
    PREVIEW_HEIGHT / attachment.height,
  );
  return {
    width: Math.round(attachment.width * scale),
    height: Math.round(attachment.height * scale),
  };
}

function ImageAttachment({
  channelId,
  attachment,
  onOpen,
}: {
  channelId: string;
  attachment: MessageAttachment;
  onOpen: () => void;
}): JSX.Element {
  const { url, error } = useDecrypted(channelId, attachment);

  if (error) return <FileCard channelId={channelId} attachment={attachment} note={error} />;

  // The stored pixel size also reserves the space before the bytes arrive, so
  // the message list does not jump as images resolve. Without it - a GIF, which
  // is never re-encoded and so has no recorded size - CSS does the same job
  // once the image loads.
  const box = fitted(attachment);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={attachment.name}
      className="block cursor-pointer overflow-hidden rounded-lg border border-edge bg-surface-850"
      style={box ? { width: box.width, height: box.height } : undefined}
    >
      {url ? (
        <img
          src={url}
          alt={attachment.name}
          className="h-full w-full object-contain"
          style={box ? undefined : { maxWidth: PREVIEW_WIDTH, maxHeight: PREVIEW_HEIGHT }}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-surface-800" />
      )}
    </button>
  );
}

// --- Albums -----------------------------------------------------------------

/**
 * More than one photo in a message is drawn as one tiled block.
 *
 * The shapes are the ones every phone messenger settled on: two side by side,
 * three as one tall picture beside two stacked, four as a square. Past four the
 * fourth tile carries a "+n" and the rest are only in the preview - a message
 * with twenty photos should still be the height of a message.
 *
 * Tiles crop rather than fit. An album of mixed portrait and landscape shots
 * laid out at their own aspect ratios is a ragged mess; the whole point of the
 * grid is that it is a grid.
 */
const ALBUM_WIDTH = 320;
const ALBUM_GAP = 2;
const ALBUM_TILES = 4;

function PhotoAlbum({
  channelId,
  photos,
  onOpen,
}: {
  channelId: string;
  photos: MessageAttachment[];
  onOpen: (attachment: MessageAttachment) => void;
}): JSX.Element {
  const shown = photos.slice(0, ALBUM_TILES);
  const hidden = photos.length - shown.length;
  const pair = shown.length === 2;
  const trio = shown.length === 3;

  return (
    <div
      className="mt-1 grid overflow-hidden rounded-lg border border-edge bg-surface-850"
      style={{
        width: ALBUM_WIDTH,
        height: pair ? ALBUM_WIDTH / 2 : ALBUM_WIDTH * 0.75,
        gap: ALBUM_GAP,
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: pair ? '1fr' : '1fr 1fr',
      }}
    >
      {shown.map((photo, index) => (
        <PhotoTile
          key={photo.key}
          channelId={channelId}
          attachment={photo}
          onOpen={() => onOpen(photo)}
          // The tall one in a set of three is the first.
          span={trio && index === 0}
          more={index === shown.length - 1 ? hidden : 0}
        />
      ))}
    </div>
  );
}

function PhotoTile({
  channelId,
  attachment,
  onOpen,
  span,
  more,
}: {
  channelId: string;
  attachment: MessageAttachment;
  onOpen: () => void;
  span: boolean;
  /** How many further photos this tile stands in for, if it is the last one. */
  more: number;
}): JSX.Element {
  const { url, error } = useDecrypted(channelId, attachment);

  return (
    <button
      type="button"
      onClick={onOpen}
      title={attachment.name}
      className={`relative block h-full w-full cursor-pointer overflow-hidden bg-surface-800 ${
        span ? 'row-span-2' : ''
      }`}
    >
      {url && !error ? (
        <img src={url} alt={attachment.name} className="h-full w-full object-cover" />
      ) : error ? (
        <FileIcon className="mx-auto h-6 w-6 text-slate-500" />
      ) : (
        <div className="h-full w-full animate-pulse bg-surface-800" />
      )}
      {more > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xl font-medium text-white">
          +{more}
        </span>
      )}
    </button>
  );
}

// --- Video and audio --------------------------------------------------------

/**
 * A player, not a download link.
 *
 * The source is an object URL over the decrypted bytes, so the whole file has
 * to arrive before playback starts - there is no range request to make against
 * a blob, and the ciphertext is one sealed unit anyway.
 *
 * It used to wait for a click before fetching anything, which meant every video
 * in a channel was a grey card that had to be poked before it would even show
 * its first frame. Now anything small enough fetches itself as soon as it is
 * scrolled to, and only the genuinely large files still ask first - the point
 * of the click was never the click, it was not spending 200 MB of somebody's
 * connection on a message they scrolled past.
 */
function MediaAttachment({
  channelId,
  attachment,
}: {
  channelId: string;
  attachment: MessageAttachment;
}): JSX.Element {
  const [asked, setAsked] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(box);
  const wanted = asked || (attachment.size <= AUTO_LOAD_BYTES && onScreen);
  const { url, error } = useDecrypted(channelId, wanted ? attachment : null);
  const isVideo = attachment.contentType.startsWith('video/');

  if (error) return <FileCard channelId={channelId} attachment={attachment} note={error} />;

  return (
    <div ref={box}>
      {!wanted ? (
        <FileCard
          channelId={channelId}
          attachment={attachment}
          note={`${formatBytes(attachment.size)} - click to load`}
          onPlay={() => setAsked(true)}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-edge bg-surface-850">
          {url ? (
            isVideo ? (
              <video
                src={url}
                controls
                // Only a deliberate click starts playback. A video that fetched
                // itself on the way past and then started talking is worse than
                // the grey card this replaced.
                autoPlay={asked}
                preload="auto"
                className="block max-h-[320px] w-full bg-black"
                style={{ maxWidth: PREVIEW_WIDTH * 1.4 }}
              />
            ) : (
              <audio src={url} controls autoPlay={asked} className="block w-full" />
            )
          ) : (
            <p className="px-3 py-6 text-center text-sm text-slate-400">
              Decrypting {attachment.name}…
            </p>
          )}
          <div className="flex items-center gap-2 border-t border-edge px-3 py-1.5">
            <span className="truncate text-xs text-slate-400">
              {attachment.name} · {formatBytes(attachment.size)}
            </span>
            <div className="ml-auto">
              <IconButton
                label="Download"
                onClick={() => void saveAttachment(channelId, attachment)}
                icon={<DownloadIcon className="h-4 w-4" />}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Text -------------------------------------------------------------------

/**
 * A text file, shown rather than offered. This is where an over-long message
 * lands: it reads as the message it was, with the rest a click away.
 */
function TextAttachment({
  channelId,
  attachment,
  onOpen,
}: {
  channelId: string;
  attachment: MessageAttachment;
  onOpen: () => void;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readAttachmentText(channelId, attachment, INLINE_TEXT_CHARS + 1)
      .then((value) => !cancelled && setText(value))
      .catch(() => !cancelled && setError('This file could not be opened'));
    return () => {
      cancelled = true;
    };
  }, [channelId, attachment]);

  if (error) return <FileCard channelId={channelId} attachment={attachment} note={error} />;

  const truncated = (text?.length ?? 0) > INLINE_TEXT_CHARS;

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-850">
      <pre className="max-h-56 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono text-sm text-slate-200">
        {text ?? 'Decrypting…'}
      </pre>
      <div className="flex items-center gap-2 border-t border-edge px-3 py-1.5">
        <span className="truncate text-xs text-slate-400">
          {attachment.overflow ? 'Message too long, sent as a file' : attachment.name} ·{' '}
          {formatBytes(attachment.size)}
        </span>
        <div className="ml-auto flex gap-1">
          {truncated && <IconButton label="Expand" onClick={onOpen} icon={<EyeIcon className="h-4 w-4" />} />}
          <IconButton
            label="Download"
            onClick={() => void saveAttachment(channelId, attachment)}
            icon={<DownloadIcon className="h-4 w-4" />}
          />
        </div>
      </div>
    </div>
  );
}

// --- One-time messages ------------------------------------------------------

/**
 * A one-time message, before and after it is opened.
 *
 * Three states, and the middle one is the feature. Before: a card naming what
 * is inside it, deliberately not a thumbnail - a thumbnail is a look, and it
 * would be a look nobody chose to spend. During: a full-screen viewer with the
 * ordinary affordances removed. After: a line saying it is gone, which is all
 * that is left, because the server destroyed the row and the blobs the moment
 * the viewer opened.
 *
 * The author is not a viewer. Somebody re-reading what they themselves sent
 * has not spent anybody's one look, so their own copy opens as often as they
 * like and burns nothing - and the server agrees, which is what makes that
 * safe rather than a client-side courtesy.
 *
 * ## What "protected" can and cannot mean here
 *
 * The viewer refuses the download, the context menu, the drag and the text
 * selection, and the message list never draws the picture at all. That closes
 * every path this application offers for keeping a copy.
 *
 * It does not stop a screenshot, and no application on a general-purpose
 * computer can. The pixels have to reach a screen for the picture to be looked
 * at, and at that point the operating system, another window, or a phone
 * pointed at the monitor can all have them. What this feature honestly
 * provides is that the file stops existing - on the server, in the object
 * store, and in every client's cache - the moment it has been seen once. The
 * copy on screen says exactly that, because a viewer implying more would be
 * lying to the person deciding what to send.
 */
function OneTimeAttachments({
  channelId,
  attachments,
  messageId,
  viewedAt,
  mine,
}: {
  channelId: string;
  attachments: MessageAttachment[];
  messageId: string;
  viewedAt: string | null;
  mine: boolean;
}): JSX.Element {
  const burnMessage = useChatStore((state) => state.burnMessage);
  const [open, setOpen] = useState(false);

  // Opened by somebody, and this client is not the author looking at their
  // own. There is nothing left to fetch: the blobs are gone.
  if (viewedAt && !mine) {
    return (
      <p className="mt-1 flex items-center gap-2 text-sm italic text-slate-500">
        <OneTimeIcon className="h-4 w-4 shrink-0" />
        Opened
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          // Burning is what opening *means*, so it happens on the way in
          // rather than on the way out. Closing the viewer is not a promise
          // anybody made - a window can be shut, a machine can lose power -
          // and a message that survives being looked at because the tab
          // crashed is a one-time message that was not one.
          if (!mine) void burnMessage(messageId);
        }}
        className="mt-1 flex w-full max-w-sm cursor-pointer items-center gap-3 rounded-lg border border-accent/40 bg-accent/[0.06] px-3 py-2.5 text-left transition-colors duration-200 hover:bg-accent/[0.12]"
      >
        <OneTimeIcon className="h-7 w-7 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-100">
            {describeOneTime(attachments)}
          </span>
          <span className="block truncate text-xs text-slate-400">
            {mine ? 'One-time — they get one look' : 'One-time — opening it uses your one look'}
          </span>
        </span>
      </button>

      {open && (
        <OneTimeViewer
          channelId={channelId}
          attachments={attachments}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** What is inside, said in the words a person would use for it. */
export function describeOneTime(attachments: MessageAttachment[]): string {
  const kinds = new Set(
    attachments.map((attachment) =>
      attachment.contentType.startsWith('image/')
        ? 'Photo'
        : attachment.contentType.startsWith('video/')
          ? 'Video'
          : attachment.contentType.startsWith('audio/')
            ? 'Voice message'
            : 'File',
    ),
  );
  const only = kinds.size === 1 ? ([...kinds][0] ?? 'File') : 'File';
  return attachments.length > 1
    ? `${attachments.length} ${only.toLowerCase()}s`
    : only;
}

/**
 * The viewer for a one-time message.
 *
 * Everything that would leave a copy behind is taken away: no download button,
 * no context menu, nothing draggable, nothing selectable, and `controlsList`
 * telling a media element not to offer its own download item. Those are the
 * paths this application controls, and they are all closed.
 *
 * See the note above for what this cannot do, and why the sentence under the
 * picture says so out loud.
 */
function OneTimeViewer({
  channelId,
  attachments,
  onClose,
}: {
  channelId: string;
  attachments: MessageAttachment[];
  onClose: () => void;
}): JSX.Element {
  const [at, setAt] = useState(0);
  const index = Math.min(at, attachments.length - 1);
  const current = attachments[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setAt((was) => Math.max(0, was - 1));
      if (event.key === 'ArrowRight') setAt((was) => Math.min(attachments.length - 1, was + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, attachments.length]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="One-time message"
      onClick={onClose}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed inset-0 z-50 flex select-none flex-col items-center justify-center gap-3 bg-black/90 p-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col items-center gap-3"
      >
        {current && <OneTimeMedia channelId={channelId} attachment={current} />}

        {attachments.length > 1 && (
          <p className="text-xs text-slate-400">
            {index + 1} of {attachments.length} — use the arrow keys
          </p>
        )}

        {/* Said plainly, because the alternative is implying a guarantee no
            application on a general-purpose computer can keep. */}
        <p className="max-w-md text-center text-xs text-slate-500">
          This is gone once you close it. Saving and sharing are switched off here, but no app can
          stop a screenshot — only send what you would trust them with.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded-md bg-surface-800 px-4 py-2 text-sm text-slate-200 transition-colors duration-200 hover:bg-white/[0.07]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** One file inside the viewer, drawn with everything that copies it removed. */
function OneTimeMedia({
  channelId,
  attachment,
}: {
  channelId: string;
  attachment: MessageAttachment;
}): JSX.Element {
  const { url, error } = useDecrypted(channelId, attachment);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!url) return <p className="text-sm text-slate-400">Decrypting…</p>;

  if (attachment.contentType.startsWith('image/')) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
        className="max-h-[70vh] max-w-full select-none object-contain"
      />
    );
  }

  if (attachment.contentType.startsWith('video/')) {
    return (
      <video
        src={url}
        controls
        autoPlay
        // The browser's own download item, refused. It is the one copy path a
        // media element offers that markup around it cannot take away.
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onContextMenu={(event) => event.preventDefault()}
        className="max-h-[70vh] max-w-full select-none"
      />
    );
  }

  return (
    <audio
      src={url}
      controls
      autoPlay
      controlsList="nodownload"
      onContextMenu={(event) => event.preventDefault()}
      className="w-full max-w-md"
    />
  );
}

// --- Everything else --------------------------------------------------------


function FileCard({
  channelId,
  attachment,
  note,
  onPlay,
}: {
  channelId: string;
  attachment: MessageAttachment;
  note?: string;
  /** Present for video and audio: fetch and decrypt, then play it here. */
  onPlay?: () => void;
}): JSX.Element {
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-edge bg-surface-850 px-3 py-2.5">
      {onPlay ? (
        <PlayIcon className="h-8 w-8 shrink-0 text-accent" />
      ) : (
        <FileIcon className="h-8 w-8 shrink-0 text-accent" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-100">{attachment.name}</p>
        <p className="truncate text-xs text-slate-400">
          {note ?? failure ?? formatBytes(attachment.size)}
        </p>
      </div>
      {onPlay && (
        <IconButton
          label={`Play ${attachment.name}`}
          onClick={onPlay}
          icon={<PlayIcon className="h-4 w-4" />}
        />
      )}
      <IconButton
        label={`Download ${attachment.name}`}
        onClick={() => {
          setFailure(null);
          void saveAttachment(channelId, attachment).catch(() =>
            setFailure('This file could not be opened'),
          );
        }}
        icon={<DownloadIcon className="h-4 w-4" />}
      />
    </div>
  );
}

// --- Full-size preview ------------------------------------------------------

function PreviewOverlay({
  channelId,
  attachment,
  siblings = [],
  onShow,
  onClose,
}: {
  channelId: string;
  attachment: MessageAttachment;
  /** The album this picture belongs to, if it belongs to one. */
  siblings?: MessageAttachment[];
  onShow?: (attachment: MessageAttachment) => void;
  onClose: () => void;
}): JSX.Element {
  const isImage = attachment.contentType.startsWith('image/');
  const { url } = useDecrypted(channelId, isImage ? attachment : null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (isImage) return;
    let cancelled = false;
    void readAttachmentText(channelId, attachment).then((value) => !cancelled && setText(value));
    return () => {
      cancelled = true;
    };
  }, [channelId, attachment, isImage]);

  const at = siblings.indexOf(attachment);
  const step = (by: number): void => {
    if (at < 0 || !onShow) return;
    const next = siblings[(at + by + siblings.length) % siblings.length];
    if (next) onShow(next);
  };

  // Escape closes, the way every other overlay in this app behaves; the arrow
  // keys walk the album, the way every other gallery does.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl animate-pop flex-col overflow-hidden rounded-xl border border-edge bg-surface-900 shadow-pop"
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge px-4">
          <p className="truncate text-sm font-medium text-slate-100">{attachment.name}</p>
          {at >= 0 && siblings.length > 1 && (
            <span className="shrink-0 text-xs text-slate-400">
              {at + 1} / {siblings.length}
            </span>
          )}
          {!isImage && (
            <span className="text-xs text-slate-400">{formatBytes(attachment.size)}</span>
          )}
          <div className="ml-auto flex gap-1">
            {at >= 0 && siblings.length > 1 && (
              <>
                <IconButton label="Previous" onClick={() => step(-1)} icon={<span aria-hidden>‹</span>} />
                <IconButton label="Next" onClick={() => step(1)} icon={<span aria-hidden>›</span>} />
              </>
            )}
            <IconButton
              label="Download"
              onClick={() => void saveAttachment(channelId, attachment)}
              icon={<DownloadIcon className="h-4 w-4" />}
            />
            <IconButton label="Close" onClick={onClose} icon={<XIcon className="h-4 w-4" />} />
          </div>
        </header>

        {isImage ? (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
            {url ? (
              <img src={url} alt={attachment.name} className="max-h-[70vh] max-w-full" />
            ) : (
              <p className="text-slate-400">Decrypting…</p>
            )}
          </div>
        ) : (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-sm text-slate-200">
            {text ?? 'Decrypting…'}
          </pre>
        )}
      </div>
    </div>
  );
}

// --- Shared bits ------------------------------------------------------------

/**
 * Decrypts an attachment into an object URL, and releases it when the message
 * scrolls out of the tree. Passing null keeps the hook's position in the list
 * of hooks while fetching nothing.
 */
function useDecrypted(
  channelId: string,
  attachment: MessageAttachment | null,
): { url: string | null; error: string | null } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revoke = useRef<string | null>(null);

  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;

    openAttachment(channelId, attachment)
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        revoke.current = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setError('This file could not be opened'));

    return () => {
      cancelled = true;
      if (revoke.current) URL.revokeObjectURL(revoke.current);
      revoke.current = null;
    };
  }, [channelId, attachment]);

  return { url, error };
}

/**
 * Whether an element is on screen. Used to decide when a video is worth
 * fetching: "in the channel" is not the same question as "being looked at",
 * and a channel of forty clips would otherwise download all forty at once.
 */
function useOnScreen(ref: { current: Element | null }): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    // No observer (or no element yet) means fetch rather than never fetch.
    if (!element || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        // One way only: a video that has been scrolled past has already been
        // fetched, and un-setting this would tear down the player mid-frame.
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      // A little ahead of the viewport, so it is ready by the time it arrives.
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return seen;
}

function IconButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
    >
      {icon}
    </button>
  );
}
