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
import type { MessageAttachment } from '@nexora/shared-types';
import {
  formatBytes,
  openAttachment,
  readAttachmentText,
  saveAttachment,
} from '../../services/attachments';
import { DownloadIcon, EyeIcon, FileIcon, XIcon } from '../../components/icons';

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

// --- Images -----------------------------------------------------------------

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

  // The stored pixel size reserves the space before the bytes arrive, so the
  // message list does not jump as images resolve.
  const ratio =
    attachment.width && attachment.height ? attachment.width / attachment.height : 16 / 9;

  if (error) return <FileCard channelId={channelId} attachment={attachment} note={error} />;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${attachment.name} - ${formatBytes(attachment.size)}`}
      className="block w-full cursor-pointer overflow-hidden rounded-lg border border-black/20 bg-surface-850"
      style={{ maxWidth: Math.min(attachment.width ?? 400, 400) }}
    >
      {url ? (
        <img src={url} alt={attachment.name} className="h-auto w-full object-cover" />
      ) : (
        <div className="w-full animate-pulse bg-surface-800" style={{ aspectRatio: ratio }} />
      )}
    </button>
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
    <div className="overflow-hidden rounded-lg border border-black/20 bg-surface-850">
      <pre className="max-h-56 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono text-sm text-slate-200">
        {text ?? 'Decrypting…'}
      </pre>
      <div className="flex items-center gap-2 border-t border-black/20 px-3 py-1.5">
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
}: {
  channelId: string;
  attachment: MessageAttachment;
  note?: string;
}): JSX.Element {
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-black/20 bg-surface-850 px-3 py-2.5">
      <FileIcon className="h-8 w-8 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-100">{attachment.name}</p>
        <p className="truncate text-xs text-slate-400">
          {note ?? failure ?? formatBytes(attachment.size)}
        </p>
      </div>
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
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-surface-900"
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-black/20 px-4">
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
      className="cursor-pointer rounded p-1.5 text-slate-300 transition-colors duration-200 hover:bg-surface-700 hover:text-slate-50"
    >
      {icon}
    </button>
  );
}
