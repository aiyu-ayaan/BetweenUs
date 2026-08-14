/**
 * Voice-channel state: the client is connected to at most one at a time.
 *
 * Signalling and media are LiveKit's job; this store only decides when to join,
 * installs the channel key so frames are end-to-end encrypted, flattens the
 * room into tiles React can render, and tells presence-service who is in the
 * channel so other members see it without joining.
 */
import { create } from 'zustand';
import {
  ExternalE2EEKeyProvider,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from 'livekit-client';
import E2eeWorker from 'livekit-client/e2ee-worker?worker';
import { api } from '../services/api';
import { callKeyForChannel } from '../services/e2ee';
import { presenceSocket } from '../services/socket';
import { wsUrl } from '../services/endpoint';
import { useShareControlStore } from './shareControl';
import { useAudioSettings } from './audioSettings';
import { NoiseGate } from '../services/mic-gate';
import { micCapture, micProcessing, micPublish, type VoiceSettings } from '../services/voice-quality';
import {
  PLAYOUT_DELAY,
  shareOptions,
  type ShareIntent,
  type ShareSize,
} from '../services/share-quality';

export interface VoiceTile {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micEnabled: boolean;
  videoTrack: Track | null;
  audioTrack: Track | null;
  /** Audio that came with a shared screen - a film's soundtrack, usually. */
  screenAudioTrack: Track | null;
  /** Epoch ms of the last time this person was an active speaker. */
  lastSpokeAt: number;
}

/** A screen someone is sharing. Separate from their tile: both can be on. */
export interface VoiceShare {
  identity: string;
  name: string;
  isLocal: boolean;
  track: Track | null;
}

interface VoiceState {
  status: 'idle' | 'connecting' | 'connected';
  channelId: string | null;
  room: Room | null;
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
  /** False when the browser/runtime refused insertable streams. */
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
 * Identity -> when they last spoke. Kept outside the store because it is a
 * running record rather than rendered state: the grid sorts by it so whoever
 * just talked is on the first page.
 */
const lastSpoke = new Map<string, number>();

/**
 * The gate the microphone is published through, for as long as one call lasts.
 * Kept outside the store because it is a piece of audio plumbing rather than
 * rendered state: the sensitivity slider talks to it directly, which is what
 * lets a threshold change take effect without republishing the track.
 */
let gate: NoiseGate | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

let joinCounter = 0;

export const useVoiceStore = create<VoiceState>((set, get) => ({
  status: 'idle',
  channelId: null,
  room: null,
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

    const existingRoom = get().room;
    const existingChannelId = get().channelId;
    if (existingChannelId) {
      presenceSocket.send({ type: 'voice.leave', channelId: existingChannelId });
    }
    if (existingRoom) {
      void existingRoom.disconnect().catch(() => undefined);
    }

    lastSpoke.clear();
    set({
      status: 'connecting',
      channelId,
      room: null,
      error: null,
      tiles: [],
      shares: [],
      watching: null,
    });

    try {
      const [key, credentials] = await Promise.all([
        callKeyForChannel(channelId),
        api.callToken(channelId),
      ]);

      // A deployment that puts LiveKit behind its own gateway answers with a
      // path (/livekit) rather than a host, so one address covers the whole
      // deployment. Anything absolute is used as it stands.
      const livekitUrl = credentials.url.startsWith('/')
        ? `${wsUrl()}${credentials.url}`
        : credentials.url;

      if (joinCounter !== currentJoinId) return;

      const settings = useAudioSettings.getState().settings;

      const keyProvider = new ExternalE2EEKeyProvider();
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        e2ee: { keyProvider, worker: new E2eeWorker() },
        // Everything about how the microphone is captured and encoded lives in
        // `voice-quality.ts`, including why the defaults were not it. Passed at
        // every publish rather than as a room default, so a screen share's
        // soundtrack keeps its own answer.
        ...(settings.outputDeviceId ? { audioOutput: { deviceId: settings.outputDeviceId } } : {}),
      });

      await keyProvider.setKey(key);

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      try {
        await room.setE2EEEnabled(true);
      } catch (error) {
        room.disconnect().catch(() => undefined);
        // The cause carries what the runtime actually objected to - insertable
        // streams, usually - which the message above deliberately does not.
        throw new Error('This runtime cannot encrypt voice media, so the join was cancelled', {
          cause: error,
        });
      }

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      const refresh = (): void => {
        if (get().room !== room) return;
        const next = snapshot(room);
        // A share that ends takes the stage with it. Leaving `watching` pointed
        // at somebody who has stopped sharing is a black rectangle with their
        // name on it and no way out of it but leaving the call.
        const watched = get().watching;
        const stillSharing = next.shares.some((share) => share.identity === watched);
        set(watched === null || stillSharing ? next : { ...next, watching: null });
      };

      room
        .on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          tuneLatency(track);
          refresh();
        })
        .on(RoomEvent.TrackUnsubscribed, refresh)
        .on(RoomEvent.TrackMuted, refresh)
        .on(RoomEvent.TrackUnmuted, refresh)
        .on(RoomEvent.LocalTrackPublished, refresh)
        .on(RoomEvent.LocalTrackUnpublished, refresh)
        .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          const now = Date.now();
          for (const speaker of speakers) lastSpoke.set(speaker.identity, now);
          refresh();
        })
        .on(RoomEvent.Disconnected, () => {
          if (get().room === room) {
            presenceSocket.send({ type: 'voice.leave', channelId });
            useShareControlStore.getState().detach();
            gate = null;
            set({
              status: 'idle',
              channelId: null,
              room: null,
              tiles: [],
              shares: [],
              watching: null,
              screenEnabled: false,
              sharedDisplayId: null,
            });
          }
        });

      // Relays, when the deployment has any. A self-hosted SFU is reachable on
      // its own network and nowhere else, so a client on another network needs
      // somewhere both ends can meet; without this the join reaches "joined,
      // no media" and dies of the race below. `iceTransportPolicy` is
      // deliberately not set to 'relay': a direct path is better whenever there
      // is one, and on the SFU's own network there always is.
      const connectPromise = room.connect(livekitUrl, credentials.token, {
        ...(credentials.iceServers?.length ? { rtcConfig: { iceServers: credentials.iceServers } } : {}),
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection to voice server timed out')), 15_000),
      );

      await Promise.race([connectPromise, timeoutPromise]);

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      await room.startAudio().catch(() => undefined);

      let micEnabled = true;
      let micProblem: string | null = null;
      try {
        await room.localParticipant.setMicrophoneEnabled(
          true,
          micCapture(settings),
          micPublish(settings),
        );
        await attachGate(room, settings);
      } catch (error) {
        micEnabled = false;
        micProblem = `Connected, but microphone did not start (${messageOf(error)}). Use the mic button to retry.`;
      }

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      presenceSocket.send({ type: 'voice.join', channelId });
      // Pointers and "give me the mouse" ride the room's own data channel, so
      // they exist for exactly as long as the room does.
      useShareControlStore.getState().attach(room);

      set({
        error: micProblem,
        status: 'connected',
        room,
        encrypted: true,
        micEnabled,
        cameraEnabled: false,
        screenEnabled: false,
        sharedDisplayId: null,
        ...snapshot(room),
      });
    } catch (error) {
      if (joinCounter !== currentJoinId) return;

      set({
        status: 'idle',
        channelId: null,
        room: null,
        error: error instanceof Error ? error.message : 'Could not join the voice channel',
      });
    }
  },

  leave: async () => {
    joinCounter++;
    const { room, channelId } = get();
    if (channelId) presenceSocket.send({ type: 'voice.leave', channelId });
    useShareControlStore.getState().detach();
    gate = null;
    lastSpoke.clear();
    set({
      status: 'idle',
      channelId: null,
      room: null,
      tiles: [],
      shares: [],
      watching: null,
      screenEnabled: false,
      sharedDisplayId: null,
      error: null,
    });
    if (room) {
      await room.disconnect().catch(() => undefined);
    }
  },

  toggleMic: async () => {
    const { room, micEnabled, status } = get();
    if (!room || status !== 'connected') return;
    const settings = useAudioSettings.getState().settings;
    try {
      await room.localParticipant.setMicrophoneEnabled(
        !micEnabled,
        micCapture(settings),
        micPublish(settings),
      );
      if (!micEnabled) await attachGate(room, settings);
      set({ micEnabled: !micEnabled, error: null, ...snapshot(room) });
    } catch (error) {
      set({ error: `Microphone: ${messageOf(error)}`, ...snapshot(room) });
    }
  },

  toggleCamera: async () => {
    const { room, cameraEnabled, status } = get();
    if (!room || status !== 'connected') return;
    try {
      await room.localParticipant.setCameraEnabled(!cameraEnabled);
      set({ cameraEnabled: !cameraEnabled, error: null, ...snapshot(room) });
    } catch (error) {
      set({ error: `Camera: ${messageOf(error)}`, ...snapshot(room) });
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
    const { room, status } = get();
    if (!room || status !== 'connected') return;
    try {
      await window.nexora?.selectScreenSource(source?.id ?? '', withAudio);
      const options = shareOptions(intent, await captureSize(source), {
        // A soundtrack only when the share is one: the processing that makes
        // speech clear is the processing that ruins music, and a shared
        // terminal's beeps are not worth stereo Opus.
        music: intent === 'motion',
      });
      if (!withAudio) options.capture.audio = false;
      await room.localParticipant.setScreenShareEnabled(true, options.capture, options.publish);

      // The browser's own "Stop sharing" bar, and the Windows capture ending
      // for any other reason, never touch the button in this app - so the
      // publication stayed up with a dead track behind it and everyone else
      // kept staring at the last frame. Ending the capture has to mean the same
      // thing however it was ended.
      const published = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
      published?.mediaStreamTrack.addEventListener(
        'ended',
        () => {
          void get().stopScreenShare();
        },
        { once: true },
      );

      // Watch your own share, so you can see what the others are seeing.
      set({
        screenEnabled: true,
        // Null for a window, and for a runtime with no source list: control of
        // a share is refused unless a whole display is on the wire.
        sharedDisplayId: source?.displayId ?? null,
        error: null,
        watching: room.localParticipant.identity,
        ...snapshot(room),
      });
    } catch (error) {
      set({ error: `Screen share: ${messageOf(error)}`, ...snapshot(room) });
    }
  },

  stopScreenShare: async () => {
    const { room, status, watching } = get();
    if (!room || status !== 'connected') return;
    try {
      await room.localParticipant.setScreenShareEnabled(false);
      // Control cannot outlive the share it was given over.
      useShareControlStore.getState().stop();
      const stoppedWhatWeWatched = watching === room.localParticipant.identity;
      set({
        screenEnabled: false,
        sharedDisplayId: null,
        error: null,
        watching: stoppedWhatWeWatched ? null : watching,
        ...snapshot(room),
      });
    } catch (error) {
      set({ error: `Screen share: ${messageOf(error)}`, ...snapshot(room) });
    }
  },

  watch: (identity) => set({ watching: identity }),
}));

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
 * Asks the receiver to stop hoarding frames.
 *
 * A jitter buffer left to itself is a third of a second of latency, most of it
 * spent guarding against network conditions this link does not have. Whoever is
 * driving gets none of it; whoever is watching gets a couple of frames, which
 * absorbs ordinary jitter without anybody noticing.
 */
