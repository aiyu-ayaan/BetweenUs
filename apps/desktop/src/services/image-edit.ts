/**
 * The geometry behind the crop-and-rotate screen.
 *
 * The editor draws the picture with a CSS transform and then has to reproduce
 * exactly that drawing on a canvas, or what is sent is not what was framed. So
 * the arithmetic lives here on its own, in the one form both of them use:
 *
 *     translate(offsetX, offsetY)  scale(coverScale * zoom)  rotate(rotation)
 *
 * applied about the centre of a frame the picture is centred in. CSS applies a
 * transform list right to left about the element's centre, and a canvas applies
 * `translate`/`scale`/`rotate` in call order about the current origin, so the
 * same three numbers in the same order mean the same thing to both.
 *
 * Everything here is pure. `image-edit.check.ts` is what proves the frame is
 * always covered, which is the property that decides whether a crop can show
 * blank paper down one edge.
 */

/** Quarter turns only. A free angle would need a crop box that is not the frame. */
export type Rotation = 0 | 90 | 180 | 270;

export interface Size {
  width: number;
  height: number;
}

export interface Edit {
  rotation: Rotation;
  /** Multiplies [coverScale]. 1 is "just covers the frame". */
  zoom: number;
  /** Where the picture's centre sits, in frame pixels, relative to the frame's. */
  offsetX: number;
  offsetY: number;
}

export const NO_EDIT: Edit = { rotation: 0, zoom: 1, offsetX: 0, offsetY: 0 };

/** How far a picture may be zoomed in. Past this a photo is showing its pixels. */
export const MAX_ZOOM = 5;

export function rotate(rotation: Rotation, quarterTurns: number): Rotation {
  const turns = (((rotation / 90 + quarterTurns) % 4) + 4) % 4;
  return (turns * 90) as Rotation;
}

/** True when the picture's width and height swap places on screen. */
export function isSideways(rotation: Rotation): boolean {
  return rotation === 90 || rotation === 270;
}

/** The picture's size once it has been turned, before any scaling. */
export function turned(image: Size, rotation: Rotation): Size {
  return isSideways(rotation)
    ? { width: image.height, height: image.width }
    : { width: image.width, height: image.height };
}

/**
 * The smallest scale that leaves no gap between the picture and the frame.
 *
 * `cover`, not `contain`: a crop that can show the page behind it is a crop
 * that will, and letterboxing an avatar is not something anybody asked for.
 */
export function coverScale(image: Size, frame: Size, rotation: Rotation): number {
  const shown = turned(image, rotation);
  if (shown.width <= 0 || shown.height <= 0) return 1;
  return Math.max(frame.width / shown.width, frame.height / shown.height);
}

/**
 * How far the centre may travel before an edge comes into the frame.
 *
 * Zero when the picture is exactly the size of the frame, which is the normal
 * case at zoom 1 on one of the two axes - so a picture at zoom 1 is not
 * draggable in the direction it already fits, and that is correct rather than
 * a stuck gesture.
 */
export function panRange(image: Size, frame: Size, edit: Edit): Size {
  const shown = turned(image, edit.rotation);
  const scale = coverScale(image, frame, edit.rotation) * edit.zoom;
  return {
    width: Math.max(0, (shown.width * scale - frame.width) / 2),
    height: Math.max(0, (shown.height * scale - frame.height) / 2),
  };
}

/** Holds the picture against the frame, whatever the gesture asked for. */
export function clampEdit(image: Size, frame: Size, edit: Edit): Edit {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, edit.zoom));
  const range = panRange(image, frame, { ...edit, zoom });
  return {
    rotation: edit.rotation,
    zoom,
    // `+ 0` normalises the negative zero a clamp against a zero range
    // produces. It draws identically and compares as equal, but it reads as
    // "-0" everywhere it is printed, which is a confusing thing to find.
    offsetX: Math.min(range.width, Math.max(-range.width, edit.offsetX)) + 0,
    offsetY: Math.min(range.height, Math.max(-range.height, edit.offsetY)) + 0,
  };
}

/** The `transform` the preview element wears. Frame pixels throughout. */
export function cssTransform(image: Size, frame: Size, edit: Edit): string {
  const scale = coverScale(image, frame, edit.rotation) * edit.zoom;
  return (
    `translate(${edit.offsetX}px, ${edit.offsetY}px) ` +
    `scale(${scale}) rotate(${edit.rotation}deg)`
  );
}

/** True when the edit would change nothing, so the original file can be kept. */
export function isUnedited(edit: Edit): boolean {
  return edit.rotation === 0 && edit.zoom === 1 && edit.offsetX === 0 && edit.offsetY === 0;
}

/**
 * Renders the framed part of [source] at [output] pixels.
 *
 * The transform is the preview's, with one extra scale in front of it that
 * turns frame pixels into output pixels - so a 300px preview and a 1024px
 * result are the same picture, and the person who framed it is not surprised.
 */
export function drawEdit(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource & Size,
  frame: Size,
  output: Size,
  edit: Edit,
): void {
  const scale = coverScale(source, frame, edit.rotation) * edit.zoom;
  context.save();
  context.translate(output.width / 2, output.height / 2);
  context.scale(output.width / frame.width, output.height / frame.height);
  context.translate(edit.offsetX, edit.offsetY);
  context.scale(scale, scale);
  context.rotate((edit.rotation * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  context.restore();
}
