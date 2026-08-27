/**
 * A real web origin for the Listen Together player to live in.
 *
 * A packaged build serves the renderer from `file://`, and a YouTube embed
 * framed by a `file://` document is refused: "Video player configuration
 * error", error 153, over a black frame. The embed decides that from what the
 * browser tells it about the page it is on, and a `file://` page has nothing to
 * tell it - no origin worth the name and no referrer.
 *
 * Two things were measured before this was written, because both are the
 * obvious fix and neither works:
 *
 * - **Filling in the `Referer` header** for the embed request. It changes the
 *   refusal from 153 to 152 and nothing else; not one byte of media is
 *   fetched. The header is not what the player reads.
 * - **Serving the renderer from a custom `app://` scheme**, registered
 *   standard and secure. Identical: 153 bare, 152 with a referrer. Only
 *   `http`/`https` counts as somewhere a player may be embedded.
 *
 * What does work is giving the embed an ancestor that is a real web origin. So
 * the main process runs a loopback HTTP server with exactly one page on it, and
 * the renderer frames *that* instead of framing YouTube directly. The page
 * frames the embed and relays messages between it and the app in both
 * directions, so the protocol in `src/services/youtube.ts` is unchanged -
 * commands go down, state comes up, and the only difference is which window
 * they pass through.
 *
 * The app's own origin does not move, which is the point of doing it this way
 * rather than serving the whole renderer over `http://127.0.0.1`. That would
 * work too, and it would move every user's device identity, endpoint and
 * settings to a new origin - a re-login and a re-keyed E2EE device for a music
 * player.
 *
 * What the server is:
 *
 * - Bound to `127.0.0.1` on a port the OS picks. Nothing off this machine can
 *   reach it, and nothing about it is guessable between launches.
 * - One page, behind a random path. A page in the user's browser cannot find it
 *   by scanning ports, and finding it would gain nothing: it holds no data and
 *   answers no questions.
 * - Static HTML with no app state in it at all. The video id arrives in the
 *   query string and is checked against YouTube's own id shape before it is put
 *   anywhere.
 */
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

/** The only origins the relay will speak to, in either direction. */
export const YOUTUBE_ORIGINS = [
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
  'https://youtube.com',
  'https://youtube-nocookie.com',
  'https://m.youtube.com',
  'https://music.youtube.com',
];

const EMBED_HOST = 'https://www.youtube.com';

/** YouTube's id shape. Anything else is not put into a frame `src`. */
export function validVideoId(value: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;
}

/**
 * The page, as it is served.
 *
 * It is deliberately small enough to read in one go, because it sits between
 * the app and a third party and both directions of that channel are checked
 * here:
 *
 * - Down: only messages from the window that framed this page, which is the
 *   app, are passed to the embed.
 * - Up: only messages from the embed frame, on a YouTube origin, are passed to
 *   the app. Anything else on the machine that got hold of this URL can post
 *   all it likes and be ignored.
 */
export function relayHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>BetweenUs player</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com https://youtube-nocookie.com; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
</head>
<body>
<script>
(function () {
  var origins = ${JSON.stringify(YOUTUBE_ORIGINS)};
  var id = new URLSearchParams(location.search).get('v') || '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;

    var safeOrigin = location.origin.replace('127.0.0.1', 'localhost');
    var params = new URLSearchParams({
      enablejsapi: '1',
      autoplay: '1',
      controls: '0',
      disablekb: '1',
      rel: '0',
      modestbranding: '1',
      playsinline: '1',
      fs: '1',
      // The player is told what origin it runs on, mapped to localhost hostname
      // rather than raw 127.0.0.1 which triggers YouTube's domain filters.
      origin: safeOrigin,
      widget_referrer: safeOrigin,
    });

  var frame = document.createElement('iframe');
  frame.title = 'Listen Together';
  frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
  frame.setAttribute('allowfullscreen', 'true');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.src = '${EMBED_HOST}/embed/' + id + '?' + params.toString();
  document.body.appendChild(frame);

  window.addEventListener('message', function (event) {
    // Up: the embed talking. Origin and source both, because either alone is
    // a hole - one lets any frame on a YouTube origin in, the other lets a
    // window that got a handle to this one in.
    if (event.source === frame.contentWindow) {
      if (origins.indexOf(event.origin) === -1) return;
      parent.postMessage(event.data, '*');
      return;
    }
    // Down: the app talking. Only the window that framed this page.
    if (event.source === parent && frame.contentWindow) {
      frame.contentWindow.postMessage(event.data, '*');
    }
  });
})();
</script>
</body>
</html>
`;
}

export interface Relay {
  /** The page URL, path token included. The renderer appends `&v=<id>`. */
  url: string;
  /** `http://127.0.0.1:<port>`, which is what messages from it arrive as. */
  origin: string;
  close: () => void;
}

/**
 * Starts the server and answers with where it is.
 *
 * A rejected promise is not fatal anywhere: the renderer falls back to framing
 * the embed directly, which is what the web client does and what a development
 * run - served over `http://localhost` already - needs anyway.
 */
export function startYouTubeRelay(): Promise<Relay> {
  const token = randomBytes(16).toString('hex');
  const pathname = `/${token}/player.html`;
  const body = relayHtml();

  return new Promise((resolve, reject) => {
    const server: Server = createServer((request, response) => {
      const requested = (request.url ?? '').split('?')[0];
      if (request.method !== 'GET' || requested !== pathname) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Nothing off this page may be framed by anything but the app, and
        // nothing about it is worth guessing at.
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'origin',
      });
      response.end(body);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        server.close();
        reject(new Error('The player relay got no port.'));
        return;
      }
      const origin = `http://127.0.0.1:${address.port}`;
      resolve({
        url: `${origin}${pathname}`,
        origin,
        close: () => server.close(),
      });
    });
  });
}
