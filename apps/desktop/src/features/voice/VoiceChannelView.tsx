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
 * The grid pages at nine tiles rather than shrinking forever. Whoever spoke
 * most recently is pulled to the front only when there is a page two to be
 * pulled onto: while everybody fits on one page, moving faces around buys
 * nothing and costs the reader their place, so the order stays put.
 *
 * The grid is the *other* people. Your own camera is a small floating window
 * over the corner of it - you are not in the call to watch yourself - and any
 * one person can be pinned to fill the stage with everybody else in a strip
 * underneath.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Channel } from '@betweenus/shared-types';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useRemoteStore } from '../../stores/remote';
import { CHORD_LABEL, localChordOf } from '../../services/keyboard';
import { useShareControlStore } from '../../stores/shareControl';
import { useVoiceStore, type VoiceShare, type VoiceTile } from '../../stores/voice';
import { useAudioSettings } from '../../stores/audioSettings';
import { CameraLook, CameraLookButton } from './CameraLook';
import { CallDuration } from './CallDuration';
import { VoiceControls } from './VoiceControls';
import { NotHeardNotice } from './NotHeardNotice';
import { VideoSink } from './MediaSink';
import { ShareStage } from './ShareStage';
import { PAGE_SIZE, orderStage, splitStage } from './stage-order';
import { ListenBar, ListenPanel } from './ListenPanel';
import { GameBar, GamePanel } from './GamePanel';
import { AppsPanel } from './AppsPanel';
import { useAppsStore } from '../../stores/apps';
import { useListenStore } from '../../stores/listen';
import { useGameStore } from '../../stores/game';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HashIcon,
  LayoutBottomIcon,
  LayoutSidebarIcon,
  LockIcon,
  MaximizeIcon,
  MenuIcon,
  MicOffIcon,
  MinimizeIcon,
  PinIcon,
  ScreenShareIcon,
  SpeakerIcon,
  UsersIcon,
  XIcon,
} from '../../components/icons';

interface Stage {
  key: string;
  name: string;
  isLocal: boolean;
  speaking: boolean;
  micEnabled: boolean;
  /** Pulled off the call by another one - see `VoiceTile.held`. */
  held: boolean;
  videoTrack: MediaStreamTrack | null;
  lastSpokeAt: number;
}

