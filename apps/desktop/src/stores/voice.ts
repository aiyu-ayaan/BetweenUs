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
import type { CallPeer } from '@betweenus/shared-types';
import { api } from '../services/api';
import { callKeyForChannel } from '../services/e2ee';
import { Mesh, SLOTS, type Slot } from '../services/mesh';
import { presenceSocket } from '../services/socket';
import { isDesktopRuntime } from '../services/platform';
import { useAuthStore } from './auth';
import { useChatStore } from './chat';
import { useShareControlStore } from './shareControl';
import { useAudioSettings } from './audioSettings';
import { startPushToTalk, stopPushToTalk } from '../services/push-to-talk';
import { notBeingHeard, type LinkStats } from '../services/call-stats';
import { visibleVideo } from '../services/media-presence';
import { NoiseGate } from '../services/mic-gate';
import { captureIsStale, chosenIsMissing, realDevices } from '../services/audio-devices';
import { playCallTone, rosterChange, setToneOutput } from '../services/call-tones';
import { micCapture, micEncoding, micProcessing, type VoiceSettings } from '../services/voice-quality';
import { shareOptions, type ShareIntent, type ShareSize } from '../services/share-quality';

/** The local participant's own key in every map here. */
export const LOCAL = 'local';

/** Application state sent over each encrypted peer data channel. */
const VOICE_STATE_TOPIC = 'betweenus.voice-state';
type MediaState = Record<Slot, boolean>;

interface MediaStateEnvelope {
  topic: typeof VOICE_STATE_TOPIC;
  media: MediaState;
}

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
  /**
   * When the call became a call, as a wall clock, for the duration on screen.
   *
   * The phone has shown this from the beginning and neither of the other two
   * clients did - not by choice: on Android an ongoing-call notification counts
   * itself, and a window or a tab has no notification to hang that on. So the
   * moment is recorded here and the clock is drawn.
   *
   * Set when the mesh comes up rather than when the join was asked for, because
   * a call that took four seconds to connect did not last four seconds longer
   * than it did.
   */
  connectedAt: number | null;
  channelId: string | null;
  /**
   * Where the call is, remembered rather than looked up.
   *
   * The call outlives the screen it was started from: switching servers throws
   * away `chat.channels`, so by the time the dock renders there is nothing left
   * to find the name in. Recording both at join is what lets the dock say where
   * you are and take you back to it.
   */
  channelName: string | null;
  callServerId: string | null;
  tiles: VoiceTile[];
  shares: VoiceShare[];
  /** Identity whose shared screen fills the stage, or null for the grid. */
  watching: string | null;
  micEnabled: boolean;
  /**
   * Push to talk: whether the key is down right now.
   *
   * Kept apart from `micEnabled`, which is the button and means "I intend to be
   * heard in this call at all". A muted microphone stays muted however long the
   * key is held, and letting the key go does not mute anybody.
   */
  talking: boolean;
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
  /**
   * Per-peer measurements, and a warning when they say something is wrong.
   *
   * Sampled for as long as the call lasts rather than only while a panel is
   * open, because the warning this exists for - a microphone sending nothing -
   * has to reach somebody who has no reason to go looking at statistics. Two
   * seconds, alongside the video poll the mesh already runs.
   */
  stats: LinkStats[];
  /** Set when this client is sending no audio while believing it is. */
  notHeard: boolean;
  /**
   * Who the call says is sharing their screen, or null for nobody.
   *
   * One share at a time, decided by the gateway. Kept even though the tiles
   * already carry a screen track each, because this is the *authority* and they
   * are the consequence: a peer that has taken over is holding it a moment
   * before its first frame arrives, and the button has to say so immediately.
   */
  screenHolder: string | null;

  join: (channelId: string) => Promise<void>;
  /**
   * `reason` is what ended the call when it was not the user: the mesh dying,
   * or this account joining the same call from another device. It survives the
   * hang-up so the client can say why the call went away, where clearing it
   * unconditionally left the message on screen for a few milliseconds.
   */
  leave: (reason?: string) => Promise<void>;
  toggleMic: () => Promise<void>;
  /** The push-to-talk key going down or coming up. */
  setTalking: (talking: boolean) => void;
  toggleCamera: () => Promise<void>;
  shareScreen: (
    source: ScreenSource | null,
    withAudio: boolean,
    intent: ShareIntent,
  ) => Promise<void>;
  /** `replaced` is set when somebody else took the screen, not the user. */
  stopScreenShare: (replaced?: boolean) => Promise<void>;
  watch: (identity: string | null) => void;
  /** Opens the channel the call is in, from wherever the client has wandered. */
  openCallChannel: () => Promise<void>;
}

