/**
 * Voice-channel state: the client is connected to at most one at a time.
 *
 * The media itself is `mesh.ts` - one peer connection per other participant,
 * with no server in the path. This store decides when to join, captures the
 * local devices, flattens the mesh into tiles React can render, and tells
 * presence-service who is in the channel so other members see it without
 * joining.
 *
 * Identity here is a *peer* id, not a user id: one account can have two windows
 * open and each is its own end of its own connections. `userId` is carried
 * alongside for the things that are about the person rather than the
 * connection - finding their machine in the remote-desktop list, mostly.
 */
import { create } from 'zustand';
import type { CallPeer } from '@nexora/shared-types';
import { api } from '../services/api';
import { callKeyForChannel } from '../services/e2ee';
import { Mesh, SLOTS, type Slot } from '../services/mesh';
import { presenceSocket } from '../services/socket';
import { useAuthStore } from './auth';
import { useShareControlStore } from './shareControl';
import { useAudioSettings } from './audioSettings';
import { NoiseGate } from '../services/mic-gate';
import { micCapture, micEncoding, micProcessing, type VoiceSettings } from '../services/voice-quality';
import { shareOptions, type ShareIntent, type ShareSize } from '../services/share-quality';

/** The local participant's own key in every map here. */
export const LOCAL = 'local';

export interface VoiceTile {
  /** Peer id, or `LOCAL`. Unique per connection, not per person. */
  identity: string;
  /** Who this is. Two tiles can share one, if somebody has two windows open. */
  userId: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micEnabled: boolean;
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  /** Audio that came with a shared screen - a film's soundtrack, usually. */
  screenAudioTrack: MediaStreamTrack | null;
  /** Epoch ms of the last time this person was an active speaker. */
  lastSpokeAt: number;
}

/** A screen someone is sharing. Separate from their tile: both can be on. */
export interface VoiceShare {
  identity: string;
  userId: string;
  name: string;
  isLocal: boolean;
  track: MediaStreamTrack | null;
}

interface VoiceState {
  status: 'idle' | 'connecting' | 'connected';
  channelId: string | null;
  tiles: VoiceTile[];
  shares: VoiceShare[];
  /** Identity whose shared screen fills the stage, or null for the grid. */
  watching: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenEnabled: boolean;
  /**
   * The display being shared, or null for a window. Handing control of a share
   * to somebody in the call needs it: a click arrives as a fraction of a screen
   * and a window has no such fraction - it can be dragged between two of them.
   */
  sharedDisplayId: string | null;
  /**
   * Whether media is end-to-end encrypted. Always true in a mesh: DTLS-SRTP
   * between two peers with nothing in between *is* end to end, and a peer whose
   * DTLS fingerprint is not signed with the channel key is never connected to.
   */
  encrypted: boolean;
  error: string | null;

  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  shareScreen: (
    source: ScreenSource | null,
    withAudio: boolean,
    intent: ShareIntent,
  ) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  watch: (identity: string | null) => void;
}

/**
 * The live call. Outside the store because it is machinery rather than rendered
 * state, and because React must never re-render on a peer-connection event.
 */
let mesh: Mesh | null = null;

/** peerId -> what has arrived from them, by slot. */
const remoteTracks = new Map<string, Partial<Record<Slot, MediaStreamTrack | null>>>();
let peers: CallPeer[] = [];
let speaking = new Set<string>();

/** What this client captured, so it can be stopped and replaced. */
const localTracks: Partial<Record<Slot, MediaStreamTrack | null>> = {};

/**
 * Identity -> when they last spoke. Kept outside the store because it is a
 * running record rather than rendered state: the grid sorts by it so whoever
 * just talked is on the first page.
 */
const lastSpoke = new Map<string, number>();

/**
 * The gate the microphone is published through, for as long as one call lasts.
 * Kept outside the store because it is a piece of audio plumbing rather than
 * rendered state: the sensitivity slider talks to it directly, which is what
 * lets a threshold change take effect without recapturing the track.
 */
let gate: NoiseGate | null = null;

