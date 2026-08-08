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
  Room,
  RoomEvent,
  Track,
  setLogLevel,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
} from 'livekit-client';
import E2eeWorker from 'livekit-client/e2ee-worker?worker';
import { api } from '../services/api';
import { callKeyForChannel } from '../services/e2ee';
import { presenceSocket } from '../services/socket';

if (import.meta.env.DEV) setLogLevel('debug');

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
  /** False when the browser/runtime refused insertable streams. */
  encrypted: boolean;
  error: string | null;

  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  shareScreen: (source: ScreenSource | null, withAudio: boolean) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  watch: (identity: string | null) => void;
}

/**
 * Identity -> when they last spoke. Kept outside the store because it is a
 * running record rather than rendered state: the grid sorts by it so whoever
 * just talked is on the first page.
 */
const lastSpoke = new Map<string, number>();

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
  encrypted: false,
  error: null,

  join: async (channelId) => {
    console.log('[voice.ts] 1. Starting join for channel:', channelId);
    if (get().channelId === channelId && get().status !== 'idle') {
      console.log('[voice.ts] Already in or connecting to channel:', channelId);
      return;
    }

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
      console.log('[voice.ts] 2. Fetching key & call token...');
      const [key, credentials] = await Promise.all([
        callKeyForChannel(channelId),
        api.callToken(channelId),
      ]);

      console.log('[voice.ts] 3. Got credentials url:', credentials.url);

      if (joinCounter !== currentJoinId) return;

      const keyProvider = new ExternalE2EEKeyProvider();
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        e2ee: { keyProvider, worker: new E2eeWorker() },
      });

      console.log('[voice.ts] 4. Setting E2EE key...');
      await keyProvider.setKey(key);

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      try {
        console.log('[voice.ts] 5. Enabling E2EE...');
        await room.setE2EEEnabled(true);
        console.log('[voice.ts] 5b. E2EE enabled successfully');
      } catch (e2eeErr) {
        console.error('[voice.ts] 5x. E2EE enable failed:', e2eeErr);
        room.disconnect().catch(() => undefined);
        throw new Error('This runtime cannot encrypt voice media, so the join was cancelled');
      }

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      const refresh = (): void => {
        if (get().room === room) {
          set(snapshot(room));
        }
      };

      room
        .on(RoomEvent.ParticipantConnected, refresh)
        .on(RoomEvent.ParticipantDisconnected, refresh)
        .on(RoomEvent.TrackSubscribed, refresh)
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
            set({
              status: 'idle',
              channelId: null,
              room: null,
              tiles: [],
              shares: [],
              watching: null,
            });
          }
        });

      console.log('[voice.ts] 6. Connecting to LiveKit room...');
      const connectPromise = room.connect(credentials.url, credentials.token);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection to voice server timed out')), 15_000),
      );

      await Promise.race([connectPromise, timeoutPromise]);
      console.log('[voice.ts] 6b. Room connected successfully!');

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      await room.startAudio().catch(() => undefined);

      let micEnabled = true;
      let micProblem: string | null = null;
      try {
        console.log('[voice.ts] 7. Enabling microphone...');
        await room.localParticipant.setMicrophoneEnabled(true);
        console.log('[voice.ts] 7b. Microphone enabled!');
      } catch (error) {
        micEnabled = false;
        const reason = error instanceof Error ? error.message : 'unknown error';
        console.warn('[voice.ts] 7x. Microphone failed to enable:', reason);
        micProblem = `Connected, but microphone did not start (${reason}). Use the mic button to retry.`;
      }

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      presenceSocket.send({ type: 'voice.join', channelId });

      console.log('[voice.ts] 8. Join complete!');
      set({
        error: micProblem,
        status: 'connected',
        room,
        encrypted: true,
        micEnabled,
        cameraEnabled: false,
        screenEnabled: false,
        ...snapshot(room),
      });
    } catch (error) {
      if (joinCounter !== currentJoinId) return;

      console.error('[voice.ts] JOIN ERROR:', error);
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
    lastSpoke.clear();
    set({
      status: 'idle',
      channelId: null,
      room: null,
      tiles: [],
      shares: [],
      watching: null,
      screenEnabled: false,
      error: null,
    });
    if (room) {
      await room.disconnect().catch(() => undefined);
    }
  },

  toggleMic: async () => {
    const { room, micEnabled, status } = get();
    if (!room || status !== 'connected') return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!micEnabled);
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
   */
  shareScreen: async (source, withAudio) => {
    const { room, status } = get();
    if (!room || status !== 'connected') return;
    try {
      await window.nexora?.selectScreenSource(source?.id ?? '', withAudio);
      await room.localParticipant.setScreenShareEnabled(true, { audio: withAudio });
      // Watch your own share, so you can see what the others are seeing.
      set({
        screenEnabled: true,
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
      const stoppedWhatWeWatched = watching === room.localParticipant.identity;
      set({
        screenEnabled: false,
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void useVoiceStore.getState().leave();
  });
}
