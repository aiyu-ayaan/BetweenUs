/**
 * The ring around an avatar that says somebody has posted, split into one arc
 * per post.
 *
 * The split is the whole point: a solid ring says "there is something here"
 * and a ring in four pieces says "there are four things here", which is the
 * question people actually have before deciding to open it. It is the same
 * device the tray uses to count, so the count is never a number to read.
 *
 * Drawn as an SVG stroke rather than a border, because a border cannot be cut
 * into arcs and a conic gradient cannot leave a gap between them.
 */
const RADIUS = 47;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The gap between two arcs, in user units of the 100-wide viewBox. */
const GAP = 5;

export interface RingSegment {
  /** `stroke-dasharray`: the drawn arc, then the rest of the circle. */
  dash: string;
  /** Where that arc starts, as a negative `stroke-dashoffset`. */
  offset: number;
}

/**
 * One entry per post, as dash geometry.
 *
 * A single post gets the whole circle with no gap - a lone arc with a notch in
 * it reads as a rendering fault rather than as a count. Above a dozen or so
 * the arcs would be shorter than the gaps between them, so the count stops
 * being drawn and the ring goes solid; the exact number stopped being legible
 * long before that.
 */
export const MAX_SEGMENTS = 12;

export function ringSegments(count: number): RingSegment[] {
  if (count <= 1 || count > MAX_SEGMENTS) {
    return [{ dash: `${CIRCUMFERENCE} 0`, offset: 0 }];
  }
  const step = CIRCUMFERENCE / count;
  const arc = step - GAP;
  return Array.from({ length: count }, (_, index) => ({
    dash: `${arc} ${CIRCUMFERENCE - arc}`,
    // SVG strokes start at three o'clock and run clockwise; a negative offset
    // walks the start of each arc forward around the circle.
    offset: -index * step,
  }));
}

/**
 * The ring itself, sized to whatever it is laid over.
 *
 * Green while there is something unopened, and grey once there is not - the
 * two states everybody already reads without being told which is which.
 */
export function StatusRing({
  count,
  unseen,
}: {
  count: number;
  unseen: boolean;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="pointer-events-none absolute inset-[-4px] h-[calc(100%+8px)] w-[calc(100%+8px)]"
    >
      {ringSegments(count).map((segment, index) => (
        <circle
          key={index}
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={segment.dash}
          strokeDashoffset={segment.offset}
          className={unseen ? 'stroke-status-online' : 'stroke-slate-600'}
        />
      ))}
    </svg>
  );
}