/**
 * The gate's own audio context, one per window. Created on the first join,
 * which is a click, so it is never blocked by autoplay policy.
 */
let gateContext: AudioContext | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

let joinCounter = 0;

export const useVoiceStore = create<VoiceState>((set, get) => ({
  status: 'idle',
  channelId: null,
  tiles: [],
  shares: [],
  watching: null,
  micEnabled: false,
  cameraEnabled: false,
  screenEnabled: false,
  sharedDisplayId: null,
  encrypted: false,
  error: null,

  join: async (channelId) => {
    if (get().channelId === channelId && get().status !== 'idle') return;

    const currentJoinId = ++joinCounter;

    const previousChannelId = get().channelId;
    if (previousChannelId) presenceSocket.send({ type: 'voice.leave', channelId: previousChannelId });
    teardown();

    set({
      status: 'connecting',
      channelId,
      error: null,
      tiles: [],
      shares: [],
      watching: null,
    });

    try {
      const token = useAuthStore.getState().accessToken;
      if (!token) throw new Error('Not signed in');

      // The key is the channel's own, and it never leaves this machine: it is
      // used here only to sign this client's DTLS fingerprint, so the
      // signalling server cannot substitute one of its own and stand in the
      // middle. See mesh.ts.
      const [channelKey, { iceServers }] = await Promise.all([
        callKeyForChannel(channelId),
        api.callIce(channelId),
      ]);

      if (joinCounter !== currentJoinId) return;

      const settings = useAudioSettings.getState().settings;

      const next = new Mesh({
        channelId,
        token,
        iceServers,
        channelKey,
        onTrack: (peerId, slot, track) => {
          const slots = remoteTracks.get(peerId) ?? {};
          slots[slot] = track;
          remoteTracks.set(peerId, slots);
          refresh();
        },
        onPeers: (next_) => {
          peers = next_;
          for (const peerId of [...remoteTracks.keys()]) {
            if (!peers.some((peer) => peer.peerId === peerId)) remoteTracks.delete(peerId);
          }
          // Somebody who left cannot still be driving this machine.
          useShareControlStore.getState().peersChanged(peers);
          refresh();
        },
        onSpeaking: (next_) => {
          speaking = next_;
          const now = Date.now();
          for (const identity of speaking) lastSpoke.set(identity, now);
          refresh();
        },
        onData: (peer, payload) => useShareControlStore.getState().receive(peer, payload),
        onFatal: (message) => {
          if (get().channelId !== channelId) return;
          set({ error: message });
          void get().leave();
        },
      });

      mesh = next;
      await next.setMicEncoding(micEncoding(settings));
      await next.join();

      if (joinCounter !== currentJoinId) {
        next.close();
        if (mesh === next) mesh = null;
        return;
      }

      let micEnabled = true;
      let micProblem: string | null = null;
      try {
        await openMicrophone(settings);
      } catch (error) {
        micEnabled = false;
        micProblem = `Connected, but microphone did not start (${messageOf(error)}). Use the mic button to retry.`;
      }

      if (joinCounter !== currentJoinId) {
        next.close();
        if (mesh === next) mesh = null;
        return;
      }

      presenceSocket.send({ type: 'voice.join', channelId });
      // Pointers and "give me the mouse" ride the peers' data channels, so they
      // exist for exactly as long as the mesh does.
      useShareControlStore.getState().attach(next);

      set({
        error: micProblem,
        status: 'connected',
        encrypted: true,
        micEnabled,
        cameraEnabled: false,
        screenEnabled: false,
        sharedDisplayId: null,
        ...snapshot(),
      });
    } catch (error) {
      if (joinCounter !== currentJoinId) return;
      teardown();
      set({
        status: 'idle',
        channelId: null,
        error: error instanceof Error ? error.message : 'Could not join the voice channel',
      });
    }
  },

  leave: async () => {
    joinCounter++;
    const { channelId } = get();
    if (channelId) presenceSocket.send({ type: 'voice.leave', channelId });
    useShareControlStore.getState().detach();
    teardown();
    set({
      status: 'idle',
      channelId: null,
      tiles: [],
      shares: [],
      watching: null,
      micEnabled: false,
      cameraEnabled: false,
      screenEnabled: false,
      sharedDisplayId: null,
      error: null,
    });
  },

  toggleMic: async () => {
    const { micEnabled, status } = get();
    if (!mesh || status !== 'connected') return;

    try {
      if (micEnabled) {
        await closeMicrophone();
        set({ micEnabled: false, error: null, ...snapshot() });
        return;
      }
      await openMicrophone(useAudioSettings.getState().settings);
      set({ micEnabled: true, error: null, ...snapshot() });
    } catch (error) {
      set({ error: `Microphone: ${messageOf(error)}`, ...snapshot() });
    }
  },

  toggleCamera: async () => {
    const { cameraEnabled, status } = get();
    if (!mesh || status !== 'connected') return;

    try {
      if (cameraEnabled) {
        stopLocal('camera');
        await mesh.setTrack('camera', null);
        set({ cameraEnabled: false, error: null, ...snapshot() });
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0] ?? null;
      localTracks.camera = track;
      await mesh.setTrack('camera', track);
      set({ cameraEnabled: Boolean(track), error: null, ...snapshot() });
    } catch (error) {
      set({ error: `Camera: ${messageOf(error)}`, ...snapshot() });
    }
  },

  /**
   * `source` is what the user picked in the picker; passing null shares the
   * primary screen, which is what a runtime without the Electron bridge gets.
   * The main process has to be told before capture starts - see electron/main.ts.
   *
   * Sharing system audio captures the machine's whole output mix, and that mix
   * includes the call itself coming out of the speakers - so without asking for
   * anything else, a share re-broadcasts everyone in the room back at them and
   * they hear themselves. `restrictOwnAudio` is the constraint that leaves this
   * app's own output out of the capture, which is exactly the difference wanted:
   * the film's soundtrack travels, the voices in the call do not.
   *
   * Everything about how it is *encoded* lives in `share-quality.ts`, including
   * why the defaults were never going to be watchable.
   */
  shareScreen: async (source, withAudio, intent) => {
    const { status } = get();
    if (!mesh || status !== 'connected') return;

    try {
      await window.nexora?.selectScreenSource(source?.id ?? '', withAudio);
      const options = shareOptions(intent, await captureSize(source), {
        // A soundtrack only when the share is one: the processing that makes
        // speech clear is the processing that ruins music, and a shared
        // terminal's beeps are not worth stereo Opus.
        music: intent === 'motion',
      });
      if (!withAudio) options.capture.audio = false;

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: options.capture.video.width },
          height: { ideal: options.capture.video.height },
          frameRate: { ideal: options.capture.video.frameRate },
        },
        audio: options.capture.audio === false ? false : options.capture.audio,
      } as DisplayMediaStreamOptions);

      const video = stream.getVideoTracks()[0] ?? null;
      const audio = stream.getAudioTracks()[0] ?? null;
      // The encoder is told what it is looking at: a text profile keeps edges
      // sharp and drops frames, a motion one does the opposite.
      if (video) video.contentHint = options.capture.contentHint;

      localTracks.screen = video;
      localTracks.screenAudio = audio;
      await mesh.setSharePublish(options.publish);
      await mesh.setTrack('screen', video);
      await mesh.setTrack('screenAudio', audio);

      // The OS "Stop sharing" bar, and the capture ending for any other reason,
      // never touch the button in this app - so the share stayed up with a dead
      // track behind it and everyone else kept staring at the last frame.
      // Ending the capture has to mean the same thing however it was ended.
      video?.addEventListener('ended', () => void get().stopScreenShare(), { once: true });

      // Watch your own share, so you can see what the others are seeing.
      set({
        screenEnabled: Boolean(video),
        // Null for a window, and for a runtime with no source list: control of
        // a share is refused unless a whole display is on the wire.
        sharedDisplayId: source?.displayId ?? null,
        error: null,
        watching: LOCAL,
        ...snapshot(),
      });
    } catch (error) {
      set({ error: `Screen share: ${messageOf(error)}`, ...snapshot() });
    }
  },

  stopScreenShare: async () => {
    const { status, watching } = get();
    if (!mesh || status !== 'connected') return;

    try {
      stopLocal('screen');
      stopLocal('screenAudio');
      await mesh.setTrack('screen', null);
      await mesh.setTrack('screenAudio', null);
      await mesh.setSharePublish(null);
      // Control cannot outlive the share it was given over.
      useShareControlStore.getState().stop();

      set({
        screenEnabled: false,
        sharedDisplayId: null,
        error: null,
        watching: watching === LOCAL ? null : watching,
        ...snapshot(),
      });
    } catch (error) {
      set({ error: `Screen share: ${messageOf(error)}`, ...snapshot() });
    }
  },

  watch: (identity) => set({ watching: identity }),
}));