/**
 * The live call. Outside the store because it is machinery rather than rendered
 * state, and because React must never re-render on a peer-connection event.
 */
let mesh: Mesh | null = null;

/** peerId -> what has arrived from them, by slot. */
const remoteTracks = new Map<string, Partial<Record<Slot, MediaStreamTrack | null>>>();
/** peerId -> the media switches the remote participant intentionally enabled. */
const remoteMediaStates = new Map<string, MediaState>();
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
  connectedAt: null,
  channelId: null,
  channelName: null,
  callServerId: null,
  tiles: [],
  shares: [],
  watching: null,
  micEnabled: false,
  talking: false,
  cameraEnabled: false,
  screenEnabled: false,
  sharedDisplayId: null,
  encrypted: false,
  error: null,
  stats: [],
  notHeard: false,
  screenHolder: null,

  join: async (channelId) => {
    if (get().channelId === channelId && get().status !== 'idle') return;

    const currentJoinId = ++joinCounter;

    const previousChannelId = get().channelId;
    if (previousChannelId) presenceSocket.send({ type: 'voice.leave', channelId: previousChannelId });
    teardown();

    const channel = useChatStore.getState().channels.find((item) => item.id === channelId);

    set({
      status: 'connecting',
      channelId,
      channelName: channel?.name ?? null,
      callServerId: channel?.serverId ?? useChatStore.getState().activeServerId,
      error: null,
      tiles: [],
      shares: [],
      watching: null,
      screenHolder: null,
    });

    try {
      const token = useAuthStore.getState().accessToken;
      if (!token) throw new Error('Not signed in');

      // The key is the channel's own, and it never leaves this machine: it is
      // used here only to sign this client's DTLS fingerprint, so the
      // signalling server cannot substitute one of its own and stand in the
      // middle. See mesh.ts.
      // Read here as well as per-link, so a channel this device holds no key
      // for fails the join outright instead of failing every peer in it. And
      // read *fresh*: a cached epoch is the one this client held when it last
      // opened the channel, and joining a call under a key everybody else has
      // already rotated past is the whole "their media key does not match"
      // failure, from the other side.
      const [, { iceServers }] = await Promise.all([
        callKeyForChannel(channelId, true),
        api.callIce(channelId),
      ]);

      if (joinCounter !== currentJoinId) return;

      const settings = useAudioSettings.getState().settings;

      const next = new Mesh({
        channelId,
        token,
        iceServers,
        // Re-read when the roster changes rather than snapshotted: see
        // `Mesh.channelKey`.
        channelKey: (refresh) => callKeyForChannel(channelId, refresh),
        onTrack: (peerId, slot, track) => {
          const slots = remoteTracks.get(peerId) ?? {};
          slots[slot] = track;
          remoteTracks.set(peerId, slots);
          refresh();
        },
        onPeers: (next_) => {
          // Before the list is replaced, and only once the call is up: the
          // roster that arrives on the way in is everybody already there, and
          // announcing them one by one is a fanfare nobody asked for.
          if (useVoiceStore.getState().status === 'connected') {
            const change = rosterChange(
              peers.map((peer) => peer.peerId),
              next_.map((peer) => peer.peerId),
            );
            if (change.joined) tone('join');
            if (change.left) tone('leave');
          }
          peers = next_;
          for (const peerId of [...remoteTracks.keys()]) {
            if (!peers.some((peer) => peer.peerId === peerId)) remoteTracks.delete(peerId);
          }
          for (const peerId of [...remoteMediaStates.keys()]) {
            if (!peers.some((peer) => peer.peerId === peerId)) remoteMediaStates.delete(peerId);
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
        onData: (peer, payload) => {
          if (!receiveMediaState(peer, payload)) {
            useShareControlStore.getState().receive(peer, payload);
          }
        },
        onDataOpen: (peer) => publishMediaState([peer.peerId]),
        onProblem: (message) => {
          if (useVoiceStore.getState().channelId !== channelId) return;
          useVoiceStore.setState({ error: message });
        },
        onFatal: (message) => {
          if (get().channelId !== channelId) return;
          void get().leave(message);
        },
        onScreenHolder: (peerId) => {
          if (useVoiceStore.getState().channelId !== channelId) return;
          set({ screenHolder: peerId });

          // Somebody else took it. Teams does this and it is the right way
          // round: the person who just pressed the button gets what they asked
          // for, and the previous share stops rather than the two of them
          // fighting over one stage. The capture is torn down here rather than
          // left running muted - a screen that is still being captured is still
          // a privacy question, whatever is being done with the frames.
          const local = useVoiceStore.getState();
          if (local.screenEnabled && peerId !== null && peerId !== mesh?.peerId()) {
            void get()
              .stopScreenShare(true)
              .then(() =>
                useVoiceStore.setState({
                  error: 'Somebody else started sharing, so your share stopped.',
                }),
              );
          }
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
      // Only while there is a call to talk into: a key that silences a
      // microphone nobody is listening to is a key that does nothing, and one
      // listened for all day is a listener for nothing.
      startPushToTalk();
      startStatsPoll();
      // Pointers and "give me the mouse" ride the peers' data channels, so they
      // exist for exactly as long as the mesh does.
      useShareControlStore.getState().attach(next);

      set({
        error: micProblem,
        status: 'connected',
        connectedAt: Date.now(),
        encrypted: true,
        micEnabled,
        cameraEnabled: false,
        screenEnabled: false,
        sharedDisplayId: null,
      });
      publishMediaState();
      refresh();
      // Your own arrival, the way Discord marks it: the confirmation that the
      // channel is live is the same sound everyone else in it just heard.
      tone('join');
    } catch (error) {
      if (joinCounter !== currentJoinId) return;
      teardown();
      set({
        status: 'idle',
        connectedAt: null,
        channelId: null,
        channelName: null,
        callServerId: null,
        error: error instanceof Error ? error.message : 'Could not join the voice channel',
      });
    }
  },

  leave: async (reason) => {
    // Only for a call that was actually up: leaving one that never connected
    // has nothing to say goodbye to.
    if (get().status === 'connected') tone('leave');
    joinCounter++;
    stopPushToTalk();
    stopStatsPoll();
    const { channelId } = get();
    if (channelId) presenceSocket.send({ type: 'voice.leave', channelId });
    useShareControlStore.getState().detach();
    teardown();
    // Close PiP overlay window if open
    void window.betweenus?.closePip();
    set({
      status: 'idle',
      connectedAt: null,
      channelId: null,
      channelName: null,
      callServerId: null,
      tiles: [],
      shares: [],
      watching: null,
      micEnabled: false,
      talking: false,
      cameraEnabled: false,
      screenEnabled: false,
      sharedDisplayId: null,
      screenHolder: null,
      error: reason ?? null,
    });
  },

  toggleMic: async () => {
    const { micEnabled, status } = get();
    if (!mesh || status !== 'connected') return;

    try {
      if (micEnabled) {
        await closeMicrophone();
        set({ micEnabled: false, error: null });
        publishMediaState();
        refresh();
        return;
      }
      await openMicrophone(useAudioSettings.getState().settings);
      set({ micEnabled: true, error: null });
      publishMediaState();
      refresh();
    } catch (error) {
      set({ error: `Microphone: ${messageOf(error)}` });
      refresh();
    }
  },

  /**
   * Opens or closes the captured microphone without republishing anything.
   *
   * `enabled` on the raw capture rather than a track swap: the gate downstream
   * of it keeps running and keeps its worklet, so a key held for a syllable
   * costs nothing and letting go is silent within a block. Republishing per
   * keypress would renegotiate the call several times a sentence.
   */
  setTalking: (talking) => {
    if (get().talking === talking) return;
    set({ talking });
    applyTalking();
  },

  toggleCamera: async () => {
    const { cameraEnabled, status } = get();
    if (!mesh || status !== 'connected') return;

    try {
      if (cameraEnabled) {
        stopLocal('camera');
        await mesh.setTrack('camera', null);
        set({ cameraEnabled: false, error: null });
        publishMediaState();
        refresh();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = stream.getVideoTracks()[0] ?? null;
      localTracks.camera = track;
      await mesh.setTrack('camera', track);
      set({ cameraEnabled: Boolean(track), error: null });
      publishMediaState();
      refresh();
    } catch (error) {
      set({ error: `Camera: ${messageOf(error)}` });
      refresh();
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

    // Claimed before the picker's answer is turned into a capture, so the
    // person already sharing stops while this one is still starting. Claiming
    // afterwards would mean a moment with two live captures, which is the
    // moment somebody's private window is on somebody else's screen.
    mesh.claimScreen();

    try {
      await window.betweenus?.selectScreenSource(source?.id ?? '', withAudio);
      const options = shareOptions(
        intent,
        await captureSize(source),
        {
          // A soundtrack only when the share is one: the processing that makes
          // speech clear is the processing that ruins music, and a shared
          // terminal's beeps are not worth stereo Opus.
          music: intent === 'motion',
        },
        useAudioSettings.getState().settings.share,
      );
      if (!withAudio) options.capture.audio = false;

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: options.capture.video.width, max: Math.max(3840, options.capture.video.width) },
          height: { ideal: options.capture.video.height, max: Math.max(2160, options.capture.video.height) },
          frameRate: { ideal: options.capture.video.frameRate, max: 60 },
        },
        audio: options.capture.audio === false ? false : options.capture.audio,
      } as DisplayMediaStreamOptions);

      const video = stream.getVideoTracks()[0] ?? null;
      const audio = stream.getAudioTracks()[0] ?? null;
      // The encoder is told what it is looking at: a text profile keeps edges
      // sharp and drops frames, a motion one does the opposite.
      if (video) {
        video.contentHint = options.capture.contentHint;
        const settings = video.getSettings();
        if (settings.width && settings.height) {
          const realOptions = shareOptions(
            intent,
            { width: settings.width, height: settings.height },
            { music: intent === 'motion' },
            useAudioSettings.getState().settings.share,
          );
          options.publish = realOptions.publish;
        }
      }

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
      });
      publishMediaState();
      refresh();
    } catch (error) {
      set({ error: `Screen share: ${messageOf(error)}` });
      refresh();
    }
  },

  stopScreenShare: async (replaced = false) => {
    const { status, watching } = get();
    if (!mesh || status !== 'connected') return;

    // Releasing a claim somebody else already took would take the screen away
    // from them, so a share that stopped *because* it was replaced says
    // nothing. The gateway ignores it either way; not sending it keeps the two
    // ends telling the same story.
    if (!replaced) mesh.releaseScreen();

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
      });
      publishMediaState();
      refresh();
    } catch (error) {
      set({ error: `Screen share: ${messageOf(error)}` });
      refresh();
    }
  },

  watch: (identity) => set({ watching: identity }),

  openCallChannel: async () => {
    const { channelId, callServerId } = get();
    if (!channelId) return;

    const chat = useChatStore.getState();
    // The channel list is per server, so getting back to a call started on
    // another one means loading that server first - which is also what puts the
    // voice channel back in `channels`, where `selectChannel` looks for it.
    // `view` is in the condition because the home screen covers the server one:
    // being on the right server is not enough if the client is looking at a
    // direct message.
    if (callServerId && (chat.activeServerId !== callServerId || chat.view !== 'server')) {
      await chat.selectServer(callServerId);
    }
    await useChatStore.getState().selectChannel(channelId);
  },
}));

