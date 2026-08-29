/**
 * Where somebody goes to get the app.
 *
 * One constant, because two screens want it for opposite reasons and both have
 * to point at the same place: the sidebar offers it to anybody running in a
 * browser, and the one-time viewer sends people there when a browser cannot do
 * what the message needs.
 *
 * The repository is the same one the desktop and Android updaters already
 * check - `electron/updates.ts` and `Releases.kt` - but it is spelled out here
 * rather than imported from either. The updater constants live in the Electron
 * main process and in Kotlin; neither is reachable from the browser bundle,
 * which is precisely the build that needs this link.
 */
const REPOSITORY = 'aiyu-ayaan/BetweenUs';

/**
 * The releases page, not a file.
 *
 * A direct link to an installer would have to know the platform, the
 * architecture and the current version, and would rot the moment a release is
 * cut. The releases page shows every build for every platform and is the one
 * URL that is still right in a year.
 */
export const DOWNLOAD_URL = `https://github.com/${REPOSITORY}/releases/latest`;

/**
 * What to call the download for whoever is looking at it.
 *
 * The platform is a guess from the user agent and is only ever a label - the
 * link goes to the same page whatever it says, so a wrong guess costs a word
 * and never a broken download. `userAgentData` where a browser has it, the
 * user-agent string where it does not.
 */
export function downloadLabel(agent: string = navigator.userAgent): string {
  const platform = agent.toLowerCase();
  if (/android/.test(platform)) return 'Get the Android app';
  if (/iphone|ipad|ipod/.test(platform)) return 'Get the app';
  if (/mac os|macintosh/.test(platform)) return 'Get the Mac app';
  if (/linux/.test(platform)) return 'Get the Linux app';
  if (/windows/.test(platform)) return 'Get the Windows app';
  return 'Get the app';
}