/** Re-derives the rendered view from the mesh. Cheap; called on every event. */
function refresh(): void {
  const state = useVoiceStore.getState();
  if (state.status === 'idle') return;

  const next = snapshot();
  // A share that ends takes the stage with it. Leaving `watching` pointed at
  // somebody who has stopped sharing is a black rectangle with their name on it
  // and no way out of it but leaving the call.
  const watched = state.watching;
  const stillSharing = next.shares.some((share) => share.identity === watched);
  useVoiceStore.setState(watched === null || stillSharing ? next : { ...next, watching: null });
}

function snapshot(): { tiles: VoiceTile[]; shares: VoiceShare[] } {
  const state = useVoiceStore.getState();
  const self = useAuthStore.getState().user;

  const localTile: VoiceTile = {
    identity: LOCAL,
    userId: self?.id ?? LOCAL,
    name: self?.displayName || self?.username || 'You',
    isLocal: true,
    speaking: speaking.has(LOCAL),
    micEnabled: state.micEnabled,
    videoTrack: localTracks.camera ?? null,
    // Never played back locally: hearing your own microphone is a howl.
    audioTrack: null,
    screenAudioTrack: null,
    lastSpokeAt: lastSpoke.get(LOCAL) ?? 0,
  };

  const tiles: VoiceTile[] = [
    localTile,
    ...peers.map((peer) => {
      const slots = remoteTracks.get(peer.peerId) ?? {};
      return {
        identity: peer.peerId,
        userId: peer.userId,
        name: peer.username,
        isLocal: false,
        speaking: speaking.has(peer.peerId),
        micEnabled: Boolean(slots.mic),
        videoTrack: slots.camera ?? null,
        audioTrack: slots.mic ?? null,
        screenAudioTrack: slots.screenAudio ?? null,
        lastSpokeAt: lastSpoke.get(peer.peerId) ?? 0,
      };
    }),
  ];

  const shares: VoiceShare[] = [];
  if (state.screenEnabled && localTracks.screen) {
    shares.push({
      identity: LOCAL,
      userId: localTile.userId,
      name: localTile.name,
      isLocal: true,
      track: localTracks.screen,
    });
  }
  for (const peer of peers) {
    const track = remoteTracks.get(peer.peerId)?.screen;
    if (!track) continue;
    shares.push({
      identity: peer.peerId,
      userId: peer.userId,
      name: peer.username,
      isLocal: false,
      track,
    });
  }

  return { tiles, shares };
}

