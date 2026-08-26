/**
 * The header the Listen Together player cannot send for itself.
 *
 * A packaged build serves the renderer from `file://`, and a `file://` document
 * sends no `Referer` at all. YouTube's embed refuses to configure a player for
 * a request that arrives without one - that is error 153, "Video player
 * configuration error", drawn over a black frame with a "Watch on YouTube"
 * button. It is not a signed-in check, a region check or a rate limit: the
 * embed simply cannot tell what page it is being put on, so it declines to be
 * one.
 *
 * The fix is to say. Every `/embed/<id>` document request that arrives without
 * a referrer is given `https://www.youtube.com/`, which is exactly what the
 * same embed on a web page would carry, and the player configures normally.
 *
 * Two things this deliberately does NOT do:
 *
 * - **Touch a request that already has a referrer.** The dev server and the web
 *   client are real origins and send their own; rewriting those would replace a
 *   true statement with a guess.
 * - **Set `Origin`, or make `embedUrl` pass `origin=`.** The player posts its
 *   state back with the `origin` parameter as the target origin, so claiming to
 *   be on youtube.com there would silently drop every message into a renderer
 *   whose real origin is `file://` - a player that plays and never reports.
 *   Only the request header is rewritten; the frame stays honest about who it
 *   is talking to.
 */

/** The requests worth looking at: the embed document itself, nothing under it. */
export const EMBED_URLS = [
  'https://www.youtube-nocookie.com/embed/*',
  'https://youtube-nocookie.com/embed/*',
  'https://www.youtube.com/embed/*',
  'https://youtube.com/embed/*',
];

/** What a browser on an ordinary page would have sent. */
export const EMBED_REFERRER = 'https://www.youtube.com/';

type Headers = Record<string, string | string[]>;

function hasReferrer(headers: Headers): boolean {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'referer') continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string' && /^https?:\/\//i.test(first)) return true;
  }
  return false;
}

function isEmbed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.replace(/^www\./, '');
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return false;
  return parsed.pathname.startsWith('/embed/');
}

/**
 * The headers to send instead, or null for "leave this request alone".
 *
 * Null rather than a copy of the input so the caller can tell the two apart:
 * `onBeforeSendHeaders` should hand Chromium back its own object when nothing
 * changed, not a rebuilt one.
 */
export function embedHeaders(url: string, headers: Headers): Headers | null {
  if (!isEmbed(url)) return null;
  if (hasReferrer(headers)) return null;
  return { ...headers, Referer: EMBED_REFERRER };
}
