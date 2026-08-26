/**
 * Finding something to play, from a browser tab.
 *
 * The desktop app frames youtube.com itself - see `ListenBrowser` - and a web
 * page never can: youtube.com sends `X-Frame-Options` and a `frame-ancestors`
 * policy, so the site refuses to be shown inside another page and no amount of
 * proxying, sandboxing or relaying changes that. What the web client was left
 * with was a paste box, which asks somebody to leave the app, find the video in
 * another tab and copy its link back.
 *
 * So the browsing that a web tab *can* do is searching: the YouTube Data API
 * answers CORS requests straight from the page, which means the search goes
 * from the person's own browser to Google and nowhere else.
 *
 * That is not a shortcut, it is the point. `shared-types` says plainly that
 * nothing on the server may talk to YouTube - a backend that searched on a
 * client's behalf would need an API key, an egress rule and an opinion about
 * who is looking for what. The key here is a browser key, which Google's own
 * console restricts by referrer, and no request touches BetweenUs at all.
 *
 * Unset key means no search tab, and the paste box stays. This is optional the
 * same way TURN is optional: a deployment that has not configured it loses a
 * convenience, not the feature.
 */

/** One result, reduced to what a row on screen needs. */
export interface YouTubeResult {
  videoId: string;
  title: string;
  channel: string;
  /** https URL. The renderer's CSP allows `img-src https:`. */
  thumbnail: string;
}

const ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';

/** How many results one search asks for. A screenful, not a scroll session. */
const RESULTS = 24;

/**
 * The browser key, or null when this deployment has not set one.
 *
 * Trimmed because a `.env` written by hand ends up with a trailing space more
 * often than anybody would like, and a key with a space on the end fails as an
 * authentication error rather than as a missing setting.
 */
export function youtubeSearchKey(): string | null {
  // Optional on `env` itself as well as on the value: this module is imported
  // by a `tsx` self-check, where `import.meta.env` does not exist at all.
  const key = import.meta.env?.VITE_YOUTUBE_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Turns the API's answer into rows, dropping anything that is not a playable
 * video.
 *
 * Defensive about every field on purpose: this is a third party's JSON going
 * into an `img` `src` and a video id going into an iframe `src`, and "the shape
 * changed" must be an empty list rather than an exception in a render. The id
 * is checked against YouTube's own id shape for the same reason
 * `youtube-relay.ts` checks it - a value that reaches a frame `src` is checked
 * wherever it arrives, not once.
 */
export function parseResults(payload: unknown): YouTubeResult[] {
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const results: YouTubeResult[] = [];
  for (const item of items) {
    const record = item as {
      id?: { videoId?: unknown };
      snippet?: { title?: unknown; channelTitle?: unknown; thumbnails?: Record<string, unknown> };
    };
    const videoId = record.id?.videoId;
    if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;

    const snippet = record.snippet ?? {};
    const thumbnails = snippet.thumbnails ?? {};
    // Medium first, then whatever exists. The default is 120px wide, which is
    // visibly soft in a grid, and `high` is not always present.
    const picked = ['medium', 'high', 'default']
      .map((size) => thumbnails[size] as { url?: unknown } | undefined)
      .find((entry) => typeof entry?.url === 'string');

    results.push({
      videoId,
      title: typeof snippet.title === 'string' ? snippet.title : videoId,
      channel: typeof snippet.channelTitle === 'string' ? snippet.channelTitle : '',
      thumbnail: typeof picked?.url === 'string' ? picked.url : '',
    });
  }
  return results;
}

/**
 * Results already fetched this session, keyed by query.
 *
 * A search costs 100 units of a 10,000-unit daily quota - a hundred searches a
 * day for the whole deployment - and typing a word, deleting it and typing it
 * again is one search, not three.
 *
 * ponytail: unbounded and never invalidated, which is fine for a map of short
 * strings that dies with the tab. Bound it if this ever moves somewhere that
 * lives longer.
 */
const cache = new Map<string, YouTubeResult[]>();

/**
 * Searches, or explains why it cannot.
 *
 * Throws with something worth putting on screen: a 403 here is nearly always a
 * key restricted to the wrong referrer or a quota spent, and both are things an
 * operator can act on if the message says which.
 */
export async function searchYouTube(query: string, signal?: AbortSignal): Promise<YouTubeResult[]> {
  const key = youtubeSearchKey();
  if (!key) throw new Error('YouTube search is not configured for this deployment.');

  const text = query.trim();
  if (!text) return [];
  const cached = cache.get(text);
  if (cached) return cached;

  const params = new URLSearchParams({
    key,
    q: text,
    part: 'snippet',
    type: 'video',
    // The web client plays through the embed, so a video that refuses to be
    // embedded is a result that would load a black frame for everybody in the
    // call. Filtered here rather than discovered there.
    videoEmbeddable: 'true',
    maxResults: String(RESULTS),
  });

  const response = await fetch(`${ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        'YouTube refused the search - the API key is restricted to another site, or the daily quota is spent.',
      );
    }
    throw new Error(`YouTube search failed (${response.status}).`);
  }

  const results = parseResults(await response.json());
  cache.set(text, results);
  return results;
}
