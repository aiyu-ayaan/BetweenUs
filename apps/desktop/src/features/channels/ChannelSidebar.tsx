import { useState } from 'react';
import type { Channel, ChannelType } from '@betweenus/shared-types';
import { PERMISSIONS } from '@betweenus/permissions';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { VoicePanel } from '../voice/VoicePanel';
import { UserPanel } from '../settings/UserPanel';
import { CreateChannelDialog } from './CreateChannelDialog';
import {
  CheckIcon,
  ChevronDownIcon,
  HashIcon,
  LockIcon,
  PlusIcon,
  SettingsIcon,
  SpeakerIcon,
  XIcon,
} from '../../components/icons';

interface ShowcaseDirect {
  name: string;
  activity: string;
  bg: string;
  statusDot: string;
}

const SHOWCASE_DMS: ShowcaseDirect[] = [
  {
    name: 'aiyu',
    activity: 'Listening to Lofi Beats',
    bg: 'bg-indigo-600',
    statusDot: 'bg-emerald-400',
  },
  {
    name: 'alex',
    activity: 'In Lounge • Carrom match',
    bg: 'bg-emerald-600',
    statusDot: 'bg-emerald-400',
  },
  {
    name: 'sophia',
    activity: 'Reviewing benchmarks',
    bg: 'bg-amber-600',
    statusDot: 'bg-amber-400',
  },
  {
    name: 'marcus',
    activity: 'Testing WebRTC mesh',
    bg: 'bg-purple-600',
    statusDot: 'bg-purple-400',
  },
];

const DEFAULT_TEXT_CHANNELS = [
  { id: 'general', name: 'general', isPrivate: true, unread: 0 },
  { id: 'releases', name: 'releases', isPrivate: false, unread: 1 },
  { id: 'engineering', name: 'engineering', isPrivate: false, unread: 4 },
  { id: 'architecture', name: 'architecture', isPrivate: false, unread: 0 },
  { id: 'security-audits', name: 'security-audits', isPrivate: false, unread: 0 },
];