/** One tone, unless this machine has turned them off. */
function tone(which: 'join' | 'leave'): void {
  const settings = useAudioSettings.getState().settings;
  if (!settings.callTones) return;
  setToneOutput(settings.outputDeviceId);
  playCallTone(which);
}

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
    speaking: Boolean(state.micEnabled && speaking.has(LOCAL)),
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
      const media = remoteMediaStates.get(peer.peerId);
      const micEnabled = media?.mic ?? Boolean(slots.mic);
      // A camera that has stopped is taken down by its owner saying so, never
      // by frames stopping - see `media-presence.ts`.
      const camera = visibleVideo(media?.camera, slots.camera ?? null);
      return {
        identity: peer.peerId,
        userId: peer.userId,
        name: peer.username,
        isLocal: false,
        speaking: Boolean(micEnabled && speaking.has(peer.peerId)),
        // Track mute means packets are not arriving right now; it does not
        // reliably mean the participant pressed their microphone button.
        micEnabled,
        videoTrack: camera,
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
    // Whether they are still sharing is what they say, not whether a frame
    // arrived this second. A still screen decodes nothing for minutes, and
    // reading that as the end is what closed the stage under a viewer and
    // offered them the share again.
    const track = visibleVideo(
      remoteMediaStates.get(peer.peerId)?.screen,
      remoteTracks.get(peer.peerId)?.screen ?? null,
    );
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

function currentMediaState(): MediaState {
  const { micEnabled, cameraEnabled, screenEnabled } = useVoiceStore.getState();
  return {
    mic: micEnabled,
    camera: cameraEnabled,
    screen: screenEnabled,
    screenAudio: screenEnabled && Boolean(localTracks.screenAudio),
  };
}

function publishMediaState(to?: string[]): void {
  mesh?.sendData({ topic: VOICE_STATE_TOPIC, media: currentMediaState() } satisfies MediaStateEnvelope, to);
}

/** Returns true when the payload belongs to this store, even if malformed. */
function receiveMediaState(peer: CallPeer, payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;

  const envelope = payload as { topic?: unknown; media?: unknown };
  if (envelope.topic !== VOICE_STATE_TOPIC) return false;
  if (typeof envelope.media !== 'object' || envelope.media === null) return true;

  const media = envelope.media as Partial<Record<Slot, unknown>>;
  if (!SLOTS.every((slot) => typeof media[slot] === 'boolean')) return true;

  remoteMediaStates.set(peer.peerId, {
    mic: media.mic === true,
    camera: media.camera === true,
    screen: media.screen === true,
    screenAudio: media.screenAudio === true,
  });
  refresh();
  return true;
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
  // A microphone opened while push to talk is on starts closed, which is what
  // push to talk means. Opening it live for the instant between capture and the
  // first key press is the bug this line exists to prevent.
  applyTalking();
}

/**
 * Whether the microphone should be passing audio right now.
 *
 * Two conditions, and they are different questions: the button says whether
 * this client means to be heard in the call at all, and push to talk says
 * whether the key is down at this instant. An open mic (push to talk off) is
 * the first alone.
 */
function shouldPassAudio(): boolean {
  const { micEnabled, talking } = useVoiceStore.getState();
  if (!micEnabled) return false;
  return useAudioSettings.getState().settings.pushToTalk ? talking : true;
}

/**
 * Applies that to the capture, and to what everyone else sees.
 *
 * The raw track is the one switched, not the gate's output: the gate keeps
 * running either way, so nothing is renegotiated and nothing has to be rebuilt
 * when the key comes back down. The speaking ring is cleared in the same
 * breath, or a released key leaves the last "talking" state on screen.
 */
function applyTalking(): void {
  const raw = localTracks.mic;
  const pass = shouldPassAudio();
  if (raw) raw.enabled = pass;
  if (!pass) mesh?.setLocalSpeaking(false);
  refresh();
}

// --- Statistics --------------------------------------------------------------

let statsTimer: number | null = null;
/** Consecutive samples that carried no outbound audio at all. */
let quietSamples = 0;

/**
 * Every two seconds: often enough that a number on screen feels live and that a
 * dead microphone is noticed inside ten, slow enough that the difference
 * between two samples is a rate rather than noise.
 */
const STATS_POLL_MS = 2_000;

function startStatsPoll(): void {
  if (statsTimer !== null) return;
  quietSamples = 0;

  const tick = (): void => {
    const current = mesh;
    if (!current) return;
    void current.stats().then((stats) => {
      // The mesh may have gone while the sample was in flight; writing then
      // would leave numbers from a call that has ended on screen.
      if (mesh !== current) return;

      const intendsToSend = shouldPassAudio();
      quietSamples = stats.some((link) => link.sendingAudio) ? 0 : quietSamples + 1;
      useVoiceStore.setState({
        stats,
        notHeard: notBeingHeard(intendsToSend, stats, quietSamples),
      });
    });
  };

  statsTimer = window.setInterval(tick, STATS_POLL_MS);
  tick();
}

function stopStatsPoll(): void {
  if (statsTimer !== null) window.clearInterval(statsTimer);
  statsTimer = null;
  quietSamples = 0;
  useVoiceStore.setState({ stats: [], notHeard: false });
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
  const track = localTracks[slot];
  localTracks[slot] = null;
  track?.stop();
  // Every path out of a share comes through here - the button, the OS bar, and
  // leaving the call - so this is the one place that can tell the main process
  // the desktop no longer has to be held in composed flip for it.
  if (slot === 'screen' && track) void window.betweenus?.releaseScreenCapture();
}

/** Ends the call's machinery without touching rendered state. */
function teardown(): void {
  void gate?.destroy().catch(() => undefined);
  gate = null;
  mesh?.close();
  mesh = null;
  for (const slot of SLOTS) stopLocal(slot);
  remoteTracks.clear();
  remoteMediaStates.clear();
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
  const screenWidth = typeof window !== 'undefined' && window.screen ? window.screen.width : 1920;
  const screenHeight = typeof window !== 'undefined' && window.screen ? window.screen.height : 1080;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
  const fallback = {
    width: Math.max(1920, Math.round(screenWidth * dpr)),
    height: Math.max(1080, Math.round(screenHeight * dpr)),
  };
  const displays = (await window.betweenus?.screenDisplays()) ?? [];
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

  // Turning push to talk off has to reopen the microphone there and then.
  // Without this it stays shut until the next time the key is pressed, which
  // is a setting that appears not to work.
  if (next.pushToTalk !== previous.pushToTalk) applyTalking();

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

/**
 * The hardware changed under a live call.
 *
 * Nothing used to happen here, and that is the whole of "it keeps picking the
 * wrong microphone": a capture is bound to a device when it opens, so plugging
 * in a headset moved the operating system's default and left this call on the
 * webcam it started with. Unplugging and plugging the *chosen* device back in
 * was worse - the capture had already fallen back and never came home.
 *
 * `captureIsStale` decides; the debounce is because one headset arriving is
 * several `devicechange` events as its microphone, its speakers and its
 * grouping are registered one after another.
 */
const DEVICE_SETTLE_MS = 400;
let deviceSettleTimer: number | null = null;

/**
 * Lets go of a pinned device once that device is actually gone.
 *
 * A device id is remembered forever; the operating system's default is not.
 * Choose a headset once and every later call is pinned to it, so the call after
 * the headset is put away opens a microphone that is in a drawer. With
 * `followSystemDevices` on, the pin is dropped when the pinned device is no
 * longer connected and the system default wins.
 *
 * *That device*, and not merely "the hardware changed", which is what this used
 * to test and is the whole of "I have to pick my microphone again every time".
 * A device change is not a signal about the chosen device: a webcam arriving, a
 * monitor with speakers waking, a headset pairing - and, on the first call of
 * every session, the microphone permission being granted, which turns the
 * pre-permission placeholder list into the real one and is itself a
 * `devicechange`. Every one of those used to throw away a perfectly good
 * choice and fall back to a system default that, on the machine where the
 * system default is the wrong microphone, is silence.
 *
 * Dropping the pin is all this does: the settings subscription below recaptures
 * the microphone, and `MediaSink` re-points the speakers, both because the
 * setting changed. It runs whether or not a call is up, so the choice is
 * already right when the next one starts.
 */
function unpinDevices(devices: MediaDeviceInfo[]): void {
  const { settings, update } = useAudioSettings.getState();
  if (!settings.followSystemDevices) return;

  const patch: Partial<VoiceSettings> = {};
  if (chosenIsMissing(devices, 'audioinput', settings.inputDeviceId)) patch.inputDeviceId = null;
  if (chosenIsMissing(devices, 'audiooutput', settings.outputDeviceId)) patch.outputDeviceId = null;
  if (Object.keys(patch).length === 0) return;

  update(patch);
}

async function followDeviceChange(devices: MediaDeviceInfo[]): Promise<void> {
  const { status, micEnabled } = useVoiceStore.getState();
  if (!mesh || status !== 'connected' || !micEnabled) return;

  const settings = useAudioSettings.getState().settings;
  const captured = localTracks.mic?.getSettings().deviceId ?? null;
  if (!captureIsStale(settings.inputDeviceId, captured, devices)) return;

  await closeMicrophone();
  await openMicrophone(settings).catch(() => undefined);
}

if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (deviceSettleTimer !== null) window.clearTimeout(deviceSettleTimer);
    deviceSettleTimer = window.setTimeout(() => {
      deviceSettleTimer = null;
      void (async () => {
        // Enumerated once here rather than read from the shared list: that list
        // is refreshed by the same event and may not have answered yet. Both
        // decisions below need it, and they have to agree about what is
        // plugged in.
        const devices = realDevices(
          await navigator.mediaDevices.enumerateDevices().catch(() => []),
        );
        // Before the recapture, so the recapture picks up the new choice rather
        // than reopening the device that has just been unplugged.
        unpinDevices(devices);
        await followDeviceChange(devices);
      })();
    }, DEVICE_SETTLE_MS);
  });
}

