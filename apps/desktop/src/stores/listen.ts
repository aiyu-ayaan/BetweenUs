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
import { YouTubePlayer, parseYouTube } from '../services/youtube';
import { useVoiceStore } from './voice';

/**
 * How loud the music is while somebody is talking, as a fraction of the volume
 * that was set.
 *
 * This is the bit that makes it "working together" rather than "watching a
 * film". Two people with music on and a microphone open either shout over it or
 * turn it down by hand every time one of them starts a sentence, and the second
 * of those is what everybody actually does until they give up and mute. Pulling
 * it down automatically is what a person would do, done in eighty milliseconds.
 */
const DUCK = 0.25;

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
  /** Whether the panel is on screen. Local: it is a view, not a shared decision. */
  open: boolean;
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

  /** The element the player's frame lives in, for the panel to adopt. */
  host: () => HTMLDivElement;

  attach: (mesh: Mesh) => void;
  detach: () => void;
  receive: (session: ListenSession | null) => void;
  sampleClock: (sample: ClockSample) => void;

  setOpen: (open: boolean) => void;
  setVolume: (volume: number) => void;
  /** A pasted link or a bare id. Returns what went wrong, or null. */
  add: (input: string) => string | null;
  remove: (trackId: string) => void;
  playPause: () => void;
  playIndex: (index: number) => void;
  skip: (delta: number) => void;
  seek: (positionMs: number) => void;
  stop: () => void;
  /** The click that lets a blocked player start. */
  allow: () => void;
}

/** The live pieces, outside the store: React must not re-render on a player tick. */
let mesh: Mesh | null = null;
let player: YouTubePlayer | null = null;
/** Which track the current player was built for, so it is rebuilt only on a change. */
let loadedTrackId: string | null = null;
let host: HTMLDivElement | null = null;
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
  ducking: false,
  needsGesture: false,
  error: null,

  host: () => {
    if (!host) {
      host = document.createElement('div');
      host.style.width = '100%';
      host.style.height = '100%';
    }
    return host;
  },

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
    unsubscribeVoice?.();
    unsubscribeVoice = null;
    teardownPlayer();
    reportedEnd.clear();
    reportedMeta.clear();
    set({ session: null, open: false, ducking: false, needsGesture: false, error: null });
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

  sampleClock: (sample) => clock.sample(sample),

  setOpen: (open) => set({ open }),

  setVolume: (volume) => {
    set({ volume: Math.min(100, Math.max(0, Math.round(volume))) });
    applyDuck(true);
  },

  add: (input) => {
    const ref = parseYouTube(input);
    if (!ref) return 'That does not look like a YouTube link.';
    mesh?.sendListen({ type: 'listen.add', provider: 'youtube', ref });
    set({ open: true, error: null });
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
    mesh?.sendListen({
      type: 'listen.pause',
      positionMs: player?.current().positionMs ?? listenPositionAt(session, clock.now()),
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

  // A different track means a different video, and the embed loads one video.
  // Rebuilt rather than told to load another, because a frame that has already
  // been refused autoplay stays refused, and a fresh one gets a fresh answer.
  if (loadedTrackId !== track.id) {
    teardownPlayer();
    loadedTrackId = track.id;
    player = new YouTubePlayer(track.ref, (state) => onPlayerState(state));
    (host ?? useListenStore.getState().host()).append(player.frame);
    applyDuck(true);
    // Nothing else here: the player has not loaded, so telling it to seek is
    // telling nobody. The next tick, or its first state message, does it.
    return;
  }
  if (!player) return;

  const actual = player.current();
  if (session.paused && actual.playing) player.pause();
  if (!session.paused && !actual.playing && !actual.ended) player.play();

  const seekTo = correction(session, clock.now(), actual.positionMs);
  if (seekTo !== null) player.seek(seekTo);
}

/** What the embed says about itself, turned into what the call needs to know. */
function onPlayerState(state: ReturnType<YouTubePlayer['current']>): void {
  const store = useListenStore.getState();
  const session = store.session;
  const track = currentTrack(session);
  if (!session || !track) return;

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

  // Told to play, loaded, and not playing: the browser refused. Nothing here
  // can fix that - a gesture in this window can, and saying so is the only
  // honest thing to put on screen.
  if (!session.paused && !state.playing && !state.ended && state.durationMs > 0) {
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
    player.setVolume(target);
    fadeFrom = target;
    return;
  }
  if (fadeFrom === target || fadeTimer !== null) return;

  const from = fadeFrom;
  const step = (target - from) / DUCK_FADE_STEPS;
  let taken = 0;
  fadeTimer = window.setInterval(() => {
    taken += 1;
    fadeFrom = taken >= DUCK_FADE_STEPS ? target : Math.round(from + step * taken);
    player?.setVolume(fadeFrom);
    if (taken >= DUCK_FADE_STEPS && fadeTimer !== null) {
      window.clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }, DUCK_FADE_MS);
}

/** Where the fade currently is, so a second one starts from the truth. */
let fadeFrom = 60;

function teardownPlayer(): void {
  player?.close();
  player = null;
  loadedTrackId = null;
}
