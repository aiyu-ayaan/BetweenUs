/**
 * Listen Together: one shared queue, one position, one player per window.
 *
 * The difference between this and sharing a browser tab with the sound on is
 * the whole reason it exists. A share is media: one upload per listener, the
 * music squeezed through a codec meant for speech, everybody hearing whatever
 * survived the trip, and the person sharing unable to alt-tab away from it.
 * Here nothing is uploaded at all. Each window streams the track itself, at
 * full quality, from the provider; what the call agrees on is a queue and a
 * number. That is a few hundred bytes when somebody presses a button, and
 * nothing at all in between.
 *
 * It is also why anybody can drive it. There is no host, because a host is a
 * person who eventually leaves and takes the music with them - the queue is a
 * thing the room built, and it belongs to the room.
 *
 * This store is the reconciler. The gateway says what should be happening; the
 * player says what is happening; and about five times a minute this compares
 * them and does the smallest thing that closes the gap. Everything harder than
 * that is somewhere else: the arithmetic is `listen-sync.ts`, the player is
 * `youtube.ts`, and the ordering is the gateway's.
 */
import { create } from 'zustand';
import { listenPositionAt, type ListenSession, type ListenTrack } from '@betweenus/shared-types';
import type { Mesh } from '../services/mesh';
import {
  CLOCK_SAMPLE_MS,
  DRIFT_CHECK_MS,
  ServerClock,
  correction,
  type ClockSample,
} from '../services/listen-sync';
import { YouTubePlayer, parseYouTube, type ListenPlayer, type YouTubeState } from '../services/youtube';
import { NativeListenPlayer, closeNativePlayer, hasNativePlayer } from '../services/native-player';
import { useVoiceStore } from './voice';
import { useGameStore } from './game';

/**
 * How loud the music is while somebody is talking, as a fraction of the volume
 * that was set.
 *
 * This is the bit that makes it "working together" rather than "watching a
 * film". Two people with music on and a microphone open either shout over it or
 * turn it down by hand every time one of them starts a sentence, and the second
 * Because volume uses a quadratic perceptual curve ((volume/100)^2), a slider
 * ratio of 0.55 corresponds to ~0.30 (-10.4 dB) acoustic power. This pulls
 * the music back gracefully so conversation is effortless to follow, without
 * making the music disappear or lowering it too much.
 */
const DUCK = 0.55;

/**
 * How long the music stays down after the last word.
 *
 * Speech is not continuous - there is a gap between "so" and "the thing is" -
 * and a duck that recovers instantly pumps the volume up and down through every
 * sentence, which is far more distracting than the music was.
 */
const DUCK_HOLD_MS = 900;

/** Steps the volume takes on the way down and back, for a fade rather than a jump. */
const DUCK_FADE_STEPS = 6;
const DUCK_FADE_MS = 80;

interface ListenState {
  /** What the call is listening to, as the gateway last said. Null for nothing. */
  session: ListenSession | null;
  /**
   * Whether the Listen Together panel has the stage.
   *
   * Local: it is a view, not a shared decision. Somebody who folds the video
   * away to read something is not asking the rest of the call to stop watching.
   *
   * It is a single flag with a *single* render site, and that is the fix for a
   * real bug rather than a preference. The panel used to be a popover hung off
   * `VoiceControls` - which is rendered twice, once in the sidebar and once in
   * the channel view - so one flag drew two panels, side by side, both live.
   * A piece of shared state may only be drawn once.
   */
  open: boolean;
  /**
   * Which half of the panel is showing.
   *
   * `browse` is the real youtube.com and is the default, because looking for
   * something to play is what somebody opening this is doing. `playing` is the
   * video everybody is watching. They are tabs rather than two panels because
   * only one of them can have the space, and because a native browser view and
   * an embedded player must never be on screen at the same time - see
   * `ListenBrowser` on why a `WebContentsView` paints over everything.
   */
  tab: 'browse' | 'playing';
  /**
   * This window's own volume, 0-100, and nobody else's business.
   *
   * Shared transport, local volume: what is playing is a thing two people agree
   * on, how loud it is in one person's headphones is not.
   */
  volume: number;
  /** True while the music is turned down under somebody talking. */
  ducking: boolean;
  /**
   * How far this machine's clock is behind the gateway's, in milliseconds.
   *
   * In the store only so the seek bar can draw a position between messages.
   * The reconciler reads the clock itself.
   */
  clockOffset: number;
  /**
   * The browser refused to start the audio without a gesture, so a button has
   * to be pressed in this window before anything is heard.
   *
   * Only ever true for the person who did *not* start the track: their window
   * had no click in it, and an embedded player that is told to start playing
   * audio out of nowhere is exactly what autoplay policy exists to stop. Saying
   * so is the whole fix - the alternative is a session that looks like it is
   * playing and is silent, with nothing on screen to explain it.
   */
  needsGesture: boolean;
  error: string | null;