/**
 * Captures the microphone, puts the gate on it, and sends the gated track.
 *
 * The gate rather than the raw capture is what goes on the wire, which is the
 * whole point of it: what the gate closes never reaches anybody.
 */
async function openMicrophone(settings: VoiceSettings): Promise<void> {
  if (!mesh) return;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: micCapture(settings) });
  const raw = stream.getAudioTracks()[0];
  if (!raw) throw new Error('That microphone handed back no audio');

  localTracks.mic = raw;
  await mesh.setMicEncoding(micEncoding(settings));
  await mesh.setTrack('mic', (await attachGate(raw, settings)) ?? raw);
}

async function closeMicrophone(): Promise<void> {
  await mesh?.setTrack('mic', null);
  await gate?.destroy().catch(() => undefined);
  gate = null;
  mesh?.setLocalSpeaking(false);
  stopLocal('mic');
}

/**
 * Puts the gate on the captured microphone and returns what should be sent.
 *
 * Never fatal: a call without a gate is the call this app had before the gate
 * existed, and losing the microphone over a failed processor would be a far
 * worse trade.
 */
async function attachGate(
  track: MediaStreamTrack,
  settings: VoiceSettings,
): Promise<MediaStreamTrack | null> {
  try {
    await gate?.destroy().catch(() => undefined);
    gate = new NoiseGate(settings.gateThresholdDb);

    gateContext ??= new AudioContext();
    await gateContext.resume().catch(() => undefined);

    // The gate already measures the level on the audio thread, so local
    // speaking is free rather than a second analyser doing the same arithmetic.
    gate.onLevel((level) => mesh?.setLocalSpeaking(level.open));
    await gate.init({ track, audioContext: gateContext });

    return gate.processedTrack ?? null;
  } catch (error) {
    gate = null;
    console.warn('[voice.ts] microphone gate not attached:', error);
    return null;
  }
}

