/**
 * What you are about to send, before you send it.
 *
 * Pictures and video used to go out as a filename on a chip, which is the one
 * moment nobody can check what they picked - and picking the wrong photo out of
 * a folder of near-identical ones is the most ordinary mistake there is. This is
 * the screen WhatsApp puts between the picker and the send button: the file
 * itself, big, with the caption box under it and a strip of everything else in
 * the batch along the bottom.
 *
 * Nothing here is encrypted yet. These are local files the user just chose, so
 * they are shown straight from an object URL - the upload, and the encryption
 * that precedes it, only happen on send.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from '../../services/attachments';
import { ImageEditor } from '../../components/ImageEditor';
import {
  CropIcon,
  FileIcon,
  ImageIcon,
  PaperclipIcon,
  SendIcon,
  TrashIcon,
  XIcon,
} from '../../components/icons';

/** True for the files this screen has something to show rather than name. */
export function isPreviewable(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/');
}

export function SendPreview({
  files,
  caption,
  placeholder,
  sending,
  uploading,
  failure,
  onCaption,
  onRemove,
  onReplace,
  onAdd,
  onSend,
  onClose,
}: {
  files: File[];
  caption: string;
  placeholder: string;
  sending: boolean;
  /** The file being encrypted and uploaded right now, if any. */
  uploading: { name: string; percent: number } | null;
  failure: string | null;
  onCaption: (text: string) => void;
  onRemove: (index: number) => void;
  /** A picture that came back from the crop screen, in place of the original. */
  onReplace: (index: number, file: File) => void;
  onAdd: () => void;
  onSend: () => void;
  onClose: () => void;
}): JSX.Element {
  const [at, setAt] = useState(0);
  const [cropping, setCropping] = useState(false);
  // Clamped rather than reset: removing a file should keep you looking at the
  // batch, not throw you back to the first one.
  const index = Math.min(at, files.length - 1);
  const current = files[index];

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !sending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send files"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-6"
    >
      {cropping && current && (
        <ImageEditor
          file={current}
          title={current.name}
          onCancel={() => setCropping(false)}
          onDone={(edited) => {
            setCropping(false);
            // Same name, so the batch strip and the caption do not jump about;
            // the extension follows the type the editor actually wrote.
            onReplace(index, new File([edited], withExtension(current.name, 'jpg'), {
              type: edited.type,
            }));
          }}
        />
      )}

      <div className="flex max-h-full w-full max-w-3xl animate-pop flex-col overflow-hidden rounded-xl border border-edge bg-surface-900 shadow-pop">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge px-4">
          <p className="truncate text-sm font-medium text-slate-100">
            {files.length === 1 ? current?.name : `${files.length} files`}
          </p>
          {current && (
            <span className="shrink-0 text-xs text-slate-400">{formatBytes(current.size)}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Back to the message box"
            title="Back"
            className="ml-auto cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 disabled:cursor-not-allowed"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-[240px] flex-1 items-center justify-center bg-black/40 p-4">
          {current ? <Preview file={current} /> : null}
        </div>

        {files.length > 1 && (
          <ul className="flex shrink-0 gap-2 overflow-x-auto border-t border-edge px-3 py-2">
            {files.map((file, position) => (
              <li key={`${file.name}-${position}`}>
                <button
                  type="button"
                  onClick={() => setAt(position)}
                  aria-current={position === index}
                  aria-label={`Show ${file.name}`}
                  className={`flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded border ${
                    position === index ? 'border-accent' : 'border-edge'
                  } bg-surface-850`}
                >
                  <Thumbnail file={file} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {uploading && (
          <p className="shrink-0 truncate border-t border-edge px-4 py-1.5 text-xs text-slate-400" aria-live="polite">
            Encrypting and uploading {uploading.name} — {uploading.percent}%
          </p>
        )}
        {failure && (
          <p role="alert" className="shrink-0 border-t border-edge px-4 py-1.5 text-xs text-danger">
            {failure}
          </p>
        )}

        <div className="flex shrink-0 items-end gap-2 border-t border-edge px-4 py-3">
          <button
            type="button"
            onClick={onAdd}
            disabled={sending}
            aria-label="Add another file"
            title="Add another file"
            className="cursor-pointer rounded-md p-1.5 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
          >
            <PaperclipIcon className="h-5 w-5" />
          </button>
          {current?.type.startsWith('image/') && (
            <button
              type="button"
              onClick={() => setCropping(true)}
              disabled={sending}
              aria-label={`Crop and rotate ${current.name}`}
              title="Crop and rotate"
              className="cursor-pointer rounded-md p-1.5 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
            >
              <CropIcon className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={sending || files.length === 0}
            aria-label={`Remove ${current?.name ?? 'this file'}`}
            title="Remove this file"
            className="cursor-pointer rounded-md p-1.5 text-slate-300 transition-colors duration-200 hover:text-danger disabled:cursor-not-allowed disabled:text-slate-600"
          >
            <TrashIcon className="h-5 w-5" />
          </button>

          <label htmlFor="send-caption" className="sr-only">
            {placeholder}
          </label>
          <textarea
            id="send-caption"
            autoFocus
            rows={1}
            value={caption}
            disabled={sending}
            onChange={(event) => onCaption(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={placeholder}
            className="max-h-32 min-h-[24px] flex-1 resize-none rounded-lg bg-surface-800 px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none"
          />

          <button
            type="button"
            onClick={onSend}
            disabled={sending || files.length === 0}
            aria-label="Send"
            className="cursor-pointer rounded-full bg-accent p-2.5 text-white transition-colors duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The big one. A video gets a real player: this is the last chance to watch it. */
function Preview({ file }: { file: File }): JSX.Element {
  const url = useObjectUrl(file);

  if (file.type.startsWith('image/')) {
    return <img src={url} alt={file.name} className="max-h-[55vh] max-w-full object-contain" />;
  }
  if (file.type.startsWith('video/')) {
    return <video src={url} controls className="max-h-[55vh] max-w-full bg-black" />;
  }
  return (
    <div className="flex flex-col items-center gap-2 text-slate-300">
      <FileIcon className="h-10 w-10" />
      <p className="max-w-xs truncate text-sm">{file.name}</p>
      <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
    </div>
  );
}

function Thumbnail({ file }: { file: File }): JSX.Element {
  const url = useObjectUrl(file);

  if (file.type.startsWith('image/')) {
    return <img src={url} alt="" className="h-full w-full object-cover" />;
  }
  if (file.type.startsWith('video/')) {
    // Muted and unplayed: a poster frame, not a wall of moving thumbnails.
    return <video src={url} muted className="h-full w-full object-cover" />;
  }
  return file.type.startsWith('image/') ? (
    <ImageIcon className="h-5 w-5 text-slate-400" />
  ) : (
    <FileIcon className="h-5 w-5 text-slate-400" />
  );
}

/** An object URL for a local file, released when it stops being shown. */
function useObjectUrl(file: File): string {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

/** `holiday.heic` -> `holiday.jpg`. A file that lies about its type confuses every client that opens it. */
function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}
