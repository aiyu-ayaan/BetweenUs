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
import { ImageEditor } from './ImageEditor';

export function PicturePicker({
  label,
  onChange,
  onClear,
  children,
  aspect = 1,
  maxWidth = 512,
  hint,
}: {
  /** Names the control for a screen reader: "avatar", "server icon", "cover". */
  label: string;
  onChange: (url: string) => Promise<void> | void;
  /** Omitted when there is nothing to clear back to. */
  onClear?: () => Promise<void> | void;
  /** The picture as it looks now - an Avatar, usually. Omitted when already displayed elsewhere. */
  children?: React.ReactNode;
  /**
   * Width over height of the frame the picture is cropped to. 1 for an avatar
   * or an icon, `COVER_ASPECT` for the band behind a name.
   *
   * The frame is the same number in the editor and in what is stored, because
   * a person who moves a photograph inside a square frame and then gets a wide
   * crop of it has been shown a lie about what they were choosing.
   */
  aspect?: number;
  /** The widest the stored picture is kept. See `COVER_MAX_WIDTH`. */
  maxWidth?: number;
  /** Replaces the line under the buttons; the default describes a square. */
  hint?: string;
}): JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * The picked file, held while it is being framed. A centre crop is what this
   * used to do on its own, and it is the wrong crop for most photographs of a
   * person - who is rarely in the middle of their own picture.
   */
  const [editing, setEditing] = useState<File | null>(null);

  const upload = async (picture: Blob): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      // The editor already framed it to `aspect`, so this is a scale to the
      // stored size rather than a second crop - which is why the same aspect
      // has to be passed to both.
      const framed = await preparePicture(
        new File([picture], 'picture.webp', { type: picture.type }),
        maxWidth,
        aspect,
      );
      const stored = await api.uploadPicture(framed, 'picture.webp');
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
    <div className={aspect === 1 ? 'flex items-center gap-4' : 'space-y-3'}>
      {editing && (
        <ImageEditor
          file={editing}
          aspect={aspect}
          title={`Frame your ${label}`}
          type="image/webp"
          maxOutputEdge={Math.max(1024, maxWidth)}
          onCancel={() => setEditing(null)}
          onDone={(edited) => {
            setEditing(null);
            void upload(edited);
          }}
        />
      )}

      {children && (
        <button
          type="button"
          onClick={() => picker.current?.click()}
          disabled={busy}
          aria-label={`Change ${label}`}
          title={`Change ${label}`}
          className={`group relative cursor-pointer disabled:cursor-not-allowed shrink-0 ${
            aspect === 1 ? 'rounded-full' : 'w-full rounded-lg'
          }`}
        >
          {children}
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] font-bold uppercase tracking-wide text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${
              aspect === 1 ? 'rounded-full' : 'rounded-lg'
            }`}
          >
            {busy ? '…' : 'Change'}
          </span>
        </button>
      )}

      <div>
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              setFailure(null);
              setEditing(file);
            }
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
          {failure ?? hint ?? `A square is cropped from the middle and scaled to ${maxWidth}px.`}
        </p>
      </div>
    </div>
  );
}
