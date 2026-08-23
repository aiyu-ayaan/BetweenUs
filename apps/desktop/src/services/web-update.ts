/**
 * "This tab is running an older build than the one being served."
 *
 * A browser tab cannot install anything, so the whole of a web update is a
 * reload - but nothing tells a long-lived tab that a deployment happened, and
 * this app is one people leave open for days. So it asks.
 *
 * What it asks about is the *asset fingerprint*, not a version number. Vite
 * names every built file `index-<hash>.js`, and the hash changes exactly when
 * the contents do; `index.html` is the one unhashed file and is the list of
 * which hashes are current. So fetching that one small file and comparing the
 * names in it against the names this tab actually loaded answers the question
 * exactly, with nothing to remember to bump at release time.
 *
 * It deliberately does not use the version in `package.json`: the web client is
 * built from the same source as the desktop app but is not versioned with it,
 * and a number nobody moves is a check that never fires.
 *
 * The desktop app does not use any of this - it has a real updater, in
 * services/updates.ts and electron/updates.ts.
 */

/** How often a visible tab asks. Also asked whenever a tab is brought back. */
export const POLL_MS = 5 * 60 * 1000;

const ASSET_PATTERN = /(?:src|href)="([^"]*\/assets\/[^"]+)"/g;

/**
 * The built asset names named by a document, as one comparable string.
 *
 * Sorted and de-duplicated, so re-ordered markup that loads the same files is
 * the same build. An empty string means "no fingerprint here" - a development
 * server, an error page, a proxy's holding page - and is never treated as a
 * difference, because prompting a reload on the strength of a failed fetch
 * would be a reload loop.
 */
export function assetStamp(html: string): string {
  const names = new Set<string>();
  for (const match of html.matchAll(ASSET_PATTERN)) {
    const url = match[1];
    if (url) names.add(url);
  }
  return [...names].sort().join('|');
}

/** The same fingerprint for the build this tab is running. */
export function currentStamp(document: Document): string {
  const nodes = document.querySelectorAll<HTMLElement>('script[src], link[href]');
  const names = new Set<string>();
  nodes.forEach((node) => {
    // The attribute rather than the property: the property is resolved to an
    // absolute URL, and the served HTML has the relative one.
    const url = node.getAttribute('src') ?? node.getAttribute('href') ?? '';
    if (url.includes('/assets/')) names.add(url);
  });
  return [...names].sort().join('|');
}

/**
 * Whether `served` is a different build from `running`.
 *
 * Both have to say something. Either being empty is "cannot tell", which is not
 * the same as "changed".
 */
export function isNewBuild(running: string, served: string): boolean {
  return running !== '' && served !== '' && running !== served;
}

/** What the tab is currently being served, or '' when that could not be found. */
export async function fetchServedStamp(fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    // `no-store` rather than a cache-busting query string: the query would make
    // every poll a cache miss at the CDN as well, and this one is cheap.
    const response = await fetchImpl(`${location.origin}/index.html`, { cache: 'no-store' });
    if (!response.ok) return '';
    return assetStamp(await response.text());
  } catch {
    // Offline, or the deployment is mid-restart. Nothing to say.
    return '';
  }
}

/**
 * Watches for a new deployment and calls `onAvailable` once. Returns the
 * function that stops watching.
 *
 * Once is enough: the offer stays on screen until it is taken or dismissed, and
 * a second deployment while it is up does not make it any more true.
 */
export function watchForNewBuild(onAvailable: () => void, pollMs = POLL_MS): () => void {
  const running = currentStamp(document);
  let stopped = false;

  const look = async (): Promise<void> => {
    if (stopped || document.hidden) return;
    if (isNewBuild(running, await fetchServedStamp())) {
      stopped = true;
      onAvailable();
    }
  };

  // A tab that has been in the background for a week is the one most likely to
  // be stale, and is also the one whose interval the browser has been
  // throttling. Coming back to it is the moment worth asking.
  const onVisible = (): void => {
    if (!document.hidden) void look();
  };

  const timer = setInterval(() => void look(), pollMs);
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
