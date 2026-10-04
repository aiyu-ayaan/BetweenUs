import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** The gap between a popover and the button it belongs to, and the screen edge. */
const GAP = 8;

interface Placement {
  left: number;
  bottom: number;
  maxHeight: number;
}

/**
 * A popover over the call dock, drawn into `document.body`.
 *
 * Positioned inside the dock it lived in whatever stacking context the dock
 * did, and a call view has several: a shared screen's `<video>`, a stage that
 * is `overflow-hidden`, a dock that centres itself in a column narrower than
 * it is. Any one of those cut the top off the device list or pushed it off the
 * edge of the window. Fixed to the viewport and clamped inside it, nothing on
 * the stage can cover it and no column can clip it.
 *
 * It opens upwards, centred on its button, and scrolls rather than leaving the
 * top of the window when the button sits low on a short one.
 */
export function CallPopover({
  anchor,
  width,
  panel,
  className = '',
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  width: number;
  /** Handed back so the caller's click-away check can see the portalled node. */
  panel?: RefObject<HTMLDivElement>;
  className?: string;
  children: ReactNode;
}): JSX.Element | null {
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const place = (): void => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const centred = rect.left + rect.width / 2 - width / 2;
      setPlacement({
        left: Math.max(GAP, Math.min(centred, window.innerWidth - width - GAP)),
        bottom: window.innerHeight - rect.top + GAP,
        maxHeight: Math.max(rect.top - GAP * 2, 120),
      });
    };
    place();
    window.addEventListener('resize', place);
    // Capture, so a scroll in any container the dock sits in moves it too.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, width]);

  if (!placement) return null;

  return createPortal(
    <div
      ref={panel}
      style={{
        left: placement.left,
        bottom: placement.bottom,
        width: Math.min(width, window.innerWidth - GAP * 2),
        maxHeight: placement.maxHeight,
      }}
      className={`no-drag fixed z-[80] animate-pop overflow-y-auto rounded-xl border border-edge bg-surface-900/95 shadow-pop backdrop-blur-md ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
