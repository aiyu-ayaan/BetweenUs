import { useState } from 'react';
import { useVoiceStore, type VoiceTile } from '../../stores/voice';
import { usePeerAudio } from '../../stores/peerAudio';
import { CallDuration } from './CallDuration';
import { VoiceControls } from './VoiceControls';
import { NotHeardNotice } from './NotHeardNotice';
import { LockIcon, MicOffIcon, SpeakerIcon, SpeakerOffIcon, XIcon } from '../../components/icons';

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
  const notHeard = useVoiceStore((state) => state.notHeard);

  if (status === 'idle') return null;

  return (
    <section aria-label="Voice connection" className="border-t border-edge bg-black/20 p-2">
      <p className="flex items-center gap-1.5 px-1 pb-2 text-xs">
        {encrypted && <LockIcon className="h-3.5 w-3.5 text-status-online" />}
        <span className="font-medium text-status-online">
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
        {/* Pushed to the end, so the channel name can be as long as it likes
            without the clock moving around under it. */}
        <span className="ms-auto">
          <CallDuration />
        </span>
      </p>

      {error && (
        <div
          role="alert"
          className="mb-2 flex items-start justify-between gap-1.5 rounded bg-danger/10 px-2 py-1.5 text-xs text-danger"
        >
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => useVoiceStore.getState().dismissError()}
            className="inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-danger/70 transition-colors hover:bg-danger/20 hover:text-danger"
            title="Dismiss error"
            aria-label="Dismiss error"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* The one measurement worth interrupting somebody for. Everything else
          about the connection waits behind a button; a microphone that is
          sending nothing while its owner talks into it cannot. */}
      {notHeard && (
        <div className="mb-2">
          <NotHeardNotice compact />
        </div>
      )}

      <ul className="mb-2 space-y-1">
        {tiles.map((tile) => (
          <Participant key={tile.identity} tile={tile} />
        ))}
      </ul>

      <VoiceControls />
    </section>
  );
}

/**
 * One person in the call, and how loud they are here.
 *
 * The volume is this machine's opinion of them and nobody else's: it is not
 * sent anywhere, the other person is not told, and turning somebody down does
 * not quieten them for the rest of the call. Clicking the speaker silences
 * them outright; the slider is for the more common case, which is somebody
 * whose gain is set far too high.
 */
function Participant({ tile }: { tile: VoiceTile }): JSX.Element {
  const settingFor = usePeerAudio((state) => state.settingFor);
  const people = usePeerAudio((state) => state.people);
  const setVolume = usePeerAudio((state) => state.setVolume);
  const toggleMuted = usePeerAudio((state) => state.toggleMuted);
  const [open, setOpen] = useState(false);

  // `people` is read only to re-render on a change; the value comes from the
  // getter, which knows the default.
  void people;
  const setting = settingFor(tile.userId);
  const adjusted = !tile.isLocal && (setting.muted || setting.volume !== 1);

  return (
    <li className="px-1 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            tile.speaking ? 'bg-status-online text-slate-950' : 'bg-surface-700 text-slate-200'
          }`}
          aria-hidden="true"
        >
          {tile.name.charAt(0).toUpperCase()}
        </span>

        <span className={`truncate ${setting.muted && !tile.isLocal ? 'text-slate-500' : 'text-slate-300'}`}>
          {tile.name}
          {tile.isLocal && ' (you)'}
        </span>

        {!tile.micEnabled && <MicOffIcon className="ms-auto h-3.5 w-3.5 shrink-0 text-danger" />}

        {/* Your own volume is the one thing this cannot change: you hear
            yourself through the room, not through the call. */}
        {!tile.isLocal && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-label={`Volume for ${tile.name}`}
            title={setting.muted ? `${tile.name} is silenced for you` : `Volume for ${tile.name}`}
            className={`${tile.micEnabled ? 'ms-auto' : ''} cursor-pointer rounded p-1 transition-colors duration-150 hover:bg-white/[0.07] ${
              adjusted ? 'text-accent' : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {setting.muted ? (
              <SpeakerOffIcon className="h-3.5 w-3.5" />
            ) : (
              <SpeakerIcon className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {open && !tile.isLocal && (
        <div className="mt-1 flex items-center gap-2 ps-8 pe-1">
          <button
            type="button"
            onClick={() => toggleMuted(tile.userId)}
            className="cursor-pointer rounded px-1.5 py-0.5 text-xs text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
          >
            {setting.muted ? 'Unmute' : 'Mute'}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(setting.volume * 100)}
            disabled={setting.muted}
            onChange={(event) => setVolume(tile.userId, Number(event.target.value) / 100)}
            aria-label={`How loud ${tile.name} is`}
            className="h-1 flex-1 cursor-pointer accent-accent disabled:opacity-40"
          />
          <span className="w-8 shrink-0 text-end text-xs tabular-nums text-slate-500">
            {Math.round(setting.volume * 100)}
          </span>
        </div>
      )}
    </li>
  );
}
