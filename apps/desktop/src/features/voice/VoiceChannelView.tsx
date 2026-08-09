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
import { useEffect, useMemo, useState } from 'react';
import type { Channel } from '@nexora/shared-types';
import type { Track } from 'livekit-client';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useRemoteStore } from '../../stores/remote';
import { useShareControlStore } from '../../stores/shareControl';
import { useVoiceStore, type VoiceShare, type VoiceTile } from '../../stores/voice';
import { VoiceControls } from './VoiceControls';
import { VideoSink } from './MediaSink';
import { ShareStage } from './ShareStage';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LockIcon,
  MicOffIcon,
  ScreenShareIcon,
  SpeakerIcon,
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
  videoTrack: Track | null;
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

  // Connected: LiveKit knows who is really in the room and carries their media.
  // Otherwise fall back to the presence roster, which has names but no tracks.
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
    <section className="flex min-w-0 flex-1 flex-col bg-gradient-to-b from-[#1e1b4b] via-surface-950 to-surface-950">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/30 px-4">
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
        <footer className="flex shrink-0 justify-center border-t border-black/30 bg-black/30 px-4 py-3">
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

/** One shared screen big, everyone else small underneath. Movie night. */
function Theatre({ share, tiles }: { share: VoiceShare; tiles: Stage[] }): JSX.Element {
  const watch = useVoiceStore((state) => state.watch);
  const stopScreenShare = useVoiceStore((state) => state.stopScreenShare);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
            onClick={() => watch(null)}
            className="cursor-pointer rounded-md bg-black/70 px-3 py-1 text-xs text-slate-200 transition-colors duration-200 hover:bg-black"
          >
            Back to grid
          </button>
        </div>
      </div>

      {/* The filmstrip stays narrow: the screen is the point, the faces are context. */}
      <ul className="flex shrink-0 gap-2 overflow-x-auto pb-1">
        {tiles.map((tile) => (
          <li key={tile.key} className="w-40 shrink-0">
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
 *   such a grant already exists.
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

  useEffect(() => {
    void load();
  }, [load]);

  const controlling = driving === share.identity;
  const machine = machines.find((candidate) => candidate.ownerId === share.identity);

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
        className={`cursor-pointer rounded-md px-3 py-1 text-xs font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
          controlling
            ? 'bg-surface-600 text-slate-100 hover:bg-surface-500'
            : 'bg-accent text-white hover:brightness-110'
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
          onClick={() => void connectToOwner(share.identity, true)}
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
