/**
 * The main-content screen for a voice channel.
 *
 * Selecting a voice channel opens this instead of the chat view: the first
 * click also joins the call, and every click after that just brings the screen
 * back up. It is where cameras and shared screens are shown - the sidebar panel
 * stays a compact status readout.
 *
 * Two people can be in the channel without this client being in the call, so
 * the roster comes from presence when disconnected and from LiveKit once
 * connected: only the second one carries media.
 */
import type { Channel } from '@nexora/shared-types';
import type { Track } from 'livekit-client';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { VoiceControls } from './VoiceControls';
import { VideoSink } from './MediaSink';
import { LockIcon, MicOffIcon, SpeakerIcon } from '../../components/icons';

interface Stage {
  key: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micEnabled: boolean;
  videoTrack: Track | null;
  screenTrack: Track | null;
}

export function VoiceChannelView({ channel }: { channel: Channel }): JSX.Element {
  const members = useChatStore((state) => state.members);
  const occupants = usePresenceStore((state) => state.voice.get(channel.id) ?? []);

  const status = useVoiceStore((state) => state.status);
  const connectedTo = useVoiceStore((state) => state.channelId);
  const tiles = useVoiceStore((state) => state.tiles);
  const encrypted = useVoiceStore((state) => state.encrypted);
  const error = useVoiceStore((state) => state.error);
  const join = useVoiceStore((state) => state.join);

  const inThisChannel = connectedTo === channel.id;
  const connected = inThisChannel && status === 'connected';
  const connecting = inThisChannel && status === 'connecting';

  // Connected: LiveKit knows who is really in the room and carries their media.
  // Otherwise fall back to the presence roster, which has names but no tracks.
  const stage: Stage[] = connected
    ? tiles.map((tile) => ({
        key: tile.identity,
        name: tile.name,
        isLocal: tile.isLocal,
        speaking: tile.speaking,
        micEnabled: tile.micEnabled,
        videoTrack: tile.videoTrack,
        screenTrack: tile.screenTrack,
      }))
    : occupants.map((userId) => ({
        key: userId,
        name: members.find((member) => member.userId === userId)?.displayName ?? 'Someone',
        isLocal: false,
        speaking: false,
        micEnabled: true,
        videoTrack: null,
        screenTrack: null,
      }));

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-gradient-to-b from-[#1e1b4b] via-surface-950 to-surface-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/30 px-4">
        <SpeakerIcon className="h-5 w-5 text-slate-500" />
        <h1 className="truncate font-semibold text-slate-100">{channel.name}</h1>
        {stage.length > 0 && (
          <span className="text-sm text-slate-400">
            - {stage.length} in voice
          </span>
        )}
        {connected && encrypted && (
          <span
            title="Voice media is encrypted on this device"
            className="ml-auto flex items-center gap-1 text-xs text-emerald-300"
          >
            <LockIcon className="h-3.5 w-3.5" />
            E2EE
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6">
        {error && (
          <p role="alert" className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {stage.length === 0 ? (
          <div className="text-center">
            <SpeakerIcon className="mx-auto h-12 w-12 text-slate-600" />
            <p className="mt-4 text-slate-400">No one is currently in voice</p>
          </div>
        ) : (
          <ul className="grid w-full max-w-5xl auto-rows-fr grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
            {stage.map((tile) => (
              <StageTile key={tile.key} tile={tile} />
            ))}
          </ul>
        )}

        {!connected && (
          <button
            type="button"
            disabled={connecting}
            onClick={() => void join(channel.id)}
            className="cursor-pointer rounded-full bg-slate-100 px-6 py-2.5 font-semibold text-slate-900 transition-colors duration-200 hover:bg-white disabled:cursor-wait disabled:opacity-60"
          >
            {connecting ? 'Connecting…' : 'Join Voice'}
          </button>
        )}
      </div>

      {connected && (
        <footer className="flex shrink-0 justify-center border-t border-black/30 bg-black/30 px-4 py-3">
          <VoiceControls size="lg" />
        </footer>
      )}
    </section>
  );
}

function StageTile({ tile }: { tile: Stage }): JSX.Element {
  // A shared screen takes the tile over: it is what people actually want to see.
  const track = tile.screenTrack ?? tile.videoTrack;

  return (
    <li
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-surface-800 ring-2 transition-colors duration-200 ${
        tile.speaking ? 'ring-emerald-400' : 'ring-transparent'
      }`}
    >
      {track ? (
        <VideoSink track={track} fit={tile.screenTrack ? 'contain' : 'cover'} />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-700 text-2xl font-semibold text-slate-200"
        >
          {tile.name.charAt(0).toUpperCase()}
        </span>
      )}

      <p className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-slate-200">
        {!tile.micEnabled && <MicOffIcon className="h-3 w-3 text-red-400" />}
        <span className="truncate">
          {tile.name}
          {tile.isLocal && ' (you)'}
        </span>
      </p>
    </li>
  );
}
