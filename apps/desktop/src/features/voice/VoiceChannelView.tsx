/**
 * The main-content screen for a voice channel.
 *
 * Selecting a voice channel opens this instead of the chat view: the first
 * click also joins the call, and every click after that just brings the screen
 * back up.
 *
 * Two layouts, because two things happen in a voice channel:
 *
 * - **Grid** - everybody's camera, paged. A share is announced by a banner but
 *   nobody is dragged into it, the way Discord announces a stream.
 * - **Theatre** - one shared screen fills the stage with the people along the
 *   bottom, which is what a group watching something together wants. Entered by
 *   choosing to watch a share, left by closing it.
 *
 * Cameras and a shared screen can be on at once, so a share is its own thing
 * and never replaces the sharer's tile.
 *
 * The grid pages at nine tiles rather than shrinking forever, and whoever spoke
 * most recently is pulled to the front so an active speaker is on page one -
 * the same bargain Teams makes. Speaking is marked in amber.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel } from '@nexora/shared-types';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useRemoteStore } from '../../stores/remote';
import { isDesktopRuntime } from '../../services/platform';
import { useShareControlStore } from '../../stores/shareControl';
import { useVoiceStore, type VoiceShare, type VoiceTile } from '../../stores/voice';
import { VoiceControls } from './VoiceControls';
import { VideoSink } from './MediaSink';
import { ShareStage } from './ShareStage';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LayoutBottomIcon,
  LayoutSidebarIcon,
  LockIcon,
  MaximizeIcon,
  MicOffIcon,
  MinimizeIcon,
  ScreenShareIcon,
  SpeakerIcon,
  UsersIcon,
} from '../../components/icons';

/** Tiles per page. Nine keeps every face big enough to read on a laptop. */
const PAGE_SIZE = 9;
/** How long after speaking someone keeps their place at the front. */
const PROMOTION_MS = 60_000;

interface Stage {
  key: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micEnabled: boolean;
  videoTrack: MediaStreamTrack | null;
  lastSpokeAt: number;
}

export function VoiceChannelView({ channel }: { channel: Channel }): JSX.Element {
  const members = useChatStore((state) => state.members);
  const occupants = usePresenceStore((state) => state.voice.get(channel.id) ?? []);

  const status = useVoiceStore((state) => state.status);
  const connectedTo = useVoiceStore((state) => state.channelId);
  const tiles = useVoiceStore((state) => state.tiles);
  const shares = useVoiceStore((state) => state.shares);
  const watching = useVoiceStore((state) => state.watching);
  const encrypted = useVoiceStore((state) => state.encrypted);
  const error = useVoiceStore((state) => state.error);
  const join = useVoiceStore((state) => state.join);

  const inThisChannel = connectedTo === channel.id;
  const connected = inThisChannel && status === 'connected';
  const connecting = inThisChannel && status === 'connecting';

  // Connected: the mesh knows who is really in the call, because it holds a
  // connection to each of them. Otherwise fall back to the presence roster,
  // which has names but no tracks.
  const stage: Stage[] = connected
    ? tiles.map(toStage)
    : occupants.map((userId) => ({
        key: userId,
        name: members.find((member) => member.userId === userId)?.displayName ?? 'Someone',
        isLocal: false,
        speaking: false,
        micEnabled: true,
        videoTrack: null,
        lastSpokeAt: 0,
      }));

  const ordered = useOrderedStage(stage);
  const watched = connected ? (shares.find((share) => share.identity === watching) ?? null) : null;

  return (
    <section className="panel flex min-w-0 flex-1 flex-col bg-surface-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
        <SpeakerIcon className="h-5 w-5 text-slate-500" />
        <h1 className="truncate font-semibold text-slate-100">{channel.name}</h1>
        {stage.length > 0 && <span className="text-sm text-slate-400">- {stage.length} in voice</span>}
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {error && (
          <p role="alert" className="rounded bg-red-500/10 px-3 py-2 text-center text-sm text-red-300">
            {error}
          </p>
        )}

        <ShareBanners shares={shares} watching={watching} />

        {stage.length === 0 ? (
          <EmptyStage />
        ) : watched ? (
          <Theatre share={watched} tiles={ordered} />
        ) : (
          <PagedGrid tiles={ordered} />
        )}

        {!connected && (
          <div className="flex shrink-0 justify-center">
            <button
              type="button"
              disabled={connecting}
              onClick={() => void join(channel.id)}
              className="cursor-pointer rounded-full bg-slate-100 px-6 py-2.5 font-semibold text-slate-900 transition-colors duration-200 hover:bg-white disabled:cursor-wait disabled:opacity-60"
            >
              {connecting ? 'Connecting…' : 'Join Voice'}
            </button>
          </div>
        )}
      </div>

      {connected && (
        <footer className="flex shrink-0 justify-center border-t border-edge bg-black/30 px-4 py-3">
          <VoiceControls size="lg" />
        </footer>
      )}
    </section>
  );
}

