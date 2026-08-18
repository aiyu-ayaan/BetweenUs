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
}: {
  onOpenUserSettings: () => void;
  onOpenServerSettings: () => void;
}): JSX.Element {
  const { servers, channels, activeServerId, activeChannelId, unread, selectChannel } =
    useChatStore();

  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const server = servers.find((item) => item.id === activeServerId);
  const canManageChannels = server?.permissions.includes(PERMISSIONS.MANAGE_CHANNEL) ?? false;

  const textChannels = channels.filter((channel) => channel.type === 'TEXT');
  const voiceChannels = channels.filter((channel) => channel.type === 'VOICE');

  return (
    <aside className="panel flex w-60 shrink-0 flex-col bg-surface-800">
      <ServerHeader
        name={server?.name ?? 'No server'}
        open={menuOpen}
        onToggle={() => setMenuOpen((value) => !value)}
        onOpenSettings={() => {
          setMenuOpen(false);
          onOpenServerSettings();
        }}
      />

      <nav aria-label="Channels" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <SectionHeading
          label="Text channels"
          onAdd={canManageChannels ? () => setCreating('TEXT') : undefined}
          addLabel="Create text channel"
        />

        <div className="space-y-0.5">
          {textChannels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => void selectChannel(channel.id)}
              aria-current={channel.id === activeChannelId ? 'page' : undefined}
              className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[15px] transition-colors duration-200 ${
                channel.id === activeChannelId
                  ? 'row-active'
                  : 'row-idle'
              }`}
            >
              <ChannelGlyph channel={channel} />
              <span className={`truncate ${unread[channel.id] ? 'font-semibold text-white' : ''}`}>
                {channel.name}
              </span>
              {unread[channel.id] ? (
                <span className="ml-auto rounded-full bg-danger px-1.5 text-xs font-bold text-white">
                  {unread[channel.id]}
                  <span className="sr-only"> unread messages</span>
                </span>
              ) : null}
            </button>
          ))}
          {textChannels.length === 0 && (
            <p className="px-2 py-2 text-sm text-slate-500">No text channels yet.</p>
          )}
        </div>

        <SectionHeading
          label="Voice channels"
          onAdd={canManageChannels ? () => setCreating('VOICE') : undefined}
          addLabel="Create voice channel"
        />

        <div className="space-y-0.5">
          {voiceChannels.map((channel) => (
            <VoiceChannelRow key={channel.id} channel={channel} />
          ))}
          {voiceChannels.length === 0 && (
            <p className="px-2 py-2 text-sm text-slate-500">No voice channels yet.</p>
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

/** A private channel says so in the sidebar; that is the whole affordance. */
function ChannelGlyph({ channel }: { channel: Channel }): JSX.Element {
  const Glyph = channel.type === 'VOICE' ? SpeakerIcon : HashIcon;
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
      <Glyph className="h-5 w-5" />
      {channel.isPrivate && (
        <LockIcon className="absolute -bottom-0.5 -right-1 h-3 w-3 rounded-full bg-surface-800 text-slate-400" />
      )}
    </span>
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
        className="flex h-12 w-full cursor-pointer items-center gap-2 border-b border-edge px-4 text-left transition-colors duration-200 hover:bg-white/[0.05]"
      >
        <h2 className="min-w-0 flex-1 truncate font-semibold text-slate-50">{name}</h2>
        {open ? (
          <XIcon className="h-4 w-4 text-slate-300" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-slate-300" />
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
  addLabel: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-2 pb-1 pt-4">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * The first click joins the call and opens the channel screen; clicks after
 * that only bring the screen back, so nobody re-joins a call they are in.
 */
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
        className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[15px] transition-colors duration-200 ${
          here || connectingHere || viewing
            ? 'row-active'
            : 'row-idle'
        }`}
      >
        <ChannelGlyph channel={channel} />
        <span className="truncate">{channel.name}</span>
        {connectingHere && (
          <span className="animate-pulse text-xs text-status-online">connecting…</span>
        )}
        {occupants.length > 0 && (
          <span className="ml-auto text-xs text-slate-500">{occupants.length}</span>
        )}
      </button>

      <ul className="space-y-0.5 pl-8">
        {occupants.map((userId) => {
          const member = members.find((item) => item.userId === userId);
          return (
            <li key={userId} className="truncate py-0.5 text-sm text-slate-400">
              {member?.displayName ?? 'Someone'}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A failed join has to say so somewhere; this is the only place it can. */
function VoiceError(): JSX.Element | null {
  const error = useVoiceStore((state) => state.error);
  if (!error) return null;

  return (
    <p role="alert" className="mx-2 mt-1 rounded bg-danger/10 px-2 py-1.5 text-xs text-danger">
      {error}
    </p>
  );
}
