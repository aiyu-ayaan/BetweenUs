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
import { DownloadIcon, EyeIcon, FileIcon, PlayIcon, XIcon } from '../../components/icons';

/** Text small enough to read in the message list without opening anything. */
const INLINE_TEXT_CHARS = 800;

export function AttachmentList({
  channelId,
  attachments,
}: {
  channelId: string;
  attachments: MessageAttachment[];
}): JSX.Element | null {
  const [preview, setPreview] = useState<MessageAttachment | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <ul className="mt-1 flex flex-col gap-2">
        {attachments.map((attachment) => (
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

      {preview && (
        <PreviewOverlay
          channelId={channelId}
          attachment={preview}
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
      title={`${attachment.name} - ${formatBytes(attachment.size)}`}
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
  onClose,
}: {
  channelId: string;
  attachment: MessageAttachment;
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

  // Escape closes, the way every other overlay in this app behaves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          <span className="text-xs text-slate-400">{formatBytes(attachment.size)}</span>
          <div className="ml-auto flex gap-1">
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
