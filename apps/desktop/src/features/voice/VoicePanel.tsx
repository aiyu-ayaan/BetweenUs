import { useVoiceStore } from '../../stores/voice';
import { VoiceControls } from './VoiceControls';
import { LockIcon, MicOffIcon } from '../../components/icons';

/**
 * Sits at the bottom of whichever sidebar is on screen while connected to a
 * voice channel - the server one and the home one both mount it, so leaving the
 * server the call is in does not hide the call.
 *
 * Deliberately compact: who is here, whether the call is encrypted, and the
 * controls. Cameras and shared screens belong to `VoiceChannelView`, which has
 * the room for them. The audio is `CallAudio`, mounted once at the root: it has
 * to keep playing while this panel is being unmounted and mounted again by a
 * sidebar swap.
 *
 * The channel name comes from the store rather than from the caller, because
 * the caller does not always know it: `chat.channels` holds the *current*
 * server's channels, and a call outlives switching away from it.
 */
export function VoicePanel(): JSX.Element | null {
  const status = useVoiceStore((state) => state.status);
  const encrypted = useVoiceStore((state) => state.encrypted);
  const tiles = useVoiceStore((state) => state.tiles);
  const channelName = useVoiceStore((state) => state.channelName);
  const error = useVoiceStore((state) => state.error);
  const openCallChannel = useVoiceStore((state) => state.openCallChannel);

  if (status === 'idle') return null;

  return (
    <section aria-label="Voice connection" className="border-t border-black/30 bg-surface-900 p-2">
      <p className="flex items-center gap-1.5 px-1 pb-2 text-xs">
        {encrypted && <LockIcon className="h-3.5 w-3.5 text-emerald-400" />}
        <span className="font-medium text-emerald-400">
          {status === 'connecting' ? 'Connecting…' : 'Voice connected'}
        </span>
        {channelName && (
          <button
            type="button"
            onClick={() => void openCallChannel()}
            title="Back to the call"
            className="cursor-pointer truncate text-slate-400 underline-offset-2 transition-colors duration-200 hover:text-slate-200 hover:underline"
          >
            / {channelName}
          </button>
        )}
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
          </li>
        ))}
      </ul>

      <VoiceControls />
    </section>
  );
}
