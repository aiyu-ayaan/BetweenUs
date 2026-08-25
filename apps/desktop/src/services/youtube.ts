/**
 * A YouTube player driven by `postMessage`, with no YouTube script in this
 * window.
 *
 * The obvious way to embed YouTube is to load `iframe_api.js` and use the
 * object it hands back. That is remote code running in the renderer, and this
 * app's whole CSP argument is one line: `script-src` stays `'self'`, so nothing
 * this window fetches can become code. Loosening it for a music player would
 * trade the strongest security property the client has for a convenience.
 *
 * It is not needed. `iframe_api.js` is a wrapper around a `postMessage`
 * protocol the embed speaks anyway, and that protocol is a hundred lines:
 *
 * - Post `{event: 'listening'}` to the frame and it starts sending state back.
 * - Post `{event: 'command', func, args}` to drive it.
 * - It posts `{event: 'infoDelivery', info: {...}}` with the position, the
 *   player state, the duration and the title.
 *
 * So the frame is a cross-origin iframe pointed at youtube-nocookie.com, and
 * the only thing that changes in the CSP is `frame-src`. YouTube's code runs in
 * YouTube's origin, in a document this one cannot read and which cannot read
 * this one, and the entire surface between them is the message channel below -
 * which is checked for origin on the way in, because a `message` handler that
 * does not check origin is a hole any page in any frame can post through.
 *
 * The frame carries no `sandbox` attribute, and that is the deliberate part.
 * `sandbox` without `allow-same-origin` gives a frame an *opaque* origin, so
 * everything it posts arrives as `event.origin === 'null'` and the origin check
 * refuses all of it - a player that loads, shows a picture and never answers a
 * command. It also buys nothing here: a cross-origin frame is already isolated
 * from this document by the same-origin policy, exactly as hard.
 *
 * ponytail: one provider. Spotify is a second `ListenProvider` and a second
 * class with the same four methods, and it needs things this does not - an
 * OAuth flow, a Premium account per listener, and the Web Playback SDK, which
 * *is* remote code and so needs the CSP conversation this design avoided. It is
 * not modelled ahead of time; the seam is the discriminant on `ListenTrack`.
 */

/** The origin the frame is loaded from. */
export const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * Origins a message from the player may arrive on.
 *
 * Both, because the embed is served from the no-cookie host and its player code
 * sometimes posts as `www.youtube.com`. Anything else is another frame on the
 * page pretending, and is dropped - a `message` handler that does not check
 * this is a hole any frame can post through.
 */
export const YOUTUBE_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
];

/** What the embed reports about itself. */
export interface YouTubeState {
  /** Seconds, as the player reports them. */
  positionMs: number;
  durationMs: number;
  playing: boolean;
  ended: boolean;
  title: string | null;
}

/**
 * The player-state numbers the embed sends. Named because `1` and `2` in a
 * comparison are the kind of thing that reads correctly and means the opposite.
 */
const UNSTARTED = -1;
const ENDED = 0;
const PLAYING = 1;

/**
 * Pulls a video id out of whatever somebody pasted.
 *
 * Every shape YouTube itself produces: a watch URL, a share link, a short, an
 * embed, a music.youtube link, and the bare id - which is what somebody who
 * already knows the id will type. Returns null for anything else rather than
 * guessing, because a guess ends up in an iframe `src` in everybody's window.
 */
export function parseYouTube(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  // The bare id. Eleven characters of YouTube's alphabet, which is specific
  // enough that nothing else a person pastes looks like it.
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;

  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') return valid(path[0]);
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com' && host !== 'music.youtube.com') {
    return null;
  }
  if (path[0] === 'watch') return valid(url.searchParams.get('v'));
  if (path[0] === 'shorts' || path[0] === 'embed' || path[0] === 'live') return valid(path[1]);
  // `/v=...` without `/watch`, which some share paths still produce.
  return valid(url.searchParams.get('v'));
}

function valid(id: string | null | undefined): string | null {
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/**
 * The URL the frame is pointed at. Separated so the check can read it.
 *
 * `origin` is passed only when it is a real web origin. A packaged Electron
 * build serves the renderer from `file://`, and `origin=file://` is not a thing
 * YouTube accepts - it refuses the API handshake outright, which is a player
 * that loads, shows a frame and never answers a command. Omitting the parameter
 * is allowed and is what that case needs.
 */
export function embedUrl(videoId: string, origin: string): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    // Asked for up front as well as commanded later. The command path needs the
    // handshake to have completed; this does not, so a player that is slow to
    // answer still starts on time for whoever added the track.
    autoplay: '1',
    // Nothing but this app drives the player: the call decides what plays, so
    // the embed's own controls would be a second set of buttons that change
    // what one person hears and nobody else.
    controls: '0',
    disablekb: '1',
    // No "watch next" grid over the last frame of a track, and no suggestions
    // from a channel nobody chose.
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    fs: '1',
  });
  if (/^https?:\/\//.test(origin)) params.set('origin', origin);
  return `${YOUTUBE_ORIGIN}/embed/${videoId}?${params.toString()}`;
}

/**
 * One embed, wrapped so the store can talk to it in milliseconds.
 *
 * The frame is created here and appended by the caller: a player with nowhere
 * to live does not autoplay, and the element has to be in the document before
 * the first command is worth sending.
 */
export class YouTubePlayer {
  readonly frame: HTMLIFrameElement;
  private state: YouTubeState = {
    positionMs: 0,
    durationMs: 0,
    playing: false,
    ended: false,
    title: null,
  };
  private ready = false;
  /** Commands sent before the frame answered, replayed once it does. */
  private readonly pending: Array<[string, unknown[]]> = [];
  private readonly listener: (event: MessageEvent) => void;
  private handshake: number | null = null;