export function VoiceChannelView({
  channel,
  onOpenMenu,
}: {
  channel: Channel;
  onOpenMenu?: () => void;
}): JSX.Element {
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
  const notHeard = useVoiceStore((state) => state.notHeard);

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
        held: false,
        videoTrack: null,
        lastSpokeAt: 0,
      }));

  const ordered = useOrderedStage(stage);

  // Pinned by hand, and only for as long as they are in the call - a pin left
  // on somebody who hung up would hold an empty stage.
  const [pinned, setPinned] = useState<string | null>(null);
  const present = stage.map((tile) => tile.key).join(',');
  useEffect(() => {
    if (pinned !== null && !present.split(',').includes(pinned)) setPinned(null);
  }, [pinned, present]);

  const listenOpen = useListenStore((state) => state.open);
  const gameOpen = useGameStore((state) => state.open);
  const gameFullscreen = useGameStore((state) => state.fullscreen);
  const appsOpen = useAppsStore((state) => state.open);
  const watched = connected ? (shares.find((share) => share.identity === watching) ?? null) : null;

  return (
    <section className="panel flex min-w-0 flex-1 flex-col bg-surface-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-2.5 md:px-4">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            title="Open menu"
            className="flex h-9 w-9 min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md text-slate-300 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 md:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        )}
        <SpeakerIcon className="h-5 w-5 text-slate-400 shrink-0" />
        <h1 className="truncate font-semibold text-slate-100">{channel.name}</h1>
        {stage.length > 0 && <span className="hidden sm:inline text-sm text-slate-400">- {stage.length} in voice</span>}
        {/* Only while *this* client is in the call: a clock counting somebody
            else's call, in a channel being looked at from outside it, would be
            a number with no meaning to whoever is reading it. */}
        {connected && (
          <span className="ms-auto text-xs">
            <CallDuration />
          </span>
        )}
        {connected && encrypted && (
          <span
            title="Voice media is encrypted on this device"
            className="flex items-center gap-1 text-xs text-emerald-300"
          >
            <LockIcon className="h-3.5 w-3.5" />
            E2EE
          </span>
        )}

        <button
          type="button"
          onClick={() => {
            const channels = useChatStore.getState().channels;
            const textChannel = channels.find(
              (c) => c.serverId === channel.serverId && c.type === 'TEXT',
            );
            if (textChannel) {
              void useChatStore.getState().selectChannel(textChannel.id);
            }
          }}
          className={`${connected ? 'ms-2' : 'ms-auto'} flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white min-h-[36px] cursor-pointer`}
          title="Back to text channel"
        >
          <HashIcon className="h-3.5 w-3.5 text-slate-400" />
          <span className="hidden sm:inline">Text chat</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            <span className="min-w-0 flex-1 text-center">{error}</span>
            <button
              type="button"
              onClick={() => useVoiceStore.getState().dismissError()}
              className="inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-red-300/70 transition-colors hover:bg-red-500/20 hover:text-red-100"
              title="Dismiss error"
              aria-label="Dismiss error"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {notHeard && (
          <div className="mx-auto w-full max-w-sm">
            <NotHeardNotice />
          </div>
        )}

        <ShareBanners shares={shares} watching={watching} />

        {/* Above the tiles rather than replacing them: a shared video and the
            faces watching it are the same activity, and hiding one to show the
            other is what makes a group watch feel like a broadcast. It draws
            nothing when nobody has started a queue. */}
        {/* One line saying what is playing, while the panel is closed - so the
            call goes back to being a call and the music is still visibly a
            thing that is happening. Draws nothing when nothing is. */}
        <ListenBar />

        {/* And one line saying what is on the table, on the same terms. It says
            whose move it is, which is the only part of a game anybody needs
            while they are looking at faces. */}
        <GameBar />

        {/* Listening takes the stage while it is open. Picking the next track
            is a thing somebody does with their whole attention for twenty
            seconds, and shrinking YouTube into a corner to keep nine faces on
            screen serves neither; the tiles come straight back on closing it.
            It is also the *only* place this panel is drawn - see the note on
            the button in VoiceControls. */}
        {appsOpen && connected ? (
          /* The chooser, on the stage rather than in a popover: a six-game
             library does not fit in one, and a menu over a call covers the
             faces it is supposed to sit beside. */
          <AppsPanel />
        ) : listenOpen && connected ? (
          <ListenPanel />
        ) : gameOpen && connected && !gameFullscreen ? (
          /* One stage, one thing on it - opening either panel closes the other.
             See `useGameStore.setOpen`, which is where that is decided rather
             than here, so the sidebar button obeys the same rule.

             In fullscreen the panel portals itself to the body and this slot
             draws nothing, so the stage is not laying out a board nobody can
             see behind the one that has the window. */
          <GamePanel />
        ) : stage.length === 0 ? (
          <EmptyStage />
        ) : watched ? (
          <Theatre share={watched} tiles={ordered} />
        ) : (
          <PagedGrid
            tiles={ordered}
            pinned={pinned}
            onTogglePin={(key) => setPinned((current) => (current === key ? null : key))}
          />
        )}

        {/* In fullscreen the panel portals itself to the body, so it is mounted
            here and drawn nowhere: the stage underneath goes back to being the
            call rather than laying out a board nobody can see behind the one
            that has the window. */}
        {gameOpen && connected && gameFullscreen && <GamePanel />}

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
        <footer className="flex shrink-0 justify-center px-4 py-3 z-20">
          <div className="rounded-2xl border border-white/10 bg-surface-950/90 px-4 py-2 backdrop-blur-xl shadow-2xl">
            <VoiceControls size="lg" />
          </div>
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
    held: tile.held,
    videoTrack: tile.videoTrack,
    lastSpokeAt: tile.lastSpokeAt,
  };
}

