/**
 * Where the picture actually is inside the box it is drawn in.
 *
 * A shared desktop is letterboxed rather than cropped, so the element and the
 * picture are two different rectangles whenever their aspect ratios differ -
 * a 16:10 screen in a 16:9 box has a black bar down each side. Every cursor
 * position and every click is a fraction of the *picture*, and treating the
 * element as the picture puts them further out the worse the mismatch is.
 *
 * Pure, and separated from the component, so the arithmetic can be checked
 * without a browser: `stage-geometry.check.ts`.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const EMPTY_BOX: Box = { left: 0, top: 0, width: 0, height: 0 };

/** The `object-contain` rectangle of `video` inside an `element`-sized box. */
export function contentBox(
  elementWidth: number,
  elementHeight: number,
  videoWidth: number,
  videoHeight: number,
): Box {
  if (elementWidth <= 0 || elementHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return EMPTY_BOX;
  }
  const scale = Math.min(elementWidth / videoWidth, elementHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    left: (elementWidth - width) / 2,
    top: (elementHeight - height) / 2,
    width,
    height,
  };
}

/**
 * A point in the element, as a fraction of the picture - or null when it is on
 * the black bars, which are not part of anybody's screen.
 */
export function fractionIn(box: Box, x: number, y: number): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const fx = (x - box.left) / box.width;
  const fy = (y - box.top) / box.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return { x: fx, y: fy };
}
