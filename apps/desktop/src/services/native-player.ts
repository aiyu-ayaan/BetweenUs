/**
 * The desktop player, as the reconciler sees it.
 *
 * There is almost nothing here, and that is the point: the player is a hidden
 * view on real youtube.com that the main process owns, so this is a handle on
 * it. It satisfies the same `ListenPlayer` interface the web client's embed
 * does, which is what lets `stores/listen.ts` - the queue, the clock, the drift
 * arithmetic, the ducking - be written once and not know which it has.
 *
 * Why the desktop app does not use the embed at all: the embed refuses to play
 * a label's video, answering error 101 or 150 with a black frame, and that is
 * most of the music anybody puts on. The site plays it. See
 * `electron/youtube-player.ts` for what that costs and what it took to measure.
 *
 * **Polled, not pushed.** The main process is asked what the player is doing
 * about twice a second rather than telling us, because telling us would need a
 * preload in a view that loads pages from the open web - a bridge into this
 * application, opened to save a round trip. Half a second is comfortably inside
 * the 1.5 seconds the drift correction waits for before it acts on anything.
 */
import type { ListenPlayer, YouTubeState } from './youtube';

/** How often the main process is asked what the page is doing. */
const POLL_MS = 500;

const IDLE: YouTubeState = {
  positionMs: 0,
  durationMs: 0,
  playing: false,
  ended: false,
  title: null,
  error: null,
  ad: false,
};

export class NativeListenPlayer implements ListenPlayer {
  private state: YouTubeState = IDLE;
  private timer: number | null = null;
  private closed = false;
  /**
   * Volume is held here as well as in the main process because the store sets
   * it through `setVolume` at a moment the page may not have loaded yet. Every
   * load carries the current value, so a track that starts while the music is
   * ducked starts ducked rather than at full volume for a beat.
   */
  private volume = 0.6;

  constructor(
    videoId: string,
    private readonly onState: (state: YouTubeState) => void,
  ) {
    void window.betweenus?.listenPlayerLoad?.(videoId, this.volume);
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
  }

  private async poll(): Promise<void> {
    const read = await window.betweenus?.listenPlayerRead?.().catch(() => null);
    if (this.closed) return;
    // Null is a page with no video element yet - loading, or the blank page
    // between two tracks. Neither is news, and reporting it as "stopped at
    // zero" would make the reconciler seek a player that has not arrived.
    if (!read) return;
    const next: YouTubeState = {
      positionMs: read.positionMs,
      durationMs: read.durationMs,
      playing: read.playing,
      ended: read.ended,
      title: read.title,
      // There is no such thing here. The whole class of embed refusals this
      // player exists to escape cannot happen on the site itself.
      error: null,
      ad: read.ad,
    };
    this.state = next;
    this.onState(next);
  }

  private control(action: string, value = 0): void {
    void window.betweenus?.listenPlayerControl?.(action, value);
  }

  play(): void {
    this.control('play');
  }

  pause(): void {
    this.control('pause');
  }

  seek(positionMs: number): void {
    this.control('seek', positionMs);
  }

  setVolume(volume: number): void {
    // The interface speaks 0-100, because that is what the embed's own command
    // takes and what the slider in the panel is. A video element wants 0-1.
    this.volume = Math.min(100, Math.max(0, volume)) / 100;
    this.control('volume', this.volume);
  }

  current(): YouTubeState {
    return this.state;
  }

  /**
   * Stops this track. **Does not destroy the view.**
   *
   * The reconciler builds a player per track, and the view is not a per-track
   * thing: rebuilding a browser every time somebody skips a song would cost a
   * process launch and a cold start in the gap between two tracks. Loading the
   * next one is a navigation in the view that is already there.
   *
   * The pause matters for the case this is not followed by another track - the
   * queue emptying, or somebody pressing stop. See `closeNativePlayer`.
   */
  close(): void {
    this.closed = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.control('pause');
  }
}

/**
 * Takes the whole player away, which only the end of a call does.
 *
 * The same rule the browser half follows: hidden between uses, destroyed when
 * the call it belonged to is over.
 */
export function closeNativePlayer(): void {
  void window.betweenus?.listenPlayerClose?.();
}

/** True when this window has the desktop player, rather than the web embed. */
export function hasNativePlayer(): boolean {
  return Boolean(window.betweenus?.listenPlayerLoad);
}