function toStage(tile: VoiceTile): Stage {
  return {
    key: tile.identity,
    name: tile.name,
    isLocal: tile.isLocal,
    speaking: tile.speaking,
    micEnabled: tile.micEnabled,
    videoTrack: tile.videoTrack,
    lastSpokeAt: tile.lastSpokeAt,
  };
}

/**
 * Recent speakers first, everyone else in their existing order.
 *
 * Sorting the whole list by who spoke last would reshuffle the grid on every
 * word; letting a promotion lapse after a minute means a quiet room settles
 * back down and stays put.
 */
function useOrderedStage(stage: Stage[]): Stage[] {
  // Promotions expire on a timer, so a room that goes quiet re-settles without
  // needing an event to arrive first.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    const now = Date.now();
    const recent = (tile: Stage): number =>
      now - tile.lastSpokeAt < PROMOTION_MS ? tile.lastSpokeAt : 0;

    return [...stage].sort((left, right) => recent(right) - recent(left));
  }, [stage]);
}

function EmptyStage(): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <SpeakerIcon className="h-12 w-12 text-slate-600" />
      <p className="mt-4 text-slate-400">No one is currently in voice</p>
    </div>
  );
}

/**
 * "bob is sharing their screen" with a way in - a share never hijacks anyone's
 * view, they opt into it.
 */
