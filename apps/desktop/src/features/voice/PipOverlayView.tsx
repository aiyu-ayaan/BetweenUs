/**
 * Floating Picture-in-Picture overlay view.
 *
 * Teams/Discord-style always-on-top mini window that displays the incoming
 * screen share or active speaker's camera, with quick voice action controls.
 */
import { useEffect, useState } from 'react';
import { useVoiceStore } from '../../stores/voice';
import { VideoSink } from './MediaSink';
import {
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon,
  MaximizeIcon,
  XIcon,
} from '../../components/icons';

export function PipOverlayView(): JSX.Element {
  const status = useVoiceStore((state) => state.status);
  const channelName = useVoiceStore((state) => state.channelName);
  const tiles = useVoiceStore((state) => state.tiles);
  const shares = useVoiceStore((state) => state.shares);
  const watching = useVoiceStore((state) => state.watching);
  const micEnabled = useVoiceStore((state) => state.micEnabled);
  const cameraEnabled = useVoiceStore((state) => state.cameraEnabled);
  const toggleMic = useVoiceStore((state) => state.toggleMic);
  const toggleCamera = useVoiceStore((state) => state.toggleCamera);
  const leave = useVoiceStore((state) => state.leave);

  const [hovered, setHovered] = useState(false);

  // Determine active video source to show
  // 1. Preferred watching share, or first share
  const activeShare = shares.find((s) => s.identity === watching) ?? shares[0] ?? null;

  // 2. Otherwise active speaker tile with video, or first remote tile with video
  const tileWithVideo =
    tiles.find((t) => !t.isLocal && t.videoTrack && t.speaking) ??
    tiles.find((t) => !t.isLocal && t.videoTrack) ??
    tiles.find((t) => t.videoTrack) ??
    null;

  // 3. Otherwise active speaker tile
  const activeSpeakerTile =
    tiles.find((t) => !t.isLocal && t.speaking) ??
    tiles.find((t) => !t.isLocal) ??
    tiles[0] ??
    null;

  const returnToMain = (): void => {
    void window.nexora?.focusMain();
  };

  const closePip = (): void => {
    void window.nexora?.closePip();
  };

  const disconnectCall = (): void => {
    void leave();
    void window.nexora?.closePip();
  };

  // Close PiP if call ends or idle
  useEffect(() => {
    if (status === 'idle') {
      void window.nexora?.closePip();
    }
  }, [status]);

  const streamTitle = activeShare
    ? activeShare.isLocal
      ? 'Your screen'
      : `${activeShare.name}'s screen`
    : tileWithVideo
      ? tileWithVideo.name
      : activeSpeakerTile?.name ?? channelName ?? 'Voice Channel';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex h-screen w-screen select-none flex-col overflow-hidden bg-surface-950 font-sans text-slate-100"
    >
      {/* Draggable Top Bar */}
      <div
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className={`absolute left-0 right-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent p-2.5 transition-opacity duration-200 ${
          hovered ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="flex items-center gap-1.5 overflow-hidden rounded bg-black/60 px-2 py-0.5 backdrop-blur-sm">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          <span className="truncate text-[11px] font-medium text-slate-200">{streamTitle}</span>
        </div>

        {/* Action Buttons */}
        <div
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1"
        >
          <button
            type="button"
            onClick={returnToMain}
            title="Expand to main window"
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-black/60 text-slate-300 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
          >
            <MaximizeIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={closePip}
            title="Close mini player"
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-black/60 text-slate-300 backdrop-blur-sm transition-colors hover:bg-red-500/80 hover:text-white"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="relative flex h-full w-full flex-1 items-center justify-center overflow-hidden bg-black">
        {activeShare?.track ? (
          <VideoSink track={activeShare.track} fit="contain" />
        ) : tileWithVideo?.videoTrack ? (
          <VideoSink track={tileWithVideo.videoTrack} fit="cover" />
        ) : (
          /* Avatar fallback */
          <div className="flex flex-col items-center justify-center gap-2 p-4">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-full bg-surface-800 text-lg font-semibold uppercase text-accent transition-all duration-300 ${
                activeSpeakerTile?.speaking
                  ? 'ring-4 ring-emerald-500 ring-offset-2 ring-offset-black scale-105'
                  : 'ring-1 ring-white/10'
              }`}
            >
              {activeSpeakerTile?.name?.[0] ?? 'V'}
            </div>
            <p className="max-w-[200px] truncate text-xs font-medium text-slate-300">
              {activeSpeakerTile?.name ?? 'Connected'}
            </p>
          </div>
        )}
      </div>

      {/* Bottom Floating Quick Controls */}
      <div
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={`absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 shadow-2xl backdrop-blur-md transition-all duration-200 ${
          hovered ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 pointer-events-none'
        }`}
      >
        <button
          type="button"
          onClick={() => void toggleMic()}
          title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors ${
            micEnabled
              ? 'bg-white/10 text-slate-200 hover:bg-white/20'
              : 'bg-red-500/80 text-white hover:bg-red-500'
          }`}
        >
          {micEnabled ? <MicIcon className="h-3.5 w-3.5" /> : <MicOffIcon className="h-3.5 w-3.5" />}
        </button>

        <button
          type="button"
          onClick={() => void toggleCamera()}
          title={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors ${
            cameraEnabled
              ? 'bg-white/10 text-slate-200 hover:bg-white/20'
              : 'bg-red-500/80 text-white hover:bg-red-500'
          }`}
        >
          {cameraEnabled ? (
            <VideoIcon className="h-3.5 w-3.5" />
          ) : (
            <VideoOffIcon className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={returnToMain}
          title="Return to Nexora"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white/10 text-slate-200 transition-colors hover:bg-white/20 hover:text-white"
        >
          <MaximizeIcon className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          onClick={disconnectCall}
          title="Disconnect call"
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-500"
        >
          <PhoneOffIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