  attach: (mesh: Mesh) => void;
  detach: () => void;
  receive: (session: ListenSession | null) => void;
  sampleClock: (sample: ClockSample) => void;

  setOpen: (open: boolean) => void;
  setTab: (tab: 'browse' | 'playing') => void;
  setVolume: (volume: number) => void;
  /**
    * A pasted link or a bare id. Returns what went wrong, or null.
    *
    * `playNow` jumps to it as well, which is what pressing a video in the
    * browser means - the queue is where a second choice goes, not the first.
    */
  add: (input: string, playNow?: boolean) => string | null;
  remove: (trackId: string) => void;
  playPause: () => void;
  playIndex: (index: number) => void;
  skip: (delta: number) => void;
  seek: (positionMs: number) => void;
  stop: () => void;
  /** The click that lets a blocked player start. */
  allow: () => void;
}

/**
 * Builds whichever player this window has.
 *
 * Desktop gets real youtube.com in a view the main process owns, because the
 * `/embed/` player refuses a label's video - error 101 or 150, a black frame -
 * and that is most of the music anybody queues. A browser tab cannot have that:
 * youtube.com refuses to be framed, so the web client gets the embed and a
 * restricted track fails there, with the link offered instead.
 *
 * Nothing below this line knows which one it got.
 */
function buildPlayer(videoId: string, onState: (state: YouTubeState) => void): ListenPlayer {
  if (hasNativePlayer()) return new NativeListenPlayer(videoId, onState);
  const embed = new YouTubePlayer(videoId, onState);
  // The web embed is an iframe and has to be in the document to play at all.
  // Parked, permanently: this feature has no picture, so there is no rectangle
  // for it to be moved over and nothing ever shows it. Real video dimensions
  // off-screen rather than one pixel or `display:none`, because Chromium
  // throttles and then stalls a frame it believes nobody can see.
  embedHost().append(embed.frame);
  return embed;
}

/**
 * Somewhere off-screen for the web client's iframe to live and keep playing.
 *
 * Desktop never builds this: its player is not in this document at all.
 */
let host: HTMLDivElement | null = null;
function embedHost(): HTMLDivElement {
  if (host) return host;
  host = document.createElement('div');
  host.style.cssText =
    'position:fixed;top:-9999px;left:-9999px;width:320px;height:180px;pointer-events:none;overflow:hidden;';
  document.body.append(host);
  return host;
}

/** The live pieces, outside the store: React must not re-render on a player tick. */
let mesh: Mesh | null = null;
let player: ListenPlayer | null = null;
/** Which track the current player was built for, so it is rebuilt only on a change. */
let loadedTrackId: string | null = null;

const clock = new ServerClock();
let driftTimer: number | null = null;
let clockTimer: number | null = null;
let duckTimer: number | null = null;
let fadeTimer: number | null = null;
let lastHeardAt = 0;
let unsubscribeVoice: (() => void) | null = null;
/**
 * Tracks whose end this window has already reported.
 *
 * The player sits at the end of a finished track saying "ended" until it is
 * told otherwise, so without this the same `ended` is sent five times a second
 * until the gateway's answer arrives. The gateway ignores the repeats, but a
 * client that shouts is a client that will shout at something else later.
 */