// Taking control of a share changes what its latency should be: a pointer that
// arrives two frames late is unusable, where two frames of cushion on something
// you are only watching is invisible.
useShareControlStore.subscribe((state, previous) => {
  if (state.driving === previous.driving) return;
  mesh?.setDriving(state.driving !== null);
});

/**
 * In a browser, closing the tab or reloading it ends the call outright - the
 * peer connections go with the page, and there is no undo. So the web client
 * asks the browser to confirm first, and only while a call is up.
 *
 * Desktop is not in this: an Electron window that closes has a tray icon and a
 * main process behind it, and the prompt would be a nuisance rather than a
 * rescue. `isDesktopRuntime` is the same runtime split the rest of the client
 * uses - see services/platform.ts.
 *
 * The browser writes the wording. All a page may do is ask for the prompt;
 * anything it puts in `returnValue` is ignored by every current browser.
 */
function warnBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = '';
}

if (typeof window !== 'undefined' && !isDesktopRuntime()) {
  useVoiceStore.subscribe((state, previous) => {
    const inCall = state.status !== 'idle';
    if (inCall === (previous.status !== 'idle')) return;
    // Registered only for the length of the call: an unconditional handler
    // makes every reload of the app a confirmation dialog.
    if (inCall) window.addEventListener('beforeunload', warnBeforeUnload);
    else window.removeEventListener('beforeunload', warnBeforeUnload);
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void useVoiceStore.getState().leave();
  });
}