function ShareBanners({
  shares,
  watching,
}: {
  shares: VoiceShare[];
  watching: string | null;
}): JSX.Element | null {
  const watch = useVoiceStore((state) => state.watch);
  const stopScreenShare = useVoiceStore((state) => state.stopScreenShare);

  const unwatched = shares.filter((share) => share.identity !== watching);
  if (unwatched.length === 0) return null;

  return (
    <ul className="flex shrink-0 flex-col gap-2">
      {unwatched.map((share) => (
        <li
          key={share.identity}
          className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2"
        >
          <ScreenShareIcon className="h-4 w-4 shrink-0 text-accent" />
          <p className="min-w-0 truncate text-sm text-slate-200">
            <span className="font-semibold">{share.isLocal ? 'You are' : `${share.name} is`}</span>{' '}
            sharing a screen
          </p>
          <button
            type="button"
            onClick={() => watch(share.identity)}
            className="ml-auto shrink-0 cursor-pointer rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white transition-colors duration-200 hover:brightness-110"
          >
            {share.isLocal ? 'Preview' : 'Join stream'}
          </button>
          {share.isLocal && (
            <button
              type="button"
              onClick={() => void stopScreenShare()}
              className="shrink-0 cursor-pointer rounded-md px-3 py-1 text-xs text-slate-300 transition-colors duration-200 hover:bg-surface-700"
            >
              Stop
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

type LayoutMode = 'side-left' | 'side-right' | 'bottom';

/** One shared screen big, everyone else small underneath or in a side rail. Movie night. */
function Theatre({ share, tiles }: { share: VoiceShare; tiles: Stage[] }): JSX.Element {
  const watch = useVoiceStore((state) => state.watch);
  const stopScreenShare = useVoiceStore((state) => state.stopScreenShare);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showParticipants, setShowParticipants] = useState(true);
  const [layout, setLayout] = useState<LayoutMode>('side-left');
  const hideTimerRef = useRef<number | null>(null);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    if (fullscreen) {
      hideTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 2500);
    }
  }, [fullscreen]);

  useEffect(() => {
    if (fullscreen) {
      resetHideTimer();
    } else {
      setShowControls(true);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [fullscreen, resetHideTimer]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && fullscreen) {
        setFullscreen(false);
      } else if (
        (e.key === 'f' || e.key === 'F') &&
        !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      ) {
        setFullscreen((prev) => !prev);
      }
      resetHideTimer();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [fullscreen, resetHideTimer]);

  const toggleFullscreen = (): void => {
    setFullscreen((prev) => !prev);
  };

  const cycleLayout = (): void => {
    setLayout((curr) =>
      curr === 'side-left' ? 'side-right' : curr === 'side-right' ? 'bottom' : 'side-left',
    );
  };

  if (fullscreen) {
    return (
      <div
        onMouseMove={resetHideTimer}
        onTouchStart={resetHideTimer}
        className={`fixed inset-0 z-50 flex flex-col bg-black select-none ${
          !showControls ? 'cursor-none' : ''
        }`}
      >
        {/* Fullscreen top header overlay (Auto-hiding) */}
        <div
          className={`absolute left-0 right-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 transition-all duration-300 ease-out ${
            showControls
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-6 pointer-events-none'
          }`}
        >
          {/* Live badge & Stream name */}
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3.5 py-1.5 backdrop-blur-md shadow-lg">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
            </span>
            <span className="text-xs font-semibold text-slate-100 tracking-wide">
              {share.isLocal ? 'Your screen' : `${share.name}'s screen`}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {!share.isLocal && <ControlButtons share={share} />}
            {share.isLocal && (
              <button
                type="button"
                onClick={() => void stopScreenShare()}
                className="cursor-pointer rounded-md bg-red-500/90 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md backdrop-blur transition-all duration-200 hover:bg-red-500 hover:shadow-red-500/20 active:scale-95"
              >
                Stop sharing
              </button>
            )}
            <button
              type="button"
              onClick={cycleLayout}
              title={`Layout: ${
                layout === 'side-left'
                  ? 'Left Side Gallery'
                  : layout === 'side-right'
                    ? 'Right Side Gallery'
                    : 'Bottom Dock'
              } (Click to switch)`}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-slate-200 backdrop-blur-md shadow-md transition-all duration-200 hover:bg-white/10 active:scale-95"
            >
              {layout === 'side-left' ? (
                <LayoutSidebarIcon className="h-3.5 w-3.5" />
              ) : layout === 'side-right' ? (
                <LayoutSidebarIcon className="h-3.5 w-3.5 scale-x-[-1]" />
              ) : (
                <LayoutBottomIcon className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {layout === 'side-left' ? 'Left' : layout === 'side-right' ? 'Right' : 'Bottom'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowParticipants((prev) => !prev)}
              aria-label={showParticipants ? 'Hide participants' : 'Show participants'}
              title={showParticipants ? 'Hide participants' : 'Show participants'}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium backdrop-blur-md shadow-md transition-all duration-200 active:scale-95 ${
                showParticipants
                  ? 'bg-white/15 text-white'
                  : 'bg-black/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              <UsersIcon className="h-3.5 w-3.5" />
              <span>{tiles.length}</span>
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="Exit full screen"
              title="Exit full screen (Esc or F)"
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-md shadow-md transition-all duration-200 hover:bg-white/20 active:scale-95"
            >
              <MinimizeIcon className="h-4 w-4" />
              Exit full screen
            </button>
            <button
              type="button"
              onClick={() => {
                setFullscreen(false);
                watch(null);
              }}
              className="cursor-pointer rounded-md border border-white/10 bg-black/60 px-3.5 py-1.5 text-xs font-medium text-slate-200 backdrop-blur-md shadow-md transition-all duration-200 hover:bg-white/10 active:scale-95"
            >
              Back to grid
            </button>
          </div>
        </div>

        {/* Fullscreen Main Content Area (Side Gallery and Center Stage) */}
        <div className="relative flex min-h-0 flex-1 flex-row items-center justify-center overflow-hidden bg-black w-full h-full">
          {/* Floating Show Cameras pill when hidden */}
          {!showParticipants && (
            <button
              type="button"
              onClick={() => setShowParticipants(true)}
              title="Show cameras alongside stream"
              className={`absolute left-4 top-20 z-20 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-3.5 py-1.5 text-xs font-semibold text-slate-200 backdrop-blur-md shadow-xl transition-all duration-300 hover:bg-white/20 hover:text-white active:scale-95 ${
                showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
              }`}
            >
              <UsersIcon className="h-3.5 w-3.5" />
              <span>Show cameras ({tiles.length})</span>
            </button>
          )}

          {layout === 'side-left' && showParticipants && (
            <div className="z-20 h-full p-4 flex flex-col justify-center">
              <SideGallery
                tiles={tiles}
                isFullscreen
                onClose={() => setShowParticipants(false)}
              />
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black h-full w-full">
            {share.track ? (
              <ShareStage share={share} />
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">
                Waiting for {share.isLocal ? 'your' : `${share.name}'s`} screen…
              </p>
            )}
          </div>

          {layout === 'side-right' && showParticipants && (
            <div className="z-20 h-full p-4 flex flex-col justify-center">
              <SideGallery
                tiles={tiles}
                isFullscreen
                onClose={() => setShowParticipants(false)}
              />
            </div>
          )}
        </div>

        {/* Fullscreen Bottom Overlay: Floating Voice Controls (Auto-Hiding) & optional Bottom filmstrip */}
        <div className="absolute left-0 right-0 bottom-0 z-30 flex flex-col items-center gap-3 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-6 pb-5 pt-8 pointer-events-none">
          {layout === 'bottom' && showParticipants && (
            <ul className="flex shrink-0 justify-center gap-2.5 overflow-x-auto max-w-full pb-1 pointer-events-auto">
              {tiles.map((tile) => (
                <li key={tile.key} className="w-36 shrink-0">
                  <StageTile tile={tile} />
                </li>
              ))}
            </ul>
          )}
          <div
            className={`flex items-center justify-center rounded-2xl border border-white/10 bg-black/70 px-4 py-2 backdrop-blur-md shadow-pop transition-all duration-300 ease-out ${
              showControls
                ? 'opacity-100 translate-y-0 pointer-events-auto'
                : 'opacity-0 translate-y-6 pointer-events-none'
            }`}
          >
            <VoiceControls size="sm" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-row gap-3">
        {/* Left Side Gallery (Teams / Meet style) */}
        {layout === 'side-left' && showParticipants && (
          <SideGallery tiles={tiles} onClose={() => setShowParticipants(false)} />
        )}

        {/* Center Screen Share Stage */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-black">
          {share.track ? (
            <ShareStage share={share} />
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-slate-400">
              Waiting for {share.isLocal ? 'your' : `${share.name}'s`} screen…
            </p>
          )}

          <p className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-slate-200">
            {share.isLocal ? 'Your screen' : `${share.name}'s screen`}
          </p>

          {/* Floating Show Cameras pill in normal view when hidden */}
          {!showParticipants && (
            <button
              type="button"
              onClick={() => setShowParticipants(true)}
              title="Show cameras alongside stream"
              className="absolute left-2 top-10 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur-md shadow-lg transition-all duration-200 hover:bg-white/20 hover:text-white"
            >
              <UsersIcon className="h-3.5 w-3.5" />
              <span>Show cameras ({tiles.length})</span>
            </button>
          )}

          <div className="absolute right-2 top-2 flex gap-2">
            {!share.isLocal && <ControlButtons share={share} />}
            {share.isLocal && (
              <button
                type="button"
                onClick={() => void stopScreenShare()}
                className="cursor-pointer rounded-md bg-red-500/90 px-3 py-1 text-xs font-semibold text-white transition-colors duration-200 hover:bg-red-500"
              >
                Stop sharing
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowParticipants((prev) => !prev)}
              aria-label={showParticipants ? 'Hide cameras' : 'Show cameras'}
              title={showParticipants ? 'Hide cameras' : 'Show cameras'}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium backdrop-blur-md shadow-md transition-all duration-200 active:scale-95 ${
                showParticipants
                  ? 'bg-white/15 text-white'
                  : 'bg-black/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              <UsersIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {showParticipants ? 'Hide cameras' : 'Cameras'}
              </span>
              <span>({tiles.length})</span>
            </button>
            <button
              type="button"
              onClick={cycleLayout}
              title={`Layout: ${
                layout === 'side-left'
                  ? 'Left Side Gallery'
                  : layout === 'side-right'
                    ? 'Right Side Gallery'
                    : 'Bottom Dock'
              } (Click to switch)`}
              className="flex cursor-pointer items-center gap-1 rounded-md bg-black/70 px-2.5 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black"
            >
              {layout === 'side-left' ? (
                <LayoutSidebarIcon className="h-3.5 w-3.5" />
              ) : layout === 'side-right' ? (
                <LayoutSidebarIcon className="h-3.5 w-3.5 scale-x-[-1]" />
              ) : (
                <LayoutBottomIcon className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {layout === 'side-left' ? 'Left' : layout === 'side-right' ? 'Right' : 'Bottom'}
              </span>
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label="Full screen"
              title="Full screen (F)"
              className="flex cursor-pointer items-center gap-1 rounded-md bg-black/70 px-3 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black"
            >
              <MaximizeIcon className="h-3.5 w-3.5" />
              Full screen
            </button>
            <button
              type="button"
              onClick={() => watch(null)}
              className="cursor-pointer rounded-md bg-black/70 px-3 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black"
            >
              Back to grid
            </button>
          </div>
        </div>

        {/* Right Side Gallery */}
        {layout === 'side-right' && showParticipants && (
          <SideGallery tiles={tiles} onClose={() => setShowParticipants(false)} />
        )}
      </div>

      {/* Bottom Filmstrip (when layout is set to 'bottom') */}
      {layout === 'bottom' && showParticipants && (
        <ul className="flex shrink-0 gap-2 overflow-x-auto pb-1">
          {tiles.map((tile) => (
            <li key={tile.key} className="w-40 shrink-0">
              <StageTile tile={tile} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Side Gallery Rail (Teams / Meet style) for prominent webcam projection */
function SideGallery({
  tiles,
  isFullscreen = false,
  onClose,
}: {
  tiles: Stage[];
  isFullscreen?: boolean;
  onClose?: () => void;
}): JSX.Element {
  return (
    <div
      className={`flex flex-col gap-2 overflow-hidden max-h-full shrink-0 ${
        isFullscreen
          ? 'w-64 sm:w-72 md:w-80 rounded-2xl border border-white/10 bg-black/70 p-2.5 backdrop-blur-md shadow-pop'
          : 'w-56 sm:w-64 md:w-72 rounded-lg border border-white/10 bg-surface-900/80 p-2 backdrop-blur-sm'
      }`}
    >
      {onClose && (
        <div className="flex items-center justify-between pb-1 px-1 border-b border-white/10 text-slate-300 text-xs">
          <span className="font-semibold text-slate-200">Cameras ({tiles.length})</span>
          <button
            type="button"
            onClick={onClose}
            title="Hide cameras to make stream full screen"
            className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-white rounded px-1.5 py-0.5 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <span>Hide</span>
            <ChevronLeftIcon className="h-3 w-3" />
          </button>
        </div>
      )}
      <ul className="flex flex-col gap-2.5 overflow-y-auto max-h-full pr-0.5">
        {tiles.map((tile) => (
          <li key={tile.key} className="w-full shrink-0">
            <StageTile tile={tile} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "I can see your screen, now let me drive" - the thought that follows watching
 * a share often enough to be worth a button, and the reason somebody shares a
 * screen in the first place when they are stuck.
 *
 * Two doors, and they are not the same door:
 *
 * - **Request control** asks the person sharing, right now, over the call. It
 *   needs nothing set up beforehand and grants nothing afterwards: it lasts as
 *   long as the share does, works on the screen they are already showing, and
 *   either side ends it with one click. This is the one for helping somebody.
 * - **Open a session** is the remote-desktop path, for a machine this account
 *   was granted standing access to. It survives the call, reaches the whole
 *   machine rather than the shared screen, and is audited. It only appears when
 *   such a grant already exists - and only in the Electron app, because the
 *   remote-desktop section is what a browser tab does not get (see
 *   services/platform.ts). A tab therefore never asks for the machine list
 *   either: `/api/v1/remote` is not in the web client's proxy table on purpose.
 */
function ControlButtons({ share }: { share: VoiceShare }): JSX.Element {
  const machines = useRemoteStore((state) => state.machines);
  const load = useRemoteStore((state) => state.load);
  const connectToOwner = useRemoteStore((state) => state.connectToOwner);
  const session = useRemoteStore((state) => state.session);

  const asking = useShareControlStore((state) => state.asking);
  const driving = useShareControlStore((state) => state.driving);
  const refusal = useShareControlStore((state) => state.refusal);
  const ask = useShareControlStore((state) => state.ask);
  const stop = useShareControlStore((state) => state.stop);

  const onDesktop = isDesktopRuntime();

  useEffect(() => {
    if (onDesktop) void load();
  }, [load, onDesktop]);

  // Control is asked of a *connection*; a machine belongs to a *person*. One
  // account with two windows open is two peers and one owner, so these two
  // lines deliberately key off different ids.
  const controlling = driving === share.identity;
  const machine = onDesktop
    ? machines.find((candidate) => candidate.ownerId === share.userId)
    : undefined;

  return (
    <>
      {refusal && !controlling && (
        <span className="rounded-md bg-black/70 px-2 py-1 text-xs text-amber-300">{refusal}</span>
      )}

      <button
        type="button"
        disabled={asking}
        onClick={() => (controlling ? stop() : ask({ identity: share.identity, name: share.name }))}
        title={
          controlling
            ? 'Hand the mouse back (Esc)'
            : `Ask ${share.name} for the mouse and keyboard on this screen`
        }
        className={`cursor-pointer rounded-md px-3.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
          controlling
            ? 'bg-amber-600/90 text-white hover:bg-amber-600 hover:shadow-amber-500/20'
            : asking
              ? 'bg-accent/70 text-white animate-pulse'
              : 'bg-accent text-white hover:brightness-110 hover:shadow-accent/20'
        }`}
      >
        {controlling ? 'Release control (Esc)' : asking ? 'Asking…' : 'Request control'}
      </button>

      {machine && !session && (
        <button
          type="button"
          disabled={!machine.online}
          title={
            machine.online
              ? `Open a remote session on ${machine.name}`
              : `${machine.name} is offline`
          }
          onClick={() => void connectToOwner(share.userId, true)}
          className="cursor-pointer rounded-md bg-black/70 px-3 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          Open a session
        </button>
      )}
    </>
  );
}

/** Nine at a time with pager arrows, rather than tiles shrinking to nothing. */
function PagedGrid({ tiles }: { tiles: Stage[] }): JSX.Element {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(tiles.length / PAGE_SIZE));
  // People leave; the page they were on can vanish under the pager.
  const current = Math.min(page, pages - 1);
  const shown = tiles.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
      <ul className="grid w-full max-w-5xl auto-rows-fr grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        {shown.map((tile) => (
          <li key={tile.key}>
            <StageTile tile={tile} />
          </li>
        ))}
      </ul>

      {pages > 1 && (
        <nav aria-label="Participant pages" className="flex shrink-0 items-center gap-3">
          <PagerButton
            label="Previous participants"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </PagerButton>
          <span className="text-xs text-slate-400">
            {current + 1} / {pages}
          </span>
          <PagerButton
            label="More participants"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </PagerButton>
        </nav>
      )}
    </div>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="cursor-pointer rounded-md bg-surface-800 p-2 text-slate-300 transition-colors duration-200 hover:bg-surface-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function StageTile({ tile }: { tile: Stage }): JSX.Element {
  return (
    <div
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-surface-800 ring-2 transition-colors duration-200 ${
        tile.speaking ? 'ring-amber-400' : 'ring-transparent'
      }`}
    >
      {tile.videoTrack ? (
        <VideoSink track={tile.videoTrack} />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-700 text-xl font-semibold text-slate-200"
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

      {tile.speaking && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400">
          <span className="sr-only">speaking</span>
        </span>
      )}
    </div>
  );
}
