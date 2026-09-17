/**
 * The Listen Together player: real youtube.com, parked where nobody sees it.
 *
 * This replaced a YouTube `/embed/` iframe, and the reason is the only reason
 * that ever mattered for this feature - **the embed will not play music.** A
 * label's video, which is most of what anybody puts on, answers the embed with
 * error 101 or 150 ("the owner does not allow embedding") and a black frame.
 * The site plays it. The site plays all of it, signed in, age-restricted, and
 * without an advert if the account has Premium, because it is not a third-party
 * surface asking permission - it is youtube.com.
 *
 * Everything that made the embed hard follows from it being an iframe: it
 * needed a real http origin, which needed a loopback server to frame it from
 * (`youtube-relay.ts`, now deleted); it spoke an undocumented `postMessage`
 * protocol that failed silently whenever a detail of it moved. None of that
 * applies here. This is a `WebContentsView` this process owns, and the thing it
 * is driving is a plain `HTMLVideoElement` - `currentTime`, `play`, `pause`,
 * `volume` - which is about as stable a contract as the web has.
 *
 * It is **not** the same view as `youtube-view.ts`. That one is visible, muted,
 * and pauses anything that starts, because it is for *choosing* a track. This
 * one is hidden, audible, and is the only thing in the app making sound. One
 * view cannot be both: browsing navigates away from the watch page, which would
 * stop the music every time somebody went looking for the next song. They share
 * `persist:youtube`, so they are the same signed-in account.
 *
 * Three things were measured before this was written, because all three are the
 * kind of detail that ships as a silent bug:
 *
 * - **`loadURL` rejects on a watch page.** youtube.com redirects to
 *   `?themeRefresh=1`, which aborts the original navigation, and Electron
 *   surfaces that abort as `ERR_ABORTED` on the promise. The page loads and
 *   plays perfectly. The rejection is noise and is swallowed.
 * - **YouTube restores its own remembered volume** (0.89, in the measurement)
 *   and its own remembered *mute*. Either would be a player that is present,
 *   correct, in step, and inaudible - the exact failure this feature has spent
 *   its whole life having. So both are forced on every read, not on load.
 * - **A hidden view goes on playing.** Parked off the window at real video
 *   dimensions, `backgroundThrottling` off: audible, and the bounds are what
 *   keeps Chromium from treating it as a background frame worth throttling.
 */
import { WebContentsView, session as electronSession, shell, type BrowserWindow } from 'electron';
import { allowedUrl, readScript, stateFrom, videoIdOf, watchUrl, type ListenPlayerState } from './youtube-page';

export type { ListenPlayerState };

/**
 * Where the player sits: off the window entirely, at real video dimensions.
 *
 * Not `setVisible(false)`, and not one pixel. Chromium is entitled to throttle
 * what it believes nobody can see, and a throttled player is a stalled one -
 * the same lesson the iframe host learned, written down in `stores/listen.ts`.
 * A `WebContentsView` is clipped to its window, so negative coordinates paint
 * nothing while remaining, as far as the compositor is concerned, a real view
 * of a real size.
 */
const PARKED = { x: -2000, y: -2000, width: 320, height: 180 };

let view: WebContentsView | null = null;
let owner: BrowserWindow | null = null;
/** The track the call is on. Null means nothing should be playing here. */
let wanted: string | null = null;
/** Last volume the renderer asked for, 0-1. Re-asserted on every read. */
let volume = 0.6;
/**
 * When this page last had an advert on it.
 *
 * Only this side can know it, and `stateFrom` needs it: for a moment after an
 * advert ends the element is still the advert's, and believing its `ended` skips
 * a track nobody has heard. Reset per load, because it is a fact about a page.
 */
let lastAdAt = 0;

/** A `loadURL` whose rejection is expected. See the note at the top of the file. */
function go(url: string): void {
  void view?.webContents.loadURL(url).catch(() => undefined);
}

/**
 * Puts the page back on the track the call is actually listening to.
 *
 * YouTube plays something else when a video ends, and on a page nobody is
 * looking at that is a second song starting in one person's headphones while
 * everybody else is still on the first. The site does not get a vote: any
 * navigation to a video the call did not ask for is undone.
 */
