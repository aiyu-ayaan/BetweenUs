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

// LiveKit's own diagnostics land in the terminal through the main process, so a
// failed publish says why instead of just "negotiation timed out".
if (import.meta.env.DEV) setLogLevel('debug');

export interface VoiceTile {
  identity: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micEnabled: boolean;
  videoTrack: Track | null;
  screenTrack: Track | null;
  audioTrack: Track | null;
}

interface VoiceState {
  status: 'idle' | 'connecting' | 'connected';
  channelId: string | null;
  room: Room | null;
  tiles: VoiceTile[];
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
  toggleScreen: () => Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

let joinCounter = 0;

export const useVoiceStore = create<VoiceState>((set, get) => ({
  status: 'idle',
  channelId: null,
  room: null,
  tiles: [],
  micEnabled: false,
  cameraEnabled: false,
  screenEnabled: false,
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

    set({ status: 'connecting', channelId, room: null, error: null, tiles: [] });

    try {
      const [key, credentials] = await Promise.all([
        callKeyForChannel(channelId),
        api.callToken(channelId),
      ]);

      if (joinCounter !== currentJoinId) return;

      const keyProvider = new ExternalE2EEKeyProvider();
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        e2ee: { keyProvider, worker: new E2eeWorker() },
      });

      await keyProvider.setKey(key);

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      try {
        await room.setE2EEEnabled(true);
      } catch {
        room.disconnect().catch(() => undefined);
        throw new Error('This runtime cannot encrypt voice media, so the join was cancelled');
      }

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      const refresh = (): void => {
        if (get().room === room) {
          set({ tiles: snapshot(room) });
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
        .on(RoomEvent.ActiveSpeakersChanged, refresh)
        .on(RoomEvent.Disconnected, () => {
          if (get().room === room) {
            presenceSocket.send({ type: 'voice.leave', channelId });
            set({ status: 'idle', channelId: null, room: null, tiles: [] });
          }
        });

      const connectPromise = room.connect(credentials.url, credentials.token);
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
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (error) {
        micEnabled = false;
        const reason = error instanceof Error ? error.message : 'unknown error';
        micProblem = `Connected, but microphone did not start (${reason}). Use the mic button to retry.`;
      }

      if (joinCounter !== currentJoinId) {
        void room.disconnect().catch(() => undefined);
        return;
      }

      presenceSocket.send({ type: 'voice.join', channelId });

      set({
        error: micProblem,
        status: 'connected',
        room,
        encrypted: true,
        micEnabled,
        cameraEnabled: false,
        screenEnabled: false,
        tiles: snapshot(room),
      });
    } catch (error) {
      if (joinCounter !== currentJoinId) return;

      console.error('voice join failed', error);
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
    set({ status: 'idle', channelId: null, room: null, tiles: [], screenEnabled: false, error: null });
    if (room) {
      await room.disconnect().catch(() => undefined);
    }
  },

  toggleMic: async () => {
    const { room, micEnabled, status } = get();
    if (!room || status !== 'connected') return;
    try {
      await room.localParticipant.setMicrophoneEnabled(!micEnabled);
      set({ micEnabled: !micEnabled, error: null, tiles: snapshot(room) });
    } catch (error) {
      set({ error: `Microphone: ${messageOf(error)}`, tiles: snapshot(room) });
    }
  },

  toggleCamera: async () => {
    const { room, cameraEnabled, status } = get();
    if (!room || status !== 'connected') return;
    try {
      await room.localParticipant.setCameraEnabled(!cameraEnabled);
      set({ cameraEnabled: !cameraEnabled, error: null, tiles: snapshot(room) });
    } catch (error) {
      set({ error: `Camera: ${messageOf(error)}`, tiles: snapshot(room) });
    }
  },

  toggleScreen: async () => {
    const { room, screenEnabled, status } = get();
    if (!room || status !== 'connected') return;
    try {
      await room.localParticipant.setScreenShareEnabled(!screenEnabled);
      set({ screenEnabled: !screenEnabled, error: null, tiles: snapshot(room) });
    } catch (error) {
      set({ error: `Screen share: ${messageOf(error)}`, tiles: snapshot(room) });
    }
  },
}));

function snapshot(room: Room): VoiceTile[] {
  const speaking = new Set(room.activeSpeakers.map((participant) => participant.identity));
  const participants: Array<LocalParticipant | RemoteParticipant> = [
    room.localParticipant,
    ...room.remoteParticipants.values(),
  ];

  return participants.map((participant) => toTile(participant, speaking.has(participant.identity)));
}

function toTile(participant: Participant, speaking: boolean): VoiceTile {
  const camera = participant.getTrackPublication(Track.Source.Camera);
  const screen = participant.getTrackPublication(Track.Source.ScreenShare);
  const mic = participant.getTrackPublication(Track.Source.Microphone);

  return {
    identity: participant.identity,
    name: participant.name || participant.identity,
    isLocal: participant.isLocal,
    speaking,
    micEnabled: Boolean(mic && !mic.isMuted),
    videoTrack: camera?.isMuted ? null : (camera?.track ?? null),
    screenTrack: screen?.track ?? null,
    // Local audio is never played back locally - that is an echo, not a feature.
    audioTrack: participant.isLocal ? null : (mic?.track ?? null),
  };
}

// A hot reload replaces this module while the old Room is still connected, and
// LiveKit answers a second session with the same identity by kicking the first
// - which looks exactly like a broken publish. Hand the room back first.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void useVoiceStore.getState().leave();
  });
}
