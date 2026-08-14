import { useVoiceStore } from '../../stores/voice';
import { VoiceControls } from './VoiceControls';
import { AudioSink } from './MediaSink';
import { LockIcon, MicOffIcon } from '../../components/icons';

/**
 * Sits at the bottom of the sidebar while connected to a voice channel.
 *
 * Deliberately compact: who is here, whether the call is encrypted, and the
 * controls. Cameras and shared screens belong to `VoiceChannelView`, which has
 * the room for them. The audio sinks stay here because the panel is mounted for
 * as long as the call lasts - the channel screen is not.
 */
export function VoicePanel({ channelName }: { channelName: string | null }): JSX.Element | null {
  const status = useVoiceStore((state) => state.status);
  const encrypted = useVoiceStore((state) => state.encrypted);
  const tiles = useVoiceStore((state) => state.tiles);
  const watching = useVoiceStore((state) => state.watching);
  const error = useVoiceStore((state) => state.error);

  if (status === 'idle') return null;

  return (
    <section aria-label="Voice connection" className="border-t border-black/30 bg-surface-900 p-2">
      <p className="flex items-center gap-1.5 px-1 pb-2 text-xs">
        {encrypted && <LockIcon className="h-3.5 w-3.5 text-emerald-400" />}
        <span className="font-medium text-emerald-400">
          {status === 'connecting' ? 'Connecting…' : 'Voice connected'}
        </span>
        {channelName && <span className="truncate text-slate-400">/ {channelName}</span>}
      </p>

      {error && (
        <p role="alert" className="mb-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">
          {error}
        </p>
      )}

      <ul className="mb-2 space-y-1">
        {tiles.map((tile) => (
          <li key={tile.identity} className="flex items-center gap-2 px-1 text-sm">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                tile.speaking ? 'bg-emerald-500 text-slate-950' : 'bg-surface-700 text-slate-200'
              }`}
              aria-hidden="true"
            >
              {tile.name.charAt(0).toUpperCase()}
            </span>
            <span className="truncate text-slate-300">
              {tile.name}
              {tile.isLocal && ' (you)'}
            </span>
            {!tile.micEnabled && <MicOffIcon className="ml-auto h-3.5 w-3.5 text-red-400" />}
            {tile.audioTrack && <AudioSink track={tile.audioTrack} />}
            {/* A shared screen brings sound only to viewers watching it */}
            {tile.screenAudioTrack && watching === tile.identity && (
              <AudioSink track={tile.screenAudioTrack} />
            )}
          </li>
        ))}
      </ul>

      <VoiceControls />
    </section>
  );
}