const reportedEnd = new Set<string>();
/** Tracks this window has already described, for the same reason. */
const reportedMeta = new Set<string>();

function currentTrack(session: ListenSession | null): ListenTrack | null {
  if (!session) return null;
  return session.queue[session.index] ?? null;
}

export const useListenStore = create<ListenState>((set, get) => ({
  session: null,
  open: false,
  volume: 60,
  tab: 'browse',
  ducking: false,
  clockOffset: 0,
  needsGesture: false,
  error: null,

  attach: (next) => {
    mesh = next;
    // Measured from the moment there is a socket rather than when a track is
    // added: the first sample is the least accurate one, and a session that
    // starts with eight of them behind it starts in step.
    next.sampleServerTime();
    clockTimer = window.setInterval(() => mesh?.sampleServerTime(), CLOCK_SAMPLE_MS);
    driftTimer = window.setInterval(() => reconcile(), DRIFT_CHECK_MS);

    // Ducking rides on the speaking detection the call already does, which is
    // measured from the audio itself rather than from whether a microphone is
    // open - so a muted person with a noisy room does not turn the music down.
    unsubscribeVoice = useVoiceStore.subscribe((state) => {
      if (state.tiles.some((tile) => tile.speaking)) lastHeardAt = Date.now();
    });
    duckTimer = window.setInterval(() => applyDuck(), 100);
  },

  detach: () => {
    mesh = null;
    for (const timer of [clockTimer, driftTimer, duckTimer, fadeTimer]) {
      if (timer !== null) window.clearInterval(timer);
    }
    clockTimer = driftTimer = duckTimer = fadeTimer = null;
    fadeFrom = fadeTarget = get().volume;
    unsubscribeVoice?.();
    unsubscribeVoice = null;
    teardownPlayer();
    // Destroyed rather than hidden, here and only here - both views. The
    // sign-in and the half-typed search are worth keeping across a collapsed
    // panel and are not worth keeping across a call nobody is in.
    void window.betweenus?.youtubeClose?.();
    closeNativePlayer();
    host?.remove();
    host = null;
    reportedEnd.clear();
    reportedMeta.clear();
    set({
      session: null,
      open: false,
      tab: 'browse',
      ducking: false,
      clockOffset: 0,
      needsGesture: false,
      error: null,
    });
  },

  receive: (session) => {
    const previous = get().session;
    // The gateway numbers every change, so this client's own echo of a state it
    // has already applied cannot undo a later one somebody else caused. Out of
    // order is not hypothetical: two people pressing skip within a second of
    // each other is the ordinary case this feature is for.
    if (session && previous && session.rev <= previous.rev) return;
    set({ session, error: null });
    if (!session) {
      teardownPlayer();
      set({ needsGesture: false });
      return;
    }
    reconcile();
  },

  sampleClock: (sample) => {
    clock.sample(sample);
    const offset = clock.offset();
    // Only when it has actually moved: this fires every fifteen seconds and a
    // set() that changes nothing still wakes every subscriber.
    if (offset !== get().clockOffset) set({ clockOffset: offset });
  },

  setOpen: (open) => {
    // The stage holds one thing. Opening this folds the games panel away, and
    // opening that folds this one - decided in the stores rather than in the
    // view, because the button exists twice and the rule must not.
    if (open) {
      useGameStore.getState().setOpen(false);
      if (get().session) set({ tab: 'playing' });
    }
    set({ open });
  },
  setTab: (tab) => set({ tab }),

  setVolume: (volume) => {
    set({ volume: Math.min(100, Math.max(0, Math.round(volume))) });
    applyDuck(true);
  },

  add: (input, playNow = false) => {
    const ref = parseYouTube(input);
    if (!ref) return 'That does not look like a YouTube link.';
    mesh?.sendListen({ type: 'listen.add', provider: 'youtube', ref, playNow });
    set({ error: null });
    // Stay on the browser. Adding a second track while looking for a third is
    // the normal case, and throwing somebody back to the player every time they
    // press add is the thing that makes queueing four songs annoying.
    // The click that added a track is a gesture in *this* window, which is what
    // lets its player start. Everybody else's window may still need one.
    set({ needsGesture: false });
    return null;
  },

  remove: (trackId) => mesh?.sendListen({ type: 'listen.remove', trackId }),

  playPause: () => {
    const session = get().session;
    if (!session) return;
    if (session.paused) {
      mesh?.sendListen({ type: 'listen.play' });
      return;
    }
    // The position goes with the pause, taken from this window's own player
    // rather than from the shared clock: the player is the thing that actually
    // stopped, and it stopped where it stopped.
    //
    // Unless this window is in an advert, and then it emphatically did not.
    // Everything the player reports mid-advert is about the advert, and this
    // one reports a position of zero by design - so pausing during one used to
    // mean "pause, at the beginning", and the whole call jumped back to the
    // start of a song because one person's window was showing them a car ad.
    // The shared clock is what this window would have been at, and is right.
    const local = player?.current();
    mesh?.sendListen({
      type: 'listen.pause',
      positionMs:
        local && !local.ad ? local.positionMs : listenPositionAt(session, clock.now()),
    });
  },

  playIndex: (index) => mesh?.sendListen({ type: 'listen.play', index }),
  skip: (delta) => mesh?.sendListen({ type: 'listen.skip', delta }),
  seek: (positionMs) => mesh?.sendListen({ type: 'listen.seek', positionMs: Math.round(positionMs) }),
  stop: () => mesh?.sendListen({ type: 'listen.stop' }),

  allow: () => {
    set({ needsGesture: false });
    player?.play();
    reconcile();
  },
}));

