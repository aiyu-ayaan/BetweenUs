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
  return typeof window !== 'undefined' && window.nexora !== undefined;
}