function guard(): void {
  const contents = view?.webContents;
  if (!contents || contents.isDestroyed()) return;
  const url = contents.getURL();
  if (!wanted) return;
  const playing = videoIdOf(url);
  if (playing === wanted) return;
  // Mid-navigation, or the blank page between tracks: neither is the site
  // choosing something, and reloading from here would fight the load in flight.
  if (contents.isLoading() || url === 'about:blank' || url === '') return;
  go(watchUrl(wanted));
}

export function openListenPlayer(window: BrowserWindow): void {
  if (view && owner === window) return;
  closeListenPlayer();

  owner = window;
  view = new WebContentsView({
    webPreferences: {
      // The same cookie jar as the browser half, so this is the account the
      // person signed into over there - which is what makes age-restricted
      // tracks play and adverts go away.
      session: electronSession.fromPartition('persist:youtube'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // No preload, and this is the deliberate part. A page from the open web
      // does not get a channel into this application to save a round trip; the
      // renderer polls instead, which costs one IPC every half second and keeps
      // the bridge at zero. The same rule `youtube-view.ts` follows.
      backgroundThrottling: false,
      // A watch page that waits for a click is a player that never starts:
      // nobody can click this, because nobody can see it.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  const contents = view.webContents;
  // A real browser's. YouTube serves a degraded page to a user agent it does
  // not recognise, and an Electron one is exactly that.
  contents.setUserAgent(
    contents.getUserAgent().replace(/ Electron\/[\d.]+/, '').replace(/ BetweenUs\/[\d.]+/, ''),
  );

  contents.setWindowOpenHandler(({ url }) => {
    if (!allowedUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!allowedUrl(url)) event.preventDefault();
  });
  contents.on('did-navigate', () => guard());
  contents.on('did-navigate-in-page', () => guard());

  window.contentView.addChildView(view);
  view.setBounds(PARKED);
}

/** Plays one track from the start. Loading is what starting a track means here. */
export function loadListenPlayer(videoId: string, wantedVolume: number): void {
  if (!view) return;
  wanted = videoId;
  volume = Math.min(1, Math.max(0, wantedVolume));
  lastAdAt = 0;
  go(watchUrl(videoId));
}

export function controlListenPlayer(action: string, value: number): void {
  const contents = view?.webContents;
  if (!contents || contents.isDestroyed()) return;
  const run = (code: string): void => {
    void contents.executeJavaScript(code, true).catch(() => undefined);
  };
  if (action === 'play') run(`document.querySelector('video')?.play().catch(() => {});`);
  if (action === 'pause') run(`document.querySelector('video')?.pause();`);
  if (action === 'seek') run(`{ const v = document.querySelector('video'); if (v) v.currentTime = ${value / 1000}; }`);
  if (action === 'volume') {
    volume = Math.min(1, Math.max(0, value));
    // Not sent: the next read asserts it, which is within half a second and is
    // the path that also survives the page reloading underneath it.
  }
}

/**
 * What the player is doing, and the one place the page is touched.
 *
 * A track that has ended takes the page to `about:blank` on the way out. The
 * renderer has this same answer in its hand and is about to tell the gateway;
 * what the blank page prevents is the site filling the gap before the gateway
 * answers, which it does by playing whatever it thinks should be next.
 */
export async function readListenPlayer(): Promise<ListenPlayerState | null> {
  const contents = view?.webContents;
  if (!contents || contents.isDestroyed()) return null;
  const raw = await contents.executeJavaScript(readScript(volume), true).catch(() => null);
  const state = stateFrom(raw, lastAdAt ? Date.now() - lastAdAt : Number.POSITIVE_INFINITY);
  if (state?.ad) lastAdAt = Date.now();
  if (state?.ended && wanted) {
    wanted = null;
    go('about:blank');
  }
  return state;
}

export function closeListenPlayer(): void {
  if (view && owner && !owner.isDestroyed()) owner.contentView.removeChildView(view);
  view?.webContents.close();
  view = null;
  owner = null;
  wanted = null;
}