function tuneLatency(track: RemoteTrack): void {
  const driving = useShareControlStore.getState().driving !== null;
  track.setPlayoutDelay(driving ? PLAYOUT_DELAY.driving : PLAYOUT_DELAY.watching);
}

function snapshot(room: Room): { tiles: VoiceTile[]; shares: VoiceShare[] } {
  const speaking = new Set(room.activeSpeakers.map((participant) => participant.identity));
  const participants: Array<LocalParticipant | RemoteParticipant> = [
    room.localParticipant,
    ...room.remoteParticipants.values(),
  ];

  const tiles = participants.map((participant) =>
    toTile(participant, speaking.has(participant.identity)),
  );

  const shares = participants.flatMap((participant) => {
    const screen = participant.getTrackPublication(Track.Source.ScreenShare);
    if (!screen) return [];
    return [
      {
        identity: participant.identity,
        name: participant.name || participant.identity,
        isLocal: participant.isLocal,
        track: screen.track ?? null,
      },
    ];
  });

  return { tiles, shares };
}

function toTile(participant: Participant, speaking: boolean): VoiceTile {
  const camera = participant.getTrackPublication(Track.Source.Camera);
  const mic = participant.getTrackPublication(Track.Source.Microphone);
  const screenAudio = participant.getTrackPublication(Track.Source.ScreenShareAudio);

  if (speaking) lastSpoke.set(participant.identity, Date.now());

  return {
    identity: participant.identity,
    name: participant.name || participant.identity,
    isLocal: participant.isLocal,
    speaking,
    micEnabled: Boolean(mic && !mic.isMuted),
    videoTrack: camera?.isMuted ? null : (camera?.track ?? null),
    audioTrack: participant.isLocal ? null : (mic?.track ?? null),
    screenAudioTrack: participant.isLocal ? null : (screenAudio?.track ?? null),
    lastSpokeAt: lastSpoke.get(participant.identity) ?? 0,
  };
}