/**
 * Makes this window's player look like what the call says is happening.
 *
 * Called on every state change and on a timer, and it is deliberately the same
 * code both times: a correction that only runs on a message would never fix
 * drift, which accumulates while nothing is being sent, and one that only runs
 * on a timer would take five seconds to notice somebody pressed pause.
 */
function reconcile(): void {
  const store = useListenStore.getState();
  const session = store.session;
  const track = currentTrack(session);
  if (!session || !track) {
    teardownPlayer();
    return;
  }

  // A different track means a different video, and a player plays one video.
  // Rebuilt rather than told to load another, because a web embed that has
  // already been refused autoplay stays refused and a fresh one gets a fresh
  // answer. On desktop the rebuild is a navigation in a view that stays put.
  if (loadedTrackId !== track.id) {
    teardownPlayer();
    loadedTrackId = track.id;
    player = buildPlayer(track.ref, (state) => onPlayerState(state));
    applyDuck(true);
    // Nothing else here: the player has not loaded, so telling it to seek is
    // telling nobody. The next tick, or its first state message, does it.
    return;
  }
  if (!player) return;

  const actual = player.current();
  // Mid-advert, every number the player reports is about the advert and not
  // about the track. Correcting from them would seek everybody else into the
  // middle of a song, so this window sits the advert out and rejoins on the
  // tick after it ends - which the ordinary drift correction below does by
  // itself, because by then the numbers mean the track again.
  if (actual.ad) return;

  if (session.paused && actual.playing) player.pause();
  if (!session.paused && !actual.playing && !actual.ended) player.play();

  const seekTo = correction(session, clock.now(), actual.positionMs);
  if (seekTo !== null) player.seek(seekTo);
}

