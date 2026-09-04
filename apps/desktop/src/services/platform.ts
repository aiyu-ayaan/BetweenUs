import type { CSSProperties } from 'react';

/**
 * Which runtime this UI is running in.
 *
 * The same React source builds two clients: the Electron app in `apps/desktop`
 * and the browser bundle in `apps/web`. Everything that needs a machine - screen
 * capture by source, synthetic mouse and keyboard input, the OS keychain - is
 * behind the preload bridge, and a browser has none of it. So the split is not a
 * build flag but the bridge's own presence: one bundle, and the parts that
 * cannot work in a tab are not offered there.
 *
 * What this gates is the *remote desktop* section - the machine list, the agent
 * that offers this machine, and the Remote Access settings. Asking for control
 * of somebody's screen share inside a call is not gated: sending input events
 * over the data channel needs no bridge, and the machine on the other end is the
 * one that has to be able to apply them (see stores/shareControl.ts).
 */

/** True in the Electron app, false in a browser tab. */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && window.betweenus !== undefined;
}

/** What Windows and Linux draw for minimise, maximise and close. */
const CAPTION_BUTTONS_PX = 146;

/** The macOS traffic lights, on the other side of the frame. */
const CAPTION_BUTTONS_MAC_PX = 86;

/**
 * The room an overlay has to leave for the window buttons.
 *
 * The app paints its own title bar, so the only thing the system still draws is
 * minimise/maximise/close - on the right on Windows and Linux, on the left on
 * macOS - and it draws them *over* whatever is there. Anything full-screen that
 * puts a control in that corner ends up underneath them: reachable by neither
 * click nor keyboard, because the hit-testing belongs to the frame.
 *
 * A browser tab has no such buttons, so there the corner is the page's to use.
 *
 * Read when a component renders rather than when this module loads. It used to
 * be a module-level constant in two files, which asks `window.betweenus` for
 * the platform before the preload bridge has necessarily put it there - and the
 * answer to "is this the desktop app" was then false for the rest of the
 * session, which is exactly how a control ends up under the close button.
 */

export function captionInset(): CSSProperties {
  if (!isDesktopRuntime()) return {};
  // A style rather than a padding class, and deliberately: every element that
  // needs this already carries a `p-4` or a `px-4`, and which of two Tailwind
  // padding utilities wins is decided by the order they land in the sheet
  // rather than the order they are written in. An inline style is not in that
  // argument.
  return window.betweenus?.platform === 'darwin'
    ? { paddingInlineStart: CAPTION_BUTTONS_MAC_PX }
    : { paddingInlineEnd: CAPTION_BUTTONS_PX };
}

/**
 * Where a control pinned to the caption corner has to start, so it sits beside
 * the window buttons rather than under them.
 *
 * {@link captionInset} is for a bar that spans the width; this is for the one
 * button anchored in that corner. The same two numbers, in one place.
 */
export function captionCorner(): CSSProperties {
  if (!isDesktopRuntime()) return { insetInlineEnd: 16 };
  return window.betweenus?.platform === 'darwin'
    ? { insetInlineStart: CAPTION_BUTTONS_MAC_PX }
    : { insetInlineEnd: CAPTION_BUTTONS_PX };
}