/**
 * The gate's own audio context, one per window.
 *
 * LiveKit will not attach a processor to a track that has no audio context, and
 * the one it acquires for the room is not on the track yet at the moment a
 * processor passed in the capture options would be applied - which is why the
 * gate is attached after the track is published rather than with it. Ours is
 * created on the first join, which is a click, so it is never blocked by
 * autoplay policy.
 */
let gateContext: AudioContext | null = null;

/**
 * Puts the gate on the published microphone, takes it off, or retunes it.
 *
 * Never fatal: a call without a gate is the call this app had last week, and
 * losing the microphone over a failed processor would be a far worse trade.
 */
async function attachGate(room: Room, settings: VoiceSettings): Promise<void> {
  const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  if (!(track instanceof LocalAudioTrack)) return;

  try {
    if (settings.gateThresholdDb === null) {
      if (gate) {
        gate = null;
        await track.stopProcessor();
      }
      return;
    }

    if (gate) {
      gate.setThreshold(settings.gateThresholdDb);
      return;
    }

    gateContext ??= new AudioContext();
    await gateContext.resume().catch(() => undefined);
    track.setAudioContext(gateContext);

    gate = new NoiseGate(settings.gateThresholdDb);
    await track.setProcessor(gate);
  } catch (error) {
    gate = null;
    console.warn('[voice.ts] microphone gate not attached:', error);
  }
}

