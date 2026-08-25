/**
 * The real youtube.com, inside the app window.
 *
 * The point of this file is that pasting links is not browsing. Somebody who
 * wants to put music on wants to sign in, look at their subscriptions and their
 * playlists, search for a thing they half remember, and press it - and none of
 * that is reachable from an `/embed/` frame.
 *
 * It cannot be an iframe either. youtube.com sends `X-Frame-Options` and a
 * `frame-ancestors` policy that refuse framing outright, so a browser tab can
 * never show the site inside another page - and that is not a thing a client
 * gets to work around. Only `/embed/<id>` is frameable, which is the player and
 * nothing else. This is therefore a **desktop-only** capability, and the web
 * client says so rather than pretending.
 *
 * What it is not: `webviewTag`. Turning that on would give the renderer the
 * ability to mount arbitrary web content anywhere, which is a permission the
 * whole hardening story in `main.ts` exists to withhold. Instead the main
 * process owns a `WebContentsView`, and the renderer may only ask for it to be
 * put over a rectangle - the same "follow a slot" arrangement the embedded
 * player uses, for the same reason: the view must not be destroyed and rebuilt
 * every time a React component happens to unmount.
 *
 * Three things make it safe to point at the open web:
 *
 * - **Its own session partition.** `persist:youtube` keeps a signed-in Google
 *   account for next time and keeps it entirely apart from the app's own
 *   cookies. Nothing here can read a BetweenUs session and nothing in the app
 *   is reachable from a page loaded here.
 * - **No preload, no Node.** It is an ordinary browser context with no bridge
 *   into this application at all.
 * - **It cannot wander.** Navigation is confined to Google's own hosts, which
 *   is what a sign-in flow needs and is a great deal less than "the internet";
 *   anything else is opened in the user's real browser instead. New windows are
 *   refused for the same reason.
 */
import { WebContentsView, session as electronSession, shell, type BrowserWindow } from 'electron';

/** The site, and the hosts a Google sign-in legitimately passes through. */
const ALLOWED_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'studio.youtube.com',
  'accounts.google.com',
  'accounts.youtube.com',
  'myaccount.google.com',
  'consent.youtube.com',
  'consent.google.com',
];

const HOME = 'https://www.youtube.com';

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the renderer is told every time the page changes. */
export interface YouTubeNavigation {
  url: string;
  title: string;
  /** The video id, when the current page is one. Null everywhere else. */
  videoId: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

let view: WebContentsView | null = null;
let owner: BrowserWindow | null = null;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function allowed(url: string): boolean {
  if (url === 'about:blank') return true;
  const host = hostOf(url);
  return host !== null && ALLOWED_HOSTS.includes(host);
}

/**
 * The video id on the page, if this page is a video.
 *
 * Deliberately the same shapes the pasted-link parser accepts, because they are
 * the same URLs - a person browsing lands on exactly what a person copying
 * would have copied.
 */
export function videoIdOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.split('/').filter(Boolean);
  const valid = (id: string | null | undefined): string | null =>
    id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;

  if (parsed.hostname === 'youtu.be') return valid(path[0]);
  if (path[0] === 'shorts' || path[0] === 'embed' || path[0] === 'live') return valid(path[1]);
  return valid(parsed.searchParams.get('v'));
}

function report(): void {
  if (!view || !owner || owner.isDestroyed()) return;
  const contents = view.webContents;
  const url = contents.getURL();
  owner.webContents.send('youtube:navigated', {
    url,
    title: contents.getTitle(),
    videoId: videoIdOf(url),
    canGoBack: contents.canGoBack(),
    canGoForward: contents.canGoForward(),
    loading: contents.isLoading(),
  } satisfies YouTubeNavigation);
}

export function openYouTubeView(window: BrowserWindow, bounds: ViewBounds): void {
  if (view && owner === window) {
    view.setVisible(true);
    setYouTubeBounds(bounds);
    return;
  }
  closeYouTubeView();

  owner = window;
  view = new WebContentsView({
    webPreferences: {
      // Its own cookie jar, so a signed-in Google account survives a restart and
      // is nowhere near the app's own session.
      session: electronSession.fromPartition('persist:youtube'),
      // No preload and no Node: this is an ordinary browser context with no way
      // into this application.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The picture must keep decoding when the window is behind something.
      backgroundThrottling: false,
    },
  });

  const contents = view.webContents;
  // Silent, always. This half of the panel is for *choosing* a track: the sound
  // of the call is the shared player, which every window runs in step. An
  // unmuted browser here plays a second, unsynchronised copy of the same song
  // in one person's headphones over the one everybody agreed on.
  contents.setAudioMuted(true);
  // A real browser's, because YouTube serves a degraded page to anything it
  // does not recognise - and an Electron user agent is one of those.
  contents.setUserAgent(
    contents.getUserAgent().replace(/ Electron\/[\d.]+/, '').replace(/ BetweenUs\/[\d.]+/, ''),
  );

  contents.setWindowOpenHandler(({ url }) => {
    // A link out of YouTube is a link out of the app: it opens in the real
    // browser, where the user's own extensions, bookmarks and judgement live.
    if (!allowed(url)) void shell.openExternal(url);
    else void contents.loadURL(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (allowed(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  // Every one of these, because YouTube is a single-page application: a click
  // from the home page to a video is `did-navigate-in-page` and nothing else,
  // and listening only for `did-navigate` means the "add this" button stays
  // grey on the video somebody just opened.
  contents.on('did-navigate', () => report());
  contents.on('did-navigate-in-page', () => report());
  contents.on('did-finish-load', () => report());
  contents.on('did-stop-loading', () => report());
  contents.on('page-title-updated', () => report());

  window.contentView.addChildView(view);
  setYouTubeBounds(bounds);
  void contents.loadURL(HOME);
}

export function setYouTubeBounds(bounds: ViewBounds): void {
  if (!view) return;
  view.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  });
}

/**
 * Hides without destroying.
 *
 * A `WebContentsView` is a real browser: closing it loses the scroll position,
 * the search that was typed and the video that was half watched. Collapsing the
 * panel should not cost any of that, so the view is only made invisible - the
 * renderer asks for it to be destroyed when the call ends.
 */
export function hideYouTubeView(): void {
  view?.setVisible(false);
  // And stop whatever it had started. The site plays a video the moment it is
  // clicked, and a hidden view goes on decoding it - a second copy of the same
  // stream, pulled down for nobody, while the shared player plays the real one.
  // Muted was enough for the sound; this is the bandwidth.
  void view?.webContents
    .executeJavaScript('document.querySelectorAll("video").forEach((v) => v.pause());', true)
    .catch(() => undefined);
}

export function closeYouTubeView(): void {
  if (view && owner && !owner.isDestroyed()) owner.contentView.removeChildView(view);
  view?.webContents.close();
  view = null;
  owner = null;
}

export function youTubeGoBack(): void {
  const contents = view?.webContents;
  if (contents?.canGoBack()) contents.goBack();
}

export function youTubeGoForward(): void {
  const contents = view?.webContents;
  if (contents?.canGoForward()) contents.goForward();
}

export function youTubeHome(): void {
  void view?.webContents.loadURL(HOME);
}

/** Search, as a URL rather than as an API call - no key, and the real results. */
export function youTubeSearch(query: string): void {
  const url = `${HOME}/results?search_query=${encodeURIComponent(query.slice(0, 200))}`;
  void view?.webContents.loadURL(url);
}