/** `orderStage` on a clock - see stage-order.ts for the rule itself. */
function useOrderedStage(stage: Stage[]): Stage[] {
  // Promotions expire on a timer, so a room that goes quiet re-settles without
  // needing an event to arrive first.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => orderStage(stage, Date.now()), [stage]);
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
            className="ms-auto shrink-0 cursor-pointer rounded-md bg-accent px-3 py-1 text-xs font-semibold text-white transition-colors duration-200 hover:brightness-110"
          >
            {share.isLocal ? 'Preview' : 'Join stream'}
          </button>
          {share.isLocal && (
            <button
              type="button"
              onClick={() => void stopScreenShare()}
              className="shrink-0 cursor-pointer rounded-md px-3 py-1 text-xs text-slate-300 transition-colors duration-200 hover:bg-white/[0.06]"
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

/**
 * One shape for every control in the full-screen strip.
 *
 * They used to each carry their own border, blur and background, which is how
 * a row ends up looking like six unrelated pills stuck to the top of somebody
 * else's desktop. The strip is the surface now; the buttons sit in it.
 */
const FS_BUTTON =
  'no-drag flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors duration-150 active:scale-95';

/** One shared screen big, everyone else small underneath or in a side rail. Movie night. */
function Theatre({ share, tiles }: { share: VoiceShare; tiles: Stage[] }): JSX.Element {
  const watch = useVoiceStore((state) => state.watch);
  const stopScreenShare = useVoiceStore((state) => state.stopScreenShare);
  const [fullscreen, setFullscreen] = useState(false);
  const [showParticipants, setShowParticipants] = useState(true);
  const [layout, setLayout] = useState<LayoutMode>('side-left');

  /**
   * Full screen is two different wishes and they pull opposite ways.
   *
   * Watching something is the common one: the picture edge to edge, nothing
   * else on screen, chrome that floats over it and gets out of the way. Docked
   * chrome cannot do that - it letterboxes the picture into a sandwich, which
   * is not what anybody means by full screen when a film is on.
   *
   * Reading somebody's screen is the other: the top of a shared desktop is its
   * title bar and its tabs, the bottom is its task bar, and floating chrome
   * sits on exactly those, so it has to be possible to put it away and have it
   * stay away - and **Release control** has to stay reachable for somebody
   * whose keyboard is busy driving another machine.
   *
   * So both, with a button, and immersive by default because watching is what
   * full screen usually means. Docked never hides: it has its own space and
   * nothing to gain by disappearing.
   */
  const [docked, setDocked] = useState(false);
  /**
   * Shown or hidden by a small button, and auto-hidden after 3 seconds.
   *
   * The button is the only thing that brings the controls back — not mouse
   * movement, not keyboard input. A pointer crossing the picture on its way
   * somewhere else is not a request for a toolbar, and a keystroke on its way
   * to the machine being driven is not either.
   */
  const [showControls, setShowControls] = useState(true);
  const [controlsHovered, setControlsHovered] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  // Driving somebody's machine docks it whatever the button says, and the
  // button says so. Chrome that fades is chrome that takes Release control with
  // it, and floating chrome is a strip of this app sitting over the machine you
  // are clicking into - both are wrong in the one mode where every pixel has to
  // be readable and every control reachable.
  const driving = useShareControlStore((state) => state.driving) !== null;
  const immersive = fullscreen && !docked && !driving;

  // Auto-hide after 3 seconds in immersive mode when controls are not hovered.
  // When the mouse pointer is over the controls (e.g. adjusting volume, scrubbing,
  // or clicking buttons), auto-hide is suspended so controls never vanish during use.
  useEffect(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (immersive && showControls && !controlsHovered) {
      hideTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
        hideTimerRef.current = null;
      }, 3000);
    }
    return () => {
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [immersive, showControls, controlsHovered]);

  // Leaving full screen, or docking, brings the strip back: it is the one place
  // the Exit button lives, and a mode with no way out is a trap.
  useEffect(() => {
    if (!immersive) {
      setShowControls(true);
      setControlsHovered(false);
    }
  }, [immersive]);

  /**
   * Full screen means the screen, not the window.
   *
   * A `fixed inset-0` overlay only fills the page: the task bar still sits
   * along the bottom of the shared desktop and the caption buttons still sit
   * over its top corner, which is exactly the two strips a shared screen needs
   * back. The platform already has the thing that takes them away, in both
   * modes - docked has no less claim on the screen than fill does.
   */
  useEffect(() => {
    if (fullscreen) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [fullscreen]);

  // F11, or Escape swallowed by the browser, leaves this state saying full
  // screen while the window is not - so the window is what it is read from.
  useEffect(() => {
    const sync = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  // Full screen is a chord, not the letter F. A bare key was reachable from
  // anywhere - including from a session where the keyboard belongs to somebody
  // else's machine, where typing an `f` flipped this view instead of reaching
  // them. Escape still leaves full screen, which is what Escape means
  // everywhere, but not while control is being driven: there it is a key the
  // far machine is owed.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      const driving = useShareControlStore.getState().driving !== null;
      if (localChordOf(e) === 'toggle-fullscreen') {
        e.preventDefault();
        setFullscreen((prev) => !prev);
      } else if (e.key === 'Escape' && fullscreen && !driving) {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [fullscreen]);

  const toggleFullscreen = (): void => {
    setFullscreen((prev) => !prev);
  };

  const cycleLayout = (): void => {
    setLayout((curr) =>
      curr === 'side-left' ? 'side-right' : curr === 'side-right' ? 'bottom' : 'side-left',
    );
  };

  if (fullscreen) {
    /**
     * One bar, not two.
     *
     * Everything this view can do lives in a single strip: what is on screen,
     * what you can do to it, and the call controls. Two strips - share chrome
     * along the top and the call dock along the bottom - sat on the two parts
     * of a shared desktop worth reading, its tab bar and its task bar, and
     * left whoever was looking at it guessing which of six pills was the way
     * out.
     */
    const bar = (
      <>
        <div className="flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
          </span>
          <span className="max-w-[16ch] truncate text-xs font-semibold tracking-wide text-slate-100">
            {share.isLocal ? 'Your screen' : `${share.name}'s screen`}
          </span>
        </div>

        {!share.isLocal && <ControlButtons share={share} />}
        {share.isLocal && (
          <button
            type="button"
            onClick={() => void stopScreenShare()}
            className="no-drag cursor-pointer rounded-md bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-red-500"
          >
            Stop sharing
          </button>
        )}

        <button
          type="button"
          onClick={cycleLayout}
          aria-label="Where the cameras sit"
          title={`Cameras: ${
            layout === 'side-left' ? 'left' : layout === 'side-right' ? 'right' : 'along the bottom'
          } (click to move them)`}
          className={`${FS_BUTTON} text-slate-300 hover:bg-white/10 hover:text-white`}
        >
          {layout === 'side-left' ? (
            <LayoutSidebarIcon className="h-3.5 w-3.5" />
          ) : layout === 'side-right' ? (
            <LayoutSidebarIcon className="h-3.5 w-3.5 scale-x-[-1]" />
          ) : (
            <LayoutBottomIcon className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setShowParticipants((prev) => !prev)}
          aria-pressed={showParticipants}
          aria-label={showParticipants ? 'Hide cameras' : 'Show cameras'}
          title={showParticipants ? 'Hide cameras' : 'Show cameras'}
          className={`${FS_BUTTON} ${
            showParticipants
              ? 'bg-white/15 text-white'
              : 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
          }`}
        >
          <UsersIcon className="h-3.5 w-3.5" />
          <span>{tiles.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setDocked((prev) => !prev)}
          disabled={driving}
          aria-pressed={!immersive}
          aria-label={immersive ? 'Dock the controls' : 'Fill the screen'}
          title={
            driving
              ? 'Docked while you are driving this screen, so nothing covers it and nothing fades'
              : immersive
                ? 'Dock the controls: nothing covers the shared screen, nothing fades'
                : 'Fill the screen: the picture edge to edge, controls float and fade away'
          }
          className={`${FS_BUTTON} disabled:cursor-not-allowed disabled:opacity-60 ${
            immersive
              ? 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
              : 'bg-white/15 text-white'
          }`}
        >
          <LayoutBottomIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{immersive ? 'Fill' : 'Docked'}</span>
        </button>

        <span className="mx-0.5 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />
        <VoiceControls size="sm" />
        <span className="mx-0.5 h-5 w-px shrink-0 bg-white/10" aria-hidden="true" />

        <button
          type="button"
          onClick={() => {
            setFullscreen(false);
            watch(null);
          }}
          title="Back to the grid of everyone in the call"
          className={`${FS_BUTTON} text-slate-300 hover:bg-white/10 hover:text-white`}
        >
          Back to grid
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label="Exit full screen"
          title={`Exit full screen (Esc or ${CHORD_LABEL['toggle-fullscreen']})`}
          className={`${FS_BUTTON} bg-white/10 font-semibold text-white hover:bg-white/20`}
        >
          <MinimizeIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Exit</span>
        </button>
      </>
    );

    const filmstrip = layout === 'bottom' && showParticipants && (
      <ul className="pointer-events-auto flex max-w-full shrink-0 justify-center gap-2.5 overflow-x-auto pb-1">
        {tiles.map((tile) => (
          <li key={tile.key} className="w-36 shrink-0">
            <StageTile tile={tile} />
          </li>
        ))}
      </ul>
    );

    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-black select-none no-drag"
      >
        {/* Docked puts the strip above the picture, where it covers nothing -
            which is the whole point of the mode: the shared desktop's own top
            and bottom stay readable while somebody is driving it. No caption
            inset: the window is natively full screen here, so there are no
            window buttons in that corner to leave room for. */}
        {!immersive && (
          <div className="no-drag relative z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-surface-900 px-3 py-2">
            {bar}
          </div>
        )}

        <div
          className={`relative flex min-h-0 w-full flex-1 flex-row items-stretch justify-center overflow-hidden bg-black ${
            immersive ? 'gap-0 p-0' : 'gap-3 p-3'
          }`}
        >
          {layout === 'side-left' && showParticipants && (
            <div className={`z-20 flex h-full flex-col justify-center ${immersive ? 'p-4' : ''}`}>
              <SideGallery tiles={tiles} isFullscreen onClose={() => setShowParticipants(false)} />
            </div>
          )}

          {/* Docked, the picture gets a frame: inset on black it has no edge of
              its own, and without one there is no telling where the shared
              desktop stops and this app starts. Immersive it fills everything,
              where a border would only be a line drawn round the screen. */}
          <div
            className={`relative flex h-full min-h-0 w-full flex-1 items-center justify-center overflow-hidden bg-black ${
              immersive ? '' : 'rounded-lg border border-white/10'
            }`}
          >
            {share.track ? (
              <ShareStage share={share} />
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">
                Waiting for {share.isLocal ? 'your' : `${share.name}'s`} screen…
              </p>
            )}
          </div>

          {layout === 'side-right' && showParticipants && (
            <div className={`z-20 flex h-full flex-col justify-center ${immersive ? 'p-4' : ''}`}>
              <SideGallery tiles={tiles} isFullscreen onClose={() => setShowParticipants(false)} />
            </div>
          )}
        </div>

        {/* A tiny toggle dot — always visible at low opacity so the shared
            content is not distracted, but always reachable. When the controls
            are hidden it becomes a bit more opaque so somebody looking for it
            can find it. Clicking shows the controls, which then auto-hide
            after 3 seconds. */}
        {immersive && (
          <button
            type="button"
            onMouseEnter={() => setControlsHovered(true)}
            onMouseLeave={() => setControlsHovered(false)}
            onClick={() => setShowControls((prev) => !prev)}
            aria-expanded={showControls}
            aria-label={showControls ? 'Hide controls' : 'Show controls'}
            title={showControls ? 'Hide controls' : 'Show controls'}
            className={`no-drag absolute bottom-2 left-1/2 z-40 flex h-6 w-6 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-white/10 text-slate-300 transition-all duration-300 hover:scale-110 hover:bg-white/20 hover:text-white ${
              showControls
                ? 'bg-white/10 opacity-40 hover:opacity-100'
                : 'bg-white/15 opacity-60 hover:opacity-100'
            }`}
          >
            <ChevronRightIcon
              className={`h-3 w-3 transition-transform duration-200 ${showControls ? 'rotate-90' : '-rotate-90'}`}
            />
          </button>
        )}

        {immersive ? (
          <div
            onMouseEnter={() => setControlsHovered(true)}
            onMouseLeave={() => setControlsHovered(false)}
            className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-4 pt-10 transition-all duration-300 ease-out ${
              showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
            }`}
          >
            {filmstrip}
            {/* Hidden it must also be untouchable: an invisible bar that still
                takes clicks is a row of dead pixels over the picture. */}
            <div
              onMouseEnter={() => setControlsHovered(true)}
              onMouseLeave={() => setControlsHovered(false)}
              className={`flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/75 px-3 py-2 backdrop-blur-md shadow-pop ${
                showControls ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
            >
              {bar}
            </div>
          </div>
        ) : (
          filmstrip && (
            <div className="relative z-30 flex shrink-0 justify-center border-t border-white/10 bg-surface-900 px-6 py-2">
              {filmstrip}
            </div>
          )
        )}
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

          <p className="pointer-events-none absolute start-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-slate-200">
            {share.isLocal ? 'Your screen' : `${share.name}'s screen`}
          </p>

          {/* Floating Show Cameras pill in normal view when hidden */}
          {!showParticipants && (
            <button
              type="button"
              onClick={() => setShowParticipants(true)}
              title="Show cameras alongside stream"
              className="no-drag absolute start-2 top-10 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur-md shadow-lg transition-all duration-200 hover:bg-white/20 hover:text-white"
            >
              <UsersIcon className="h-3.5 w-3.5" />
              <span>Show cameras ({tiles.length})</span>
            </button>
          )}

          <div className="absolute end-2 top-2 flex gap-2">
            {!share.isLocal && <ControlButtons share={share} />}
            {share.isLocal && (
              <button
                type="button"
                onClick={() => void stopScreenShare()}
                className="no-drag cursor-pointer rounded-md bg-red-500/90 px-3 py-1 text-xs font-semibold text-white transition-colors duration-200 hover:bg-red-500"
              >
                Stop sharing
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowParticipants((prev) => !prev)}
              aria-label={showParticipants ? 'Hide cameras' : 'Show cameras'}
              title={showParticipants ? 'Hide cameras' : 'Show cameras'}
              className={`no-drag flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium backdrop-blur-md shadow-md transition-all duration-200 active:scale-95 ${
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
              className="no-drag flex cursor-pointer items-center gap-1 rounded-md bg-black/70 px-2.5 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black"
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
              className="no-drag flex cursor-pointer items-center gap-1 rounded-md bg-black/70 px-3 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black"
            >
              <MaximizeIcon className="h-3.5 w-3.5" />
              Full screen
            </button>
            <button
              type="button"
              onClick={() => watch(null)}
              className="no-drag cursor-pointer rounded-md bg-black/70 px-3 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black"
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
      <ul className="flex flex-col gap-2.5 overflow-y-auto max-h-full pe-0.5">
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

  // Both halves of this run in a browser tab. Driving a machine is an API call,
  // a WebSocket and a peer connection - the bridge is what a machine needs to
  // *be* driven, not what a client needs to drive one. Gating the machine list
  // on the runtime hid the only way a web client had of reaching a machine at
  // all, which is the way that matters most there: a share from a tab can never
  // hand over its own mouse, so a remote session is not a lesser path on the
  // web, it is the path. See services/platform.ts.
  useEffect(() => {
    void load();
  }, [load]);

  // Control is asked of a *connection*; a machine belongs to a *person*. One
  // account with two windows open is two peers and one owner, so these two
  // lines deliberately key off different ids.
  const controlling = driving === share.identity;
  const machine = machines.find((candidate) => candidate.ownerId === share.userId);

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
            ? `Hand the mouse back (${CHORD_LABEL['release-control']})`
            : `Ask ${share.name} for the mouse and keyboard on this screen`
        }
        className={`no-drag cursor-pointer rounded-md px-3.5 py-1.5 text-xs font-semibold shadow-md backdrop-blur transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
          controlling
            ? 'bg-amber-600/90 text-white hover:bg-amber-600 hover:shadow-amber-500/20'
            : asking
              ? 'bg-accent/70 text-white animate-pulse'
              : 'bg-accent text-white hover:brightness-110 hover:shadow-accent/20'
        }`}
      >
        {controlling
          ? `Release control (${CHORD_LABEL['release-control']})`
          : asking
            ? 'Asking…'
            : 'Request control'}
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
          className="no-drag cursor-pointer rounded-md bg-black/70 px-3 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          Open a session
        </button>
      )}
    </>
  );
}

/** Compute responsive grid layout based on number of participants */
function getGridClass(count: number): string {
  if (count === 1) return 'grid grid-cols-1 w-full max-w-4xl h-full max-h-[70vh] aspect-video';
  if (count === 2) return 'grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-6xl h-full max-h-[66vh]';
  if (count <= 4) return 'grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-6xl h-full max-h-[72vh]';
  if (count <= 6) return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3 w-full max-w-7xl h-full max-h-[74vh]';
  return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3 w-full max-w-7xl h-full max-h-[78vh]';
}

/**
 * The call stage: the other people, paged, with your own camera in a small
 * floating window over the corner of it.
 *
 * Pinning one person swaps the grid for that face at full size with everybody
 * else in a strip underneath - the "no, keep looking at them" a call needs when
 * somebody is presenting, drawing, or simply the one being talked to.
 */
function PagedGrid({
  tiles,
  pinned,
  onTogglePin,
}: {
  tiles: Stage[];
  pinned: string | null;
  onTogglePin: (key: string) => void;
}): JSX.Element {
  const [page, setPage] = useState(0);
  const { self, grid, hero, strip } = splitStage(tiles, pinned);

  if (hero) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col gap-3 w-full h-full p-2">
        <div className="flex min-h-0 flex-1">
          <StageTile tile={hero} pinned onTogglePin={onTogglePin} />
        </div>
        {strip.length > 0 && (
          <ul className="flex shrink-0 gap-2 overflow-x-auto pb-1">
            {strip.map((tile) => (
              <li key={tile.key} className="h-24 w-40 shrink-0 sm:h-28 sm:w-48">
                <StageTile tile={tile} compact onTogglePin={onTogglePin} />
              </li>
            ))}
          </ul>
        )}
        {self && hero.key !== self.key && !grid.includes(self) && (
          <SelfPip tile={self} onTogglePin={onTogglePin} />
        )}
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(grid.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = grid.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);
  const gridClass = getGridClass(shown.length);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 w-full h-full p-2">
      <ul className={`${gridClass} items-stretch justify-items-stretch transition-all duration-300`}>
        {shown.map((tile) => (
          <li key={tile.key} className="flex min-h-0 min-w-0 w-full h-full">
            <StageTile tile={tile} onTogglePin={onTogglePin} />
          </li>
        ))}
      </ul>

      {self && !grid.includes(self) && <SelfPip tile={self} onTogglePin={onTogglePin} />}

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
      className="cursor-pointer rounded-lg bg-surface-800 p-2 text-slate-300 transition-all duration-200 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Your own camera, small, over the corner of the stage.
 *
 * A grid that gives your own face the same room as everybody else's spends half
 * a two-person call showing you yourself; this is the same bargain every phone
 * call app makes. It is still a real tile - mute state, speaking ring, and a
 * pin if you do want to look at yourself full size.
 */
function SelfPip({
  tile,
  onTogglePin,
}: {
  tile: Stage;
  onTogglePin: (key: string) => void;
}): JSX.Element {
  return (
    <div className="pointer-events-auto absolute bottom-3 end-3 z-30 w-32 sm:w-44 md:w-52 aspect-video drop-shadow-2xl">
      <StageTile tile={tile} compact onTogglePin={onTogglePin} />
    </div>
  );
}

/**
 * Cinematic participant card tile:
 * - Uniform height and width across participants
 * - Ambient blurred background behind video to seamlessly fill container
 * - Sharp centered contained video
 * - Speaking pulse glow and user status badges
 */
function StageTile({
  tile,
  compact = false,
  pinned = false,
  onTogglePin,
}: {
  tile: Stage;
  /** Thumbnail sizing: no floor on the height, smaller avatar and captions. */
  compact?: boolean;
  pinned?: boolean;
  onTogglePin?: (key: string) => void;
}): JSX.Element {
  // Read here rather than threaded down from the stage: every path to a tile -
  // the grid, the pip, a pin - would otherwise have to carry a prop that only
  // one tile in the call ever uses.
  const mirrorSelf = useAudioSettings((state) => state.settings.camera.mirror);
  const [look, setLook] = useState(false);
  const lookButtonRef = useRef<HTMLButtonElement>(null);

  // Only your own tile, and only while there is a picture to change: a look
  // control on somebody else's face would be one that cannot do anything.
  const canChangeLook = tile.isLocal && Boolean(tile.videoTrack);

  return (
    <div
      className={`group relative flex ${
        compact ? '' : 'min-h-[140px] sm:min-h-[160px]'
      } w-full h-full items-center justify-center overflow-hidden rounded-xl sm:rounded-2xl bg-surface-900/90 border border-white/10 shadow-2xl transition-all duration-300 ring-2 ${
        tile.speaking
          ? 'ring-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.3)]'
          : 'ring-transparent'
      }`}
    >
      {/* Pinning is a per-viewer decision - nobody else's stage moves - so it
          lives on the tile rather than in a menu. Kept visible once pinned:
          the way out of a pin has to be as findable as the way in. */}
      {onTogglePin && (
        <button
          type="button"
          onClick={() => onTogglePin(tile.key)}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${tile.name}` : `Pin ${tile.name}`}
          title={pinned ? 'Unpin' : 'Pin to the stage'}
          className={`absolute start-2 top-2 z-30 flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[11px] font-semibold backdrop-blur-md transition-all duration-200 focus-visible:opacity-100 active:scale-95 ${
            pinned
              ? 'bg-accent text-white opacity-100'
              : 'bg-black/65 text-slate-200 opacity-0 hover:bg-black/80 hover:text-white group-hover:opacity-100'
          }`}
        >
          <PinIcon className="h-3.5 w-3.5" />
          {!compact && <span>{pinned ? 'Unpin' : 'Pin'}</span>}
        </button>
      )}

      {/* The opposite corner from the pin, so neither has to move and a
          hovered tile does not put two buttons under one cursor. */}
      {canChangeLook && (
        <CameraLookButton
          ref={lookButtonRef}
          open={look}
          onToggle={() => setLook((on) => !on)}
          compact={compact}
        />
      )}
      {canChangeLook && look && (
        <CameraLook anchor={lookButtonRef.current} onClose={() => setLook(false)} />
      )}

      {tile.videoTrack ? (
        <>
          {/* Ambient blurred backdrop for luxury presentation */}
          <div className="absolute inset-0 overflow-hidden opacity-30 blur-2xl scale-125 select-none pointer-events-none">
            <VideoSink track={tile.videoTrack} fit="cover" />
          </div>
          {/* Sharp contained foreground video */}
          <div className="relative z-10 flex h-full w-full items-center justify-center">
            {/* Mirrored for your own tile only, and only when asked: seeing
                yourself the way a mirror shows you is what every video app
                does, and seeing everybody else that way would be wrong. */}
            <VideoSink track={tile.videoTrack} fit="contain" mirror={tile.isLocal && mirrorSelf} />
          </div>
        </>
      ) : (
        <div className={`relative z-10 flex flex-col items-center justify-center ${compact ? 'gap-1.5' : 'gap-3'}`}>
          <div className="relative">
            <span
              aria-hidden="true"
              className={`flex ${
                compact ? 'h-10 w-10 text-base' : 'h-16 w-16 sm:h-24 sm:w-24 text-xl sm:text-3xl'
              } items-center justify-center rounded-full bg-gradient-to-br from-indigo-600/80 to-purple-600/80 font-bold text-white shadow-xl border border-white/20 select-none`}
            >
              {tile.name.charAt(0).toUpperCase()}
            </span>
            {tile.speaking && (
              <span className="absolute inset-0 rounded-full animate-ping ring-2 ring-emerald-400 opacity-60 pointer-events-none" />
            )}
          </div>
          <span className="text-sm font-medium text-slate-300 select-none max-w-[180px] truncate">
            {tile.name}
          </span>
        </div>
      )}

      {/* Bottom User info pill badge */}
      <div className="absolute bottom-2 start-2 sm:bottom-3 sm:start-3 z-20 flex items-center gap-1.5 rounded-lg sm:rounded-xl bg-black/65 px-2 py-0.5 sm:px-2.5 sm:py-1 text-xs font-medium text-slate-200 backdrop-blur-md border border-white/10 shadow-md">
        {!tile.micEnabled && <MicOffIcon className="h-3.5 w-3.5 text-red-400 shrink-0" />}
        <span className="truncate max-w-[140px]">
          {tile.name}
          {tile.isLocal && ' (you)'}
        </span>
        {/* Said rather than shown as a mute: they did not choose it, and it
            ends when the call that took them does. */}
        {tile.held && <span className="shrink-0 text-amber-300">on hold</span>}
      </div>

      {/* Speaking status indicator */}
      {tile.speaking && (
        <div className="absolute end-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 backdrop-blur-md border border-emerald-500/30">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          {!compact && (
            <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
              Speaking
            </span>
          )}
        </div>
      )}
    </div>
  );
}
