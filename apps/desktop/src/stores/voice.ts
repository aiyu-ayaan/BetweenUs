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
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
} from 'livekit-client';
import E2eeWorker from 'livekit-client/e2ee-worker?worker';
import { api } from '../services/api';
import { callKeyForChannel } from '../services/e2ee';
import { presenceSocket } from '../services/socket';

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
    if (get().status !== 'idle') await get().leave();
    set({ status: 'connecting', channelId, error: null, tiles: [] });

    try {
      // The key comes from the same exchange chat uses, so a member who can
      // read the channel can join its call and nobody else can.
      const [key, credentials] = await Promise.all([
        callKeyForChannel(channelId),
        api.callToken(channelId),
      ]);

      const keyProvider = new ExternalE2EEKeyProvider();
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        e2ee: { keyProvider, worker: new E2eeWorker() },
      });

      await keyProvider.setKey(key);

      try {
        await room.setE2EEEnabled(true);
      } catch {
        // Insertable streams unavailable (for example a non-secure context).
        // Refuse rather than silently downgrading to plaintext media.
        room.disconnect().catch(() => undefined);
        throw new Error('This runtime cannot encrypt voice media, so the join was cancelled');
      }

      const refresh = (): void => set({ tiles: snapshot(room) });
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
          set({ status: 'idle', channelId: null, room: null, tiles: [] });
        });

      await room.connect(credentials.url, credentials.token);
      // Autoplay policy: browsers need a gesture before remote audio plays, and
      // clicking a voice channel is one.
      await room.startAudio().catch(() => undefined);

      // A missing or blocked microphone must not keep someone out of the
      // channel - they can still listen, and the panel says the mic is off.
      let micEnabled = true;
      let micProblem: string | null = null;
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (error) {
        micEnabled = false;
        micProblem =
          error instanceof Error
            ? `Joined without a microphone: ${error.message}`
            : 'Joined without a microphone';
      }

      // Members who have not joined still see who is in here.
      presenceSocket.send({ type: 'voice.join', channelId });

      set({
        error: micProblem,
        status: 'connected',
        room,
        // Guaranteed: the join above aborts when E2EE cannot be turned on.
        encrypted: true,
        micEnabled,
        cameraEnabled: false,
        screenEnabled: false,
        tiles: snapshot(room),
      });
    } catch (error) {
      // Mirrored into the dev terminal by the Electron main process.
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
    const { room, channelId } = get();
    if (channelId) presenceSocket.send({ type: 'voice.leave', channelId });
    set({ status: 'idle', channelId: null, room: null, tiles: [], screenEnabled: false });
    await room?.disconnect();
  },

  toggleMic: async () => {
    const { room, micEnabled } = get();
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!micEnabled);
    set({ micEnabled: !micEnabled, tiles: snapshot(room) });
  },

  toggleCamera: async () => {
    const { room, cameraEnabled } = get();
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!cameraEnabled);
    set({ cameraEnabled: !cameraEnabled, tiles: snapshot(room) });
  },

  toggleScreen: async () => {
    const { room, screenEnabled } = get();
    if (!room) return;
    // The Electron main process answers the picker; see electron/main.ts.
    await room.localParticipant.setScreenShareEnabled(!screenEnabled);
    set({ screenEnabled: !screenEnabled, tiles: snapshot(room) });
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