export function ChannelSidebar({
  onOpenUserSettings,
  onOpenServerSettings,
  className = 'w-64',
}: {
  onOpenUserSettings: () => void;
  onOpenServerSettings: () => void;
  className?: string;
}): JSX.Element {
  const { servers, channels, activeServerId, activeChannelId, unread, selectChannel } =
    useChatStore();

  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const server = servers.find((item) => item.id === activeServerId);
  const canManageChannels = server?.permissions.includes(PERMISSIONS.MANAGE_CHANNEL) ?? false;

  const textChannels = channels.filter((channel) => channel.type === 'TEXT');
  const voiceChannels = channels.filter((channel) => channel.type === 'VOICE');

  // Display text channels from store or default list
  const displayedTextChannels =
    textChannels.length > 0
      ? textChannels
      : DEFAULT_TEXT_CHANNELS.map((item) => ({
          id: item.id,
          name: item.name,
          serverId: server?.id ?? 'betweenus-hq',
          type: 'TEXT' as const,
          position: 0,
          isPrivate: item.isPrivate,
          createdAt: '2026-09-18T00:00:00.000Z',
          updatedAt: '2026-09-18T00:00:00.000Z',
        }));

  return (
    <aside className={`panel flex shrink-0 flex-col bg-surface-900 border-e border-edge/60 ${className}`}>
      <ServerHeader
        name={server?.name ?? 'BetweenUs HQ'}
        open={menuOpen}
        onToggle={() => setMenuOpen((value) => !value)}
        onOpenSettings={() => {
          setMenuOpen(false);
          onOpenServerSettings();
        }}
      />

      <nav aria-label="Channels" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {/* Text Channels Section */}
        <SectionHeading
          label="TEXT CHANNELS"
          onAdd={canManageChannels ? () => setCreating('TEXT') : undefined}
          addLabel="Create text channel"
        />

        <div className="space-y-0.5">
          {displayedTextChannels.map((channel) => {
            const isActive = activeChannelId === channel.id || (!activeChannelId && channel.name === 'general');
            const unreadCount = unread[channel.id] ?? (channel.name === 'releases' ? 1 : channel.name === 'engineering' ? 4 : 0);

            return (
              <button
                key={channel.id}
                type="button"
                onClick={() => void selectChannel(channel.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] font-medium transition-all duration-150 active:scale-[0.98] ${
                  isActive
                    ? 'border border-accent/20 bg-accent/20 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                }`}
              >
                <HashIcon className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent' : 'text-slate-500'}`} />
                <span className={`truncate flex-1 ${isActive ? 'font-semibold text-white' : ''}`}>
                  {channel.name}
                </span>
                {channel.isPrivate && (
                  <LockIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                )}
                {unreadCount > 0 && (
                  <span className="ms-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-sm">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Voice Channels Section */}
        <SectionHeading
          label="VOICE CHANNELS"
          onAdd={canManageChannels ? () => setCreating('VOICE') : undefined}
          addLabel="Create voice channel"
        />

        <div className="space-y-1">
          {/* Active Lounge Room with Speaking Tree */}
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2 shadow-sm">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-400">
              <span className="flex items-center gap-1.5">
                <SpeakerIcon className="h-3.5 w-3.5 text-emerald-400" />
                Lounge
              </span>
              <span className="font-mono text-[11px] text-emerald-400/80">[3/8]</span>
            </div>
            <div className="mt-2 space-y-1.5 ps-2">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span>aiyu (speaking)</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span>alex (speaking)</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="h-2 w-2 rounded-full bg-slate-500" />
                <span>sophia</span>
              </div>
            </div>
          </div>

          {/* Other Voice Rooms */}
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] text-slate-400 transition-colors duration-150 hover:bg-white/[0.05] hover:text-slate-200"
          >
            <SpeakerIcon className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="truncate">Stage & Pair Prog</span>
          </button>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] text-slate-400 transition-colors duration-150 hover:bg-white/[0.05] hover:text-slate-200"
          >
            <SpeakerIcon className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="truncate">Daily Standup</span>
          </button>

          {voiceChannels.filter((c) => c.name !== 'Lounge').map((channel) => (
            <VoiceChannelRow key={channel.id} channel={channel} />
          ))}
          <VoiceError />
        </div>

        {/* Direct Messages Section */}
        <SectionHeading label="DIRECT MESSAGES" />

        <div className="space-y-1 pt-0.5">
          {SHOWCASE_DMS.map((dm) => (
            <div
              key={dm.name}
              className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-white/[0.05] active:scale-[0.98]"
            >
              <div className="relative shrink-0">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-sm ${dm.bg}`}
                >
                  {dm.name[0]?.toUpperCase()}
                </div>
                <span
                  className={`absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-900 ${dm.statusDot}`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-200 group-hover:text-white">
                  {dm.name}
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  {dm.activity}
                </p>
              </div>
            </div>
          ))}
        </div>
      </nav>

      <VoicePanel />
      <UserPanel onOpenSettings={onOpenUserSettings} />

      {creating && (
        <CreateChannelDialog type={creating} onClose={() => setCreating(null)} />
      )}
    </aside>
  );
}

function ServerHeader({
  name,
  open,
  onToggle,
  onOpenSettings,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}): JSX.Element {
  const activeServerId = useChatStore((state) => state.activeServerId);
  const servers = useChatStore((state) => state.servers);
  const leaveServer = useChatStore((state) => state.leaveServer);
  const server = servers.find((item) => item.id === activeServerId);
  const isOwner = server?.role === 'OWNER';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-14 w-full cursor-pointer items-center justify-between border-b border-edge/60 px-4 text-start transition-colors duration-200 hover:bg-white/[0.05]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-bold text-slate-100">{name}</h2>
            <span
              className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm"
              title="Verified E2EE Mesh"
            >
              <CheckIcon className="h-2 w-2 stroke-[3]" />
            </span>
          </div>
          <p className="truncate text-[11px] font-medium text-slate-400">
            24 Online • E2EE Mesh
          </p>
        </div>
        {open ? (
          <XIcon className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute inset-x-2 top-full z-30 mt-1 animate-pop overflow-hidden rounded-xl border border-edge bg-surface-950 py-1.5 shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onOpenSettings}
            className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm text-slate-200 hover:bg-accent hover:text-white"
          >
            Server settings
            <SettingsIcon className="h-4 w-4" />
          </button>
          {!isOwner && (
            <button
              type="button"
              role="menuitem"
              onClick={() => void leaveServer()}
              className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm text-danger hover:bg-danger hover:text-white"
            >
              Leave server
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SectionHeading({
  label,
  onAdd,
  addLabel,
}: {
  label: string;
  onAdd?: () => void;
  addLabel?: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-1 pb-1.5 pt-3.5">
      <span className="text-[11px] font-bold tracking-wider text-slate-400">{label}</span>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="cursor-pointer rounded-md p-0.5 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 active:scale-95"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function VoiceChannelRow({ channel }: { channel: Channel }): JSX.Element {
  const members = useChatStore((state) => state.members);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const selectChannel = useChatStore((state) => state.selectChannel);
  const occupants = usePresenceStore((state) => state.voice.get(channel.id) ?? []);
  const join = useVoiceStore((state) => state.join);
  const status = useVoiceStore((state) => state.status);
  const connectedTo = useVoiceStore((state) => state.channelId);

  const here = connectedTo === channel.id && status === 'connected';
  const connectingHere = connectedTo === channel.id && status === 'connecting';
  const viewing = activeChannelId === channel.id;

  const open = (): void => {
    void selectChannel(channel.id);
    if (connectedTo !== channel.id) void join(channel.id);
  };

  return (
    <div>
      <button
        type="button"
        onClick={open}
        aria-current={viewing ? 'page' : undefined}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] transition-colors duration-150 ${
          here || connectingHere || viewing ? 'bg-accent/20 text-white font-medium' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
        }`}
      >
        <SpeakerIcon className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="truncate">{channel.name}</span>
        {connectingHere && (
          <span className="animate-pulse text-xs text-status-online">connecting…</span>
        )}
        {occupants.length > 0 && (
          <span className="ms-auto text-xs text-slate-500">{occupants.length}</span>
        )}
      </button>

      {occupants.length > 0 && (
        <ul className="space-y-0.5 ps-7">
          {occupants.map((userId) => {
            const member = members.find((item) => item.userId === userId);
            return (
              <li key={userId} className="truncate py-0.5 text-xs text-slate-400">
                {member?.displayName ?? 'Someone'}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function VoiceError(): JSX.Element | null {
  const error = useVoiceStore((state) => state.error);
  if (!error) return null;

  return (
    <div
      role="alert"
      className="mx-1 mt-1 flex items-start justify-between gap-1.5 rounded bg-danger/10 px-2 py-1.5 text-xs text-danger"
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
  );
}
