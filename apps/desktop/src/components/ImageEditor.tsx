/**
 * Crop and rotate a picture before it is sent or stored.
 *
 * Every chat app has this and this one did not: a picked file went up exactly
 * as it came off the camera, sideways photos included. There is nothing clever
 * here - drag to move, wheel or slider to zoom, two buttons to turn - and that
 * is the point, because the arithmetic that makes the written file match the
 * preview lives in `services/image-edit.ts`, where it is checked rather than
 * eyeballed.
 *
 * The frame is the crop. What is inside it when Done is pressed is what gets
 * written, so a square frame is an avatar and a free frame is a photo about to
 * be sent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeImage } from '../services/attachments';
import {
  type Edit,
  type Size,
  MAX_ZOOM,
  NO_EDIT,
  clampEdit,
  coverScale,
  cssTransform,
  drawEdit,
  panRange,
  rotate,
} from '../services/image-edit';

/** The longest edge of the preview box, in CSS pixels. */
const FRAME_LONG = 360;

export function ImageEditor({
  file,
  aspect,
  maxOutputEdge = 2048,
  type = 'image/jpeg',
  quality = 0.92,
  title,
  onCancel,
  onDone,
}: {
  file: File;
  /** Width over height. 1 for an avatar; the picture's own when omitted. */
  aspect?: number;
  /** The longest edge of the written file. Never upscales past the source. */
  maxOutputEdge?: number;
  type?: string;
  quality?: number;
  title?: string;
  onCancel: () => void;
  onDone: (edited: Blob) => void;
}): JSX.Element {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit>(NO_EDIT);
  const [busy, setBusy] = useState(false);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let live = true;
    let decoded: ImageBitmap | null = null;
    void (async () => {
      try {
        decoded = await decodeImage(file);
        if (!live) {
          decoded.close();
          return;
        }
        setBitmap(decoded);
      } catch {
        if (live) setFailure('That file could not be read as a picture');
      }
    })();
    return () => {
      live = false;
      decoded?.close();
    };
  }, [file]);

  // A free frame takes the picture's own shape, so opening the editor and
  // pressing Done straight away returns the picture rather than a crop nobody
  // asked for.
  const ratio = aspect ?? (bitmap ? bitmap.width / bitmap.height : 1);
  const frame: Size = useMemo(
    () =>
      ratio >= 1
        ? { width: FRAME_LONG, height: Math.max(1, Math.round(FRAME_LONG / ratio)) }
        : { width: Math.max(1, Math.round(FRAME_LONG * ratio)), height: FRAME_LONG },
    [ratio],
  );

  // The source is a bitmap for the arithmetic and an object URL for the
  // preview: an <img> the browser lays out costs nothing to move and turn,
  // where a canvas would be repainted on every pointer move.
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const apply = (next: Edit): void => {
    if (bitmap) setEdit(clampEdit(bitmap, frame, next));
  };

  const done = async (): Promise<void> => {
    if (!bitmap) return;
    setBusy(true);
    try {
      // What the frame covers, measured in the source's own pixels. Capping by
      // that rather than by the ceiling matters: upscaling a small picture to
      // 2048 makes a bigger file of exactly the same detail.
      const scale = coverScale(bitmap, frame, edit.rotation) * edit.zoom;
      const cropped = { width: frame.width / scale, height: frame.height / scale };
      const shrink = Math.min(1, maxOutputEdge / Math.max(cropped.width, cropped.height));
      const output: Size = {
        width: Math.max(1, Math.round(cropped.width * shrink)),
        height: Math.max(1, Math.round(cropped.height * shrink)),
      };

      const canvas = document.createElement('canvas');
      canvas.width = output.width;
      canvas.height = output.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This device cannot process images');
      drawEdit(context, bitmap, frame, output, edit);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );
      if (!blob) throw new Error('That picture could not be written');
      onDone(blob);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That picture could not be written');
    } finally {
      setBusy(false);
    }
  };

  const range = bitmap ? panRange(bitmap, frame, edit) : { width: 0, height: 0 };
  const movable = range.width > 0 || range.height > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-6">
      <p className="max-w-md truncate text-sm text-slate-200">{title ?? file.name}</p>

      <div
        className="relative overflow-hidden rounded-lg border border-edge bg-black"
        style={{ width: frame.width, height: frame.height, cursor: movable ? 'grab' : 'default' }}
        onPointerDown={(event) => {
          if (!movable) return;
          dragging.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragging.current;
          if (!from) return;
          dragging.current = { x: event.clientX, y: event.clientY };
          apply({
            ...edit,
            offsetX: edit.offsetX + (event.clientX - from.x),
            offsetY: edit.offsetY + (event.clientY - from.y),
          });
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
        onWheel={(event) => apply({ ...edit, zoom: edit.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1) })}
      >
        {bitmap && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            style={{
              width: bitmap.width,
              height: bitmap.height,
              // Centred on the frame's centre first; everything after that is
              // the transform the canvas replays.
              marginLeft: -bitmap.width / 2,
              marginTop: -bitmap.height / 2,
              transform: cssTransform(bitmap, frame, edit),
            }}
          />
        )}
        {!bitmap && !failure && (
          <p className="flex h-full items-center justify-center text-sm text-slate-400">Opening…</p>
        )}
      </div>

      <div className="flex w-full max-w-md items-center gap-3">
        <button
          type="button"
          aria-label="Rotate left"
          title="Rotate left"
          onClick={() => apply({ ...NO_EDIT, rotation: rotate(edit.rotation, -1) })}
          className="cursor-pointer rounded px-3 py-1.5 text-lg text-slate-200 hover:bg-surface-800"
        >
          ⟲
        </button>
        <input
          type="range"
          aria-label="Zoom"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={edit.zoom}
          onChange={(event) => apply({ ...edit, zoom: Number(event.target.value) })}
          className="flex-1 cursor-pointer"
        />
        <button
          type="button"
          aria-label="Rotate right"
          title="Rotate right"
          onClick={() => apply({ ...NO_EDIT, rotation: rotate(edit.rotation, 1) })}
          className="cursor-pointer rounded px-3 py-1.5 text-lg text-slate-200 hover:bg-surface-800"
        >
          ⟳
        </button>
      </div>

      {failure && <p className="text-sm text-danger">{failure}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="cursor-pointer rounded px-4 py-1.5 text-sm text-slate-300 hover:text-slate-100 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void done()}
          disabled={busy || !bitmap}
          className="cursor-pointer rounded bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Done'}
        </button>
      </div>
    </div>
  );
}