/** What the player says about itself, turned into what the call needs to know. */
function onPlayerState(state: YouTubeState): void {
  const store = useListenStore.getState();
  const session = store.session;
  const track = currentTrack(session);
  if (!session || !track) return;
  // An advert's title is not the track's and an advert's end is not the
  // track's, so nothing said during one is told to anybody else.
  if (state.ad) return;

  // The title and the length: a pasted link carries neither, and a player that
  // has loaded the video knows both. First window to say so fills them in for
  // everybody, and nothing on the server ever has to ask YouTube anything.
  if (!reportedMeta.has(track.id) && (state.title || state.durationMs > 0)) {
    if (!track.title || track.durationMs === 0) {
      reportedMeta.add(track.id);
      mesh?.sendListen({
        type: 'listen.meta',
        trackId: track.id,
        title: state.title ?? undefined,
        durationMs: state.durationMs || undefined,
      });
    }
  }

  if (state.ended && !reportedEnd.has(track.id)) {
    reportedEnd.add(track.id);
    // Every window sends this; the gateway advances once, because the second
    // and third arrivals are about a track that is no longer current.
    mesh?.sendListen({ type: 'listen.ended', trackId: track.id });
    return;
  }

  if (state.error) {
    let errorText = 'This video is unavailable for embedding on third-party sites.';
    if (state.error === 101 || state.error === 150) {
      errorText = 'The video owner does not allow embedding on third-party sites.';
    } else if (state.error === 2) {
      errorText = 'Invalid YouTube video link or ID.';
    } else if (state.error === 5) {
      errorText = 'HTML5 playback error on this video.';
    }
    if (store.error !== errorText) useListenStore.setState({ error: errorText });
  } else if (state.playing && store.error) {
    useListenStore.setState({ error: null });
  }

  // Told to play, loaded, and not playing: the browser refused. Nothing here
  // can fix that - a gesture in this window can, and saying so is the only
  // honest thing to put on screen.
  //
  // The web client only. The desktop player runs with autoplay permitted,
  // because nobody can click a view nobody can see - so a desktop window that
  // is not playing has some other problem, and "press play here" would be a
  // button that does nothing pointed at a person who cannot help.
  if (
    !hasNativePlayer() &&
    !session.paused &&
    !state.playing &&
    !state.ended &&
    state.durationMs > 0 &&
    !state.error
  ) {
    if (!store.needsGesture) useListenStore.setState({ needsGesture: true });
  } else if (store.needsGesture && state.playing) {
    useListenStore.setState({ needsGesture: false });
  }
}

/**
 * Moves the volume towards where it should be: down while somebody is talking,
 * back up once they have stopped for long enough to have meant it.
 *
 * Faded rather than switched, because a volume that steps is more noticeable
 * than the music it was hiding. `immediate` is the volume slider, which is a
 * person asking for a change and should not have to wait half a second for it.
 */
function applyDuck(immediate = false): void {
  if (!player) return;
  const { volume, ducking } = useListenStore.getState();
  const talking = Date.now() - lastHeardAt < DUCK_HOLD_MS;
  const target = Math.round(volume * (talking ? DUCK : 1));

  if (talking !== ducking) useListenStore.setState({ ducking: talking });

  if (immediate) {
    if (fadeTimer !== null) window.clearInterval(fadeTimer);
    fadeTimer = null;
    fadeTarget = target;
    fadeFrom = target;
    player.setVolume(target);
    return;
  }

  // Already at the target and no fade in progress
  if (fadeFrom === target && fadeTimer === null) return;
  // Already actively fading towards this exact target
  if (fadeTarget === target && fadeTimer !== null) return;

  fadeTarget = target;
  if (fadeTimer !== null) {
    window.clearInterval(fadeTimer);
    fadeTimer = null;
  }

  const from = fadeFrom;
  const step = (target - from) / DUCK_FADE_STEPS;
  let taken = 0;
  fadeTimer = window.setInterval(() => {
    taken += 1;
    fadeFrom = taken >= DUCK_FADE_STEPS ? target : Math.round(from + step * taken);
    player?.setVolume(fadeFrom);
    if (taken >= DUCK_FADE_STEPS) {
      if (fadeTimer !== null) window.clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }, DUCK_FADE_MS);
}

/** Where the fade currently is and where it is heading, so reversals start smoothly from the current level. */
let fadeFrom = 60;
let fadeTarget = 60;

function teardownPlayer(): void {
  player?.close();
  player = null;
  loadedTrackId = null;
  if (useListenStore.getState().error) useListenStore.setState({ error: null });
}