/**
 * Voice settings changed while a call is running.
 *
 * Three different costs, so three different paths: a threshold is a message to
 * the gate on the audio thread, the three processing switches are a constraint
 * applied to the track that is already open, and a different device or a
 * different mode is the only one that needs the track republished - the bitrate
 * and channel count are fixed when it is published, and nothing can change them
 * in place.
 */
async function applyAudioSettings(next: VoiceSettings, previous: VoiceSettings): Promise<void> {
  const { room, status, micEnabled } = useVoiceStore.getState();
  if (!room || status !== 'connected') return;

  if (next.outputDeviceId !== previous.outputDeviceId) {
    await room
      .switchActiveDevice('audiooutput', next.outputDeviceId ?? 'default')
      .catch(() => undefined);
  }

  if (!micEnabled) return;

  if (next.mode !== previous.mode || next.inputDeviceId !== previous.inputDeviceId) {
    // A republished track is a new track, so the gate has to be put back on it.
    gate = null;
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
    await room.localParticipant
      .setMicrophoneEnabled(true, micCapture(next), micPublish(next))
      .catch(() => undefined);
    await attachGate(room, next);
    return;
  }

  const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  if (track instanceof LocalAudioTrack) {
    await track.applyConstraints(micProcessing(next)).catch(() => undefined);
  }
  await attachGate(room, next);
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
  const room = useVoiceStore.getState().room;
  if (!room) return;
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.track && !publication.track.isLocal) {
        tuneLatency(publication.track as RemoteTrack);
      }
    }
  }
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void useVoiceStore.getState().leave();
  });
}
