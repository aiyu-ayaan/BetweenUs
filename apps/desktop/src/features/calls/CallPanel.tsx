import { useEffect, useRef, type ReactNode } from 'react';
import type { Track } from 'livekit-client';
import { useCallStore, type CallTile } from '../../stores/call';
import {
  LockIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  VideoIcon,
  VideoOffIcon,
} from '../../components/icons';

/** Rendered above the message list while a call is running in this channel. */
export function CallPanel({ channelId }: { channelId: string }): JSX.Element | null {
  const { status, channelId: callChannelId, tiles, micEnabled, cameraEnabled, screenEnabled, encrypted } =
    useCallStore();
  const leave = useCallStore((state) => state.leave);
  const toggleMic = useCallStore((state) => state.toggleMic);
  const toggleCamera = useCallStore((state) => state.toggleCamera);
  const toggleScreen = useCallStore((state) => state.toggleScreen);

  // The call keeps running when the user reads another channel; the panel just
  // follows the channel it belongs to.
  if (status === 'idle' || callChannelId !== channelId) return null;

  return (
    <section
      aria-label="Call"
      className="shrink-0 border-b border-black/30 bg-surface-950/60 px-4 py-3"
    >
      <div className="mb-3 flex items-center gap-2 text-sm">
        {encrypted && (
          <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">
            <LockIcon className="h-3.5 w-3.5" />
            End-to-end encrypted
          </span>
        )}
        <span className="text-slate-400">
          {status === 'connecting' ? 'Connecting…' : `${tiles.length} in call`}
        </span>
      </div>

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {tiles.map((tile) => (
          <ParticipantTile key={tile.identity} tile={tile} />
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <ControlButton
          active={micEnabled}
          label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          onClick={() => void toggleMic()}
        >
          {micEnabled ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
        </ControlButton>

        <ControlButton
          active={cameraEnabled}
          label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          onClick={() => void toggleCamera()}
        >
          {cameraEnabled ? <VideoIcon className="h-5 w-5" /> : <VideoOffIcon className="h-5 w-5" />}
        </ControlButton>

        <ControlButton
          active={screenEnabled}
          label={screenEnabled ? 'Stop sharing screen' : 'Share screen'}
          onClick={() => void toggleScreen()}
        >
          <ScreenShareIcon className="h-5 w-5" />
        </ControlButton>

        <button
          type="button"
          onClick={() => void leave()}
          aria-label="Leave call"
          className="ml-auto flex cursor-pointer items-center gap-2 rounded-md bg-red-500/90 px-3 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-red-500"
        >
          <PhoneOffIcon className="h-5 w-5" />
          Leave
        </button>
      </div>
    </section>
  );
}

function ControlButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`cursor-pointer rounded-md p-2 transition-colors duration-200 ${
        active ? 'bg-surface-700 text-slate-100' : 'bg-surface-800 text-slate-400'
      } hover:bg-surface-700`}
    >
      {children}
    </button>
  );
}

function ParticipantTile({ tile }: { tile: CallTile }): JSX.Element {
  // A screen share takes the tile over: it is what people actually want to see.
  const video = tile.screenTrack ?? tile.videoTrack;

  return (
    <li className="relative aspect-video overflow-hidden rounded-lg bg-surface-800">
      {video ? (
        <MediaElement track={video} kind="video" />
      ) : (
        <div className="flex h-full items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-700 text-lg font-semibold text-slate-200">
            {tile.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {tile.audioTrack && <MediaElement track={tile.audioTrack} kind="audio" />}

      <p
        className={`absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-xs ${
          tile.speaking ? 'text-emerald-300' : 'text-slate-200'
        }`}
      >
        {!tile.micEnabled && <MicOffIcon className="h-3 w-3" />}
        {tile.name}
        {tile.isLocal && ' (you)'}
      </p>
    </li>
  );
}

/** Attaches a LiveKit track to a real DOM element and detaches on unmount. */
function MediaElement({ track, kind }: { track: Track; kind: 'video' | 'audio' }): JSX.Element {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  if (kind === 'audio') return <audio ref={ref} autoPlay />;
  return <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />;
}
