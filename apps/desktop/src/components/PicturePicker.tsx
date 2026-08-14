/**
 * Choose, upload and clear a picture - an avatar or a server icon.
 *
 * Pictures are the one thing the client uploads in the clear, because every
 * other client has to render them without holding a channel key. So the work
 * is done before the upload rather than after: the file is cropped square and
 * re-encoded small here, and what reaches the server is what everyone fetches.
 */
import { useRef, useState } from 'react';
import { api } from '../services/api';
import { preparePicture } from '../services/attachments';

export function PicturePicker({
  label,
  onChange,
  onClear,
  children,
}: {
  /** Names the control for a screen reader: "avatar", "server icon". */
  label: string;
  onChange: (url: string) => Promise<void> | void;
  /** Omitted when there is nothing to clear back to. */
  onClear?: () => Promise<void> | void;
  /** The picture as it looks now - an Avatar, usually. */
  children: React.ReactNode;
}): JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const choose = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setFailure(null);
    try {
      const square = await preparePicture(file);
      const stored = await api.uploadPicture(square, 'picture.webp');
      await onChange(stored.url);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That picture could not be uploaded');
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    if (!onClear) return;
    setBusy(true);
    setFailure(null);
    try {
      await onClear();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That could not be removed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => picker.current?.click()}
        disabled={busy}
        aria-label={`Change ${label}`}
        title={`Change ${label}`}
        className="group relative cursor-pointer rounded-full disabled:cursor-not-allowed"
      >
        {children}
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 text-[10px] font-bold uppercase tracking-wide text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          {busy ? '…' : 'Change'}
        </span>
      </button>

      <div>
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            // Reset, or choosing the same file twice in a row does nothing.
            event.target.value = '';
          }}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={busy}
            className="cursor-pointer rounded bg-accent px-3 py-1.5 text-sm text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Uploading…' : `Upload ${label}`}
          </button>
          {onClear && (
            <button
              type="button"
              onClick={() => void clear()}
              disabled={busy}
              className="cursor-pointer rounded px-3 py-1.5 text-sm text-slate-300 transition-colors duration-200 hover:text-danger disabled:cursor-not-allowed"
            >
              Remove
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {failure ?? 'A square is cropped from the middle and scaled to 512px.'}
        </p>
      </div>
    </div>
  );
}
