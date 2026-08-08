import { useEffect, useRef, type ReactNode } from 'react';
import type { Track } from 'livekit-client';
import { useVoiceStore, type VoiceTile } from '../../stores/voice';
import {
  LockIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  VideoIcon,
  VideoOffIcon,
} from '../../components/icons';

/** Sits at the bottom of the sidebar while connected to a voice channel. */
export function VoicePanel({ channelName }: { channelName: string | null }): JSX.Element | null {
  const status = useVoiceStore((state) => state.status);
  const encrypted = useVoiceStore((state) => state.encrypted);
  const micEnabled = useVoiceStore((state) => state.micEnabled);
  const cameraEnabled = useVoiceStore((state) => state.cameraEnabled);
  const screenEnabled = useVoiceStore((state) => state.screenEnabled);
  const tiles = useVoiceStore((state) => state.tiles);
  const leave = useVoiceStore((state) => state.leave);
  const toggleMic = useVoiceStore((state) => state.toggleMic);
  const toggleCamera = useVoiceStore((state) => state.toggleCamera);
  const toggleScreen = useVoiceStore((state) => state.toggleScreen);

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

      {/* Video only appears once somebody actually turns a camera or screen on. */}
      {tiles.some((tile) => tile.videoTrack ?? tile.screenTrack) && (
        <ul className="mb-2 grid grid-cols-2 gap-1.5">
          {tiles
            .filter((tile) => tile.videoTrack ?? tile.screenTrack)
            .map((tile) => (
              <VideoTile key={tile.identity} tile={tile} />
            ))}
        </ul>
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
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-1">
        <ControlButton
          active={micEnabled}
          label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          onClick={() => void toggleMic()}
        >
          {micEnabled ? <MicIcon className="h-4 w-4" /> : <MicOffIcon className="h-4 w-4" />}
        </ControlButton>

        <ControlButton
          active={cameraEnabled}
          label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          onClick={() => void toggleCamera()}
        >
          {cameraEnabled ? <VideoIcon className="h-4 w-4" /> : <VideoOffIcon className="h-4 w-4" />}
        </ControlButton>

        <ControlButton
          active={screenEnabled}
          label={screenEnabled ? 'Stop sharing screen' : 'Share screen'}
          onClick={() => void toggleScreen()}
        >
          <ScreenShareIcon className="h-4 w-4" />
        </ControlButton>

        <button
          type="button"
          onClick={() => void leave()}
          aria-label="Disconnect from voice"
          title="Disconnect"
          className="ml-auto cursor-pointer rounded-md bg-red-500/90 p-2 text-white transition-colors duration-200 hover:bg-red-500"
        >
          <PhoneOffIcon className="h-4 w-4" />
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

function VideoTile({ tile }: { tile: VoiceTile }): JSX.Element {
  // A screen share takes the tile over: it is what people actually want to see.
  const track = tile.screenTrack ?? tile.videoTrack;

  return (
    <li className="relative aspect-video overflow-hidden rounded bg-surface-800">
      {track && <VideoSink track={track} />}
      <p className="absolute bottom-0.5 left-0.5 truncate rounded bg-black/60 px-1 text-[10px] text-slate-200">
        {tile.name}
      </p>
    </li>
  );
}

/** Attaches a LiveKit track to a real DOM element and detaches on unmount. */
function VideoSink({ track }: { track: Track }): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return <video ref={ref} autoPlay playsInline muted className="h-full w-full object-cover" />;
}

function AudioSink({ track }: { track: Track }): JSX.Element {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return <audio ref={ref} autoPlay />;
}
