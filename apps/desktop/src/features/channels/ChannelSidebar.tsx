import { useState } from 'react';
import type { Channel, ChannelType } from '@betweenus/shared-types';
import { PERMISSIONS } from '@betweenus/permissions';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { VoicePanel } from '../voice/VoicePanel';
import { UserPanel } from '../settings/UserPanel';
import { CreateChannelDialog } from './CreateChannelDialog';
import { Avatar } from '../../components/Avatar';
import { DraftLabel } from '../../components/DraftLabel';
import { useDrafted } from '../../services/drafts';
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

export function ChannelSidebar({
  onOpenUserSettings,
  onOpenServerSettings,
  onNavigate,
  className = 'w-60',
}: {
  onOpenUserSettings: () => void;
  onOpenServerSettings: () => void;
  /** Called on any click in the channel list - see `ServerRail`'s prop of
      the same name for why this can't just be an effect on the chat store. */
  onNavigate?: () => void;
  className?: string;
}): JSX.Element {
  const { servers, channels, activeServerId, activeChannelId, unread, selectChannel } =
    useChatStore();

  const hasDraft = useDrafted();
  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const server = servers.find((item) => item.id === activeServerId);
  const canManageChannels = server?.permissions.includes(PERMISSIONS.MANAGE_CHANNEL) ?? false;

  const textChannels = channels.filter((channel) => channel.type === 'TEXT');
  const voiceChannels = channels.filter((channel) => channel.type === 'VOICE');

  return (
    <aside className={`panel flex shrink-0 flex-col bg-surface-900 border-e border-edge/60 ${className}`}>
      <ServerHeader
        name={server?.name ?? 'Server'}
        open={menuOpen}
        onToggle={() => setMenuOpen((value) => !value)}
        onOpenSettings={() => {
          setMenuOpen(false);
          onOpenServerSettings();
        }}
      />

      <nav
        aria-label="Channels"
        onClickCapture={onNavigate}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {/* Text Channels Section */}
        <SectionHeading
          label="TEXT CHANNELS"
          onAdd={canManageChannels ? () => setCreating('TEXT') : undefined}
          addLabel="Create text channel"
        />

        <div className="space-y-0.5">
          {textChannels.map((channel) => {
            const isActive = activeChannelId === channel.id;
            const unreadCount = unread[channel.id] ?? 0;
            const drafted = !isActive && hasDraft(channel.id);

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
                {drafted && unreadCount === 0 && <DraftLabel />}
                {unreadCount > 0 && (
                  <span className="ms-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-sm">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}

          {textChannels.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-slate-500">No text channels yet</p>
          )}
        </div>

        {/* Voice Channels Section */}
        <SectionHeading
          label="VOICE CHANNELS"
          onAdd={canManageChannels ? () => setCreating('VOICE') : undefined}
          addLabel="Create voice channel"
        />

        <div className="space-y-0.5">
          {voiceChannels.map((channel) => (
            <VoiceChannelRow key={channel.id} channel={channel} />
          ))}

          {voiceChannels.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-slate-500">No voice channels yet</p>
          )}

          <VoiceError />
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
  const members = useChatStore((state) => state.members);
  const online = usePresenceStore((state) => state.online);
  const leaveServer = useChatStore((state) => state.leaveServer);
  const server = servers.find((item) => item.id === activeServerId);
  const isOwner = server?.role === 'OWNER';

  const onlineCount = members.filter((m) => online.has(m.userId)).length;
  const subtitle =
    members.length > 0
      ? `${onlineCount} Online • ${members.length} Members`
      : 'End-to-End Encrypted';

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
            {subtitle}
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
    <div className="flex items-center justify-between px-1 pb-1 pt-3.5">
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
  const tiles = useVoiceStore((state) => state.tiles);

  const here = connectedTo === channel.id && status === 'connected';
  const connectingHere = connectedTo === channel.id && status === 'connecting';
  const viewing = activeChannelId === channel.id;
  const occupied = occupants.length > 0;

  const open = (): void => {
    void selectChannel(channel.id);
    if (connectedTo !== channel.id) void join(channel.id);
  };

  return (
    // A card, tinted green, only while somebody is actually here - an empty
    // channel stays a plain row. The tint is what makes "something is
    // happening in here" readable at a glance down a list of six channels.
    <div className={occupied ? 'rounded-lg border border-emerald-500/15 bg-emerald-500/[0.08] p-1' : ''}>
      <button
        type="button"
        onClick={open}
        aria-current={viewing ? 'page' : undefined}
        className={`spring-press flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-start text-[13px] font-medium ${
          here || connectingHere || viewing
            ? 'bg-accent/20 text-white shadow-sm'
            : occupied
              ? 'text-slate-200 hover:bg-white/[0.05]'
              : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <SpeakerIcon
            className={`h-4 w-4 shrink-0 ${here ? 'text-emerald-400' : 'text-slate-500'}`}
          />
          <span className="truncate">{channel.name}</span>
        </span>
        {connectingHere && (
          <span className="animate-pulse text-xs text-status-online">connecting…</span>
        )}
        {occupied && (
          <span className="font-mono text-xs text-emerald-400">[{occupants.length}]</span>
        )}
      </button>

      {occupied && (
        <ul className="space-y-0.5 ps-6 pt-1 pb-0.5">
          {occupants.map((userId) => {
            const member = members.find((item) => item.userId === userId);
            // Real speaking energy only exists for a call this machine has
            // joined - presence carries who is *in* a channel, not who is
            // making sound in one it never connected to.
            const speaking = here && tiles.some((tile) => tile.userId === userId && tile.speaking);
            return (
              <li key={userId} className="flex items-center gap-2 py-0.5 text-xs text-slate-300">
                <Avatar
                  name={member?.displayName ?? 'Someone'}
                  avatarUrl={member?.avatarUrl}
                  size="xs"
                  ringColour="border-surface-900"
                  viewable={false}
                />
                <span className={`truncate ${speaking ? 'font-medium text-slate-100' : ''}`}>
                  {member?.displayName ?? 'Someone'}
                </span>
                {speaking && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse-subtle rounded-full bg-emerald-400" />
                )}
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