  constructor(
    videoId: string,
    private readonly onState: (state: YouTubeState) => void,
  ) {
    this.frame = document.createElement('iframe');
    this.frame.src = embedUrl(videoId, window.location.origin);
    this.frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
    this.frame.setAttribute('allowfullscreen', 'true');
    // No `sandbox` attribute, and that is deliberate rather than an omission.
    //
    // It was `sandbox="allow-scripts allow-presentation"` and that is why
    // nothing ever played. Without `allow-same-origin` a frame is given an
    // *opaque* origin, so every message it posts arrives with
    // `event.origin === 'null'` - which the origin check below correctly
    // refused, every time. The handshake therefore never completed, the queued
    // `playVideo` was never flushed, and the result was a player that looked
    // present and was silent, with nothing in the console to say why.
    //
    // Adding `allow-same-origin` back would fix that and buy nothing: this
    // frame is already cross-origin, so the same-origin policy isolates it from
    // this document exactly as hard as the sandbox was pretending to. The
    // sandbox was security theatre that broke the feature.
    this.frame.setAttribute('title', 'Listen Together');
    this.frame.style.border = '0';
    this.frame.style.width = '100%';
    this.frame.style.height = '100%';

    this.listener = (event) => this.receive(event);
    window.addEventListener('message', this.listener);

    // The frame answers `listening` only once it has loaded, and there is no
    // load event that reliably arrives first across every runtime this app runs
    // in. Asking repeatedly until it replies is a hundred bytes a second for
    // about a second, and is the difference between a player that starts and
    // one that silently never does.
    this.handshake = window.setInterval(() => {
      if (this.ready) {
        this.stopHandshake();
        return;
      }
      this.post('listening', []);
    }, 250);
    this.post('listening', []);
  }

  private stopHandshake(): void {
    if (this.handshake !== null) window.clearInterval(this.handshake);
    this.handshake = null;
  }

  private receive(event: MessageEvent): void {
    // The check that makes this safe. Without it any frame or opener on the
    // page can post a message shaped like YouTube's and drive the player - or
    // worse, be believed about a title that is then drawn.
    if (!YOUTUBE_ORIGINS.includes(event.origin)) return;
    if (event.source !== this.frame.contentWindow) return;

    let message: { event?: string; info?: Record<string, unknown> };
    try {
      message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (message.event === 'onReady' || message.event === 'initialDelivery') {
      this.flush();
    }
    if (message.event !== 'infoDelivery' && message.event !== 'initialDelivery') return;

    const info = message.info ?? {};
    const next = { ...this.state };
    if (typeof info.currentTime === 'number') next.positionMs = Math.round(info.currentTime * 1000);
    if (typeof info.duration === 'number' && info.duration > 0) {
      next.durationMs = Math.round(info.duration * 1000);
    }
    if (typeof info.playerState === 'number') {
      next.playing = info.playerState === PLAYING;
      next.ended = info.playerState === ENDED;
      // The first state that is not "unstarted" is the frame saying it exists,
      // which is when queued commands are worth sending.
      if (info.playerState !== UNSTARTED) this.flush();
    }
    const data = info.videoData as { title?: unknown } | undefined;
    if (data && typeof data.title === 'string' && data.title) next.title = data.title;

    this.state = next;
    this.onState(next);
  }

  private flush(): void {
    if (this.ready) return;
    this.ready = true;
    this.stopHandshake();
    for (const [func, args] of this.pending.splice(0)) this.post('command', [], func, args);
  }

  private post(event: string, _args: unknown[], func?: string, args: unknown[] = []): void {
    const window_ = this.frame.contentWindow;
    if (!window_) return;
    const body = func ? { event, func, args } : { event };
    // `'*'` as the target: the frame's own origin is YouTube's and is the only
    // thing that can receive this, and naming it exactly has to be right for
    // whichever of the two hosts the player settled on. The message carries no
    // secret - it is "play", "pause", "seek to 1:04" - so the cost of being
    // wrong about the target is nothing, and the cost of being wrong about the
    // name is silence.
    window_.postMessage(JSON.stringify({ ...body, id: 'betweenus', channel: 'widget' }), '*');
  }

  private command(func: string, args: unknown[] = []): void {
    if (!this.ready) {
      // One entry per command, most recent wins: replaying a queue of six
      // seeks on the way in would make the player stutter through all of them.
      const at = this.pending.findIndex(([name]) => name === func);
      if (at !== -1) this.pending.splice(at, 1);
      this.pending.push([func, args]);
      return;
    }
    this.post('command', [], func, args);
  }

  play(): void {
    this.command('playVideo');
  }

  pause(): void {
    this.command('pauseVideo');
  }

  seek(positionMs: number): void {
    // `true` is "allow seeking ahead of what is buffered", which is what a
    // correction needs: the alternative is a player that agrees to catch up
    // only as far as it had already downloaded.
    this.command('seekTo', [positionMs / 1000, true]);
  }

  /** 0 to 100. Used for ducking under whoever is talking, not by a slider. */
  setVolume(volume: number): void {
    this.command('setVolume', [Math.round(Math.min(100, Math.max(0, volume)))]);
  }

  /** The last thing the frame said about itself. */
  current(): YouTubeState {
    return this.state;
  }

  close(): void {
    this.stopHandshake();
    window.removeEventListener('message', this.listener);
    this.frame.remove();
  }
}
