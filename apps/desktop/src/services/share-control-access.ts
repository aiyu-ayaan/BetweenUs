/**
 * Whether a client can hand the mouse over on the screen it is sharing, and
 * the sentence to send back when it cannot.
 *
 * Its own module, and pure, because the order of these reasons is the whole
 * behaviour and the store around it cannot be loaded outside a browser. See
 * `stores/shareControl.ts`, which reads the live state and calls this.
 */

/** What the sharing client knows about itself at the moment it is asked. */
export interface ShareControlContext {
  /** A screen is on the wire right now. */
  sharing: boolean;
  /** This client is the Electron app rather than a browser tab. */
  onDesktop: boolean;
  /** `window.betweenus.platform`, when there is a bridge to ask. */
  platform?: string;
  /**
   * A whole display is being shared rather than a single window. Input arrives
   * as a fraction of a display, and a window can be dragged between monitors,
   * so there is no fraction to map a click onto.
   */
  wholeDisplay: boolean;
}

/**
 * The runtime is asked before the surface, and that order is the point.
 *
 * A browser tab has no way to move its own machine's mouse - no API exists, and
 * none is coming - so *what* is being shared cannot make any difference there.
 * Asking about the surface first is what answered "a window is being shared,
 * not a whole screen" to somebody who had just picked their entire screen, for
 * every option in the browser's picker, with nothing to say the answer was
 * about the runtime rather than their choice.
 *
 * Wanting the mouse on a web share is a real thing to want, so the refusal
 * names the way through rather than only the wall: the machine can be reached
 * as a remote session instead, which its owner grants beforehand and which a
 * browser tab can drive perfectly well.
 */
export function shareControlRefusal(context: ShareControlContext): string | null {
  if (!context.sharing) return 'they are not sharing a screen';
  if (!context.onDesktop) {
    return 'they are sharing from a browser, which cannot hand over its mouse - the desktop app can, or open a remote session on their machine instead';
  }
  if (context.platform !== 'win32') return 'control is not supported on that machine';
  if (!context.wholeDisplay) return 'a window is being shared, not a whole screen';
  return null;
}