function stopLocal(slot: Slot): void {
  localTracks[slot]?.stop();
  localTracks[slot] = null;
}

/** Ends the call's machinery without touching rendered state. */
function teardown(): void {
  void gate?.destroy().catch(() => undefined);
  gate = null;
  mesh?.close();
  mesh = null;
  for (const slot of SLOTS) stopLocal(slot);
  remoteTracks.clear();
  peers = [];
  speaking = new Set();
  lastSpoke.clear();
}

/**
 * The real pixel size of what is about to be captured.
 *
 * A screen is exactly its display. A window is whatever size it happens to be,
 * which nothing here can ask for, so it gets the biggest display as a ceiling -
 * a capture is never scaled *up* to meet one, so an over-estimate costs
 * nothing while an under-estimate is a permanently soft picture.
 */
async function captureSize(source: ScreenSource | null): Promise<ShareSize> {
  const fallback = { width: 1920, height: 1080 };
  const displays = (await window.nexora?.screenDisplays()) ?? [];
  if (displays.length === 0) return fallback;

  const exact = source?.displayId
    ? displays.find((display) => display.id === source.displayId)
    : undefined;
  if (exact) return { width: exact.width, height: exact.height };

  return displays.reduce(
    (biggest, display) =>
      display.width * display.height > biggest.width * biggest.height
        ? { width: display.width, height: display.height }
        : biggest,
    fallback,
  );
}

/**
 * Voice settings changed while a call is running.
 *
 * Three different costs, so three different paths: a threshold is a message to
 * the gate on the audio thread, the three processing switches are a constraint
 * applied to the track that is already open, and a different device or a
 * different mode is the only one that needs the microphone recaptured - the
 * bitrate and channel count are fixed when the connection is negotiated, and
 * only a new capture picks up a new device.
 */
async function applyAudioSettings(next: VoiceSettings, previous: VoiceSettings): Promise<void> {
  const { status, micEnabled } = useVoiceStore.getState();
  if (!mesh || status !== 'connected') return;

  // Output device is the sink's business, not the mesh's - see MediaSink.
  if (!micEnabled) return;

  if (next.mode !== previous.mode || next.inputDeviceId !== previous.inputDeviceId) {
    await closeMicrophone();
    await openMicrophone(next).catch(() => undefined);
    return;
  }

  if (next.gateThresholdDb !== previous.gateThresholdDb) {
    gate?.setThreshold(next.gateThresholdDb);
  }

  const track = localTracks.mic;
  if (track) await track.applyConstraints(micProcessing(next)).catch(() => undefined);
}

useAudioSettings.subscribe((state, previous) => {
  if (state.settings === previous.settings) return;
  void applyAudioSettings(state.settings, previous.settings);
});

// Taking control of a share changes what its latency should be: a pointer that
// arrives two frames late is unusable, where two frames of cushion on something
// you are only watching is invisible.
useShareControlStore.subscribe((state, previous) => {
  if (state.driving === previous.driving) return;
  mesh?.setDriving(state.driving !== null);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void useVoiceStore.getState().leave();
  });
}
