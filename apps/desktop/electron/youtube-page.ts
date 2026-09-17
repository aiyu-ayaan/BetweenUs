/**
 * What this process knows about YouTube pages, with none of Electron in it.
 *
 * Two `WebContentsView`s point at the site - the browser somebody picks tracks
 * in (`youtube-view.ts`) and the hidden player the call actually hears
 * (`youtube-player.ts`) - and both need the same answers: which hosts are the
 * site, which URLs are a video, what to say to a page and what to make of its
 * reply. None of that needs a browser to decide, so none of it lives in a file
 * that cannot be run on its own. See `youtube-page.check.ts`.
 */

/**
 * The site, and the hosts a Google sign-in legitimately passes through.
 *
 * Confining navigation to this list is what makes it safe to point a view at
 * the open web at all: a sign-in flow needs Google's own hosts, and that is a
 * great deal less than "the internet".
 */
export const ALLOWED_HOSTS = [
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

/** True for `about:blank` and for the site; false for everywhere else. */
export function allowedUrl(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    return ALLOWED_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The video id on a page, if that page is a video.
 *
 * Deliberately the same shapes the pasted-link parser accepts, because they are
 * the same URLs - somebody browsing lands on exactly what somebody copying
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

/** The page one track plays on. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** What the renderer is told when it asks what the player is doing. */
export interface ListenPlayerState {
  positionMs: number;
  durationMs: number;
  playing: boolean;
  ended: boolean;
  title: string | null;
  /**
   * True while YouTube is playing an advert instead of the track.
   *
   * This matters because during an advert `currentTime` is the *advert's*, and
   * two windows on different adverts would otherwise correct each other into
   * the wrong place. Position is not reported and drift is not closed while it
   * is true; each window rejoins on its own when its advert finishes. An
   * account with Premium never sees one.
   */
  ad: boolean;
}

/**
 * The track's name, out of the document title.
 *
 * `document.title` is the only place the site puts it that does not involve
 * guessing at a class name, and it carries the site's own name on the end. A
 * title that is *only* that suffix is a page which has not settled yet, and is
 * reported as nothing rather than as a track called "YouTube".
 */
export function cleanTitle(documentTitle: string): string | null {
  const text = documentTitle.replace(/\s*-\s*YouTube\s*$/, '').trim();
  if (!text || text === 'YouTube') return null;
  // The unread-count prefix a background tab gets: "(3) Some Song".
  return text.replace(/^\(\d+\)\s*/, '').trim() || null;
}

/**
 * The one script the player drives the page with, and the only place it is
 * written.
 *
 * It reads and corrects in the same pass, deliberately. Volume and mute are
 * *asserted* on every read rather than set once on load, because the thing
 * being corrected is YouTube restoring its own remembered values - which it
 * does when the page loads, at a moment nothing here can name. Either one
 * getting through is a player that is present, correct, in step and silent,
 * which is the exact failure this feature has spent its whole life having.
 */
export function readScript(volume: number): string {
  const wanted = Math.min(1, Math.max(0, volume));
  return `(() => {
  const v = document.querySelector('video');
  if (!v) return null;
  if (v.muted) v.muted = false;
  if (Math.abs(v.volume - ${wanted}) > 0.01) v.volume = ${wanted};
  const player = document.querySelector('#movie_player');
  return {
    currentTime: v.currentTime,
    duration: v.duration,
    paused: v.paused,
    ended: v.ended,
    ad: !!(player && player.classList.contains('ad-showing')),
    title: document.title,
  };
})()`;
}

/** Turns what the page said into what the call needs, or null if it said nothing. */
export function stateFrom(raw: unknown): ListenPlayerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const number = (key: string): number => {
    const entry = value[key];
    return typeof entry === 'number' && Number.isFinite(entry) ? entry : 0;
  };
  const ad = value.ad === true;
  return {
    // Zero during an advert: it is the advert's position, and reporting it
    // would drag everybody else to a timestamp in a different piece of audio.
    positionMs: ad ? 0 : Math.round(number('currentTime') * 1000),
    durationMs: ad ? 0 : Math.round(number('duration') * 1000),
    playing: value.paused === false,
    // An advert that finishes fires `ended` on the same element. Treating that
    // as the track ending would skip a song nobody has heard.
    ended: !ad && value.ended === true,
    title: typeof value.title === 'string' ? cleanTitle(value.title) : null,
    ad,
  };
}
