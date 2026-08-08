import { useState } from 'react';
import type { Channel, ChannelType } from '@nexora/shared-types';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { VoicePanel } from '../voice/VoicePanel';
import { HashIcon, LogOutIcon, PlusIcon, SpeakerIcon } from '../../components/icons';

export function ChannelSidebar(): JSX.Element {
  const { workspaces, channels, activeWorkspaceId, activeChannelId, selectChannel, createChannel } =
    useChatStore();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [name, setName] = useState('');

  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const canManage = workspace?.role === 'OWNER' || workspace?.role === 'ADMIN';

  const textChannels = channels.filter((channel) => channel.type === 'TEXT');
  const voiceChannels = channels.filter((channel) => channel.type === 'VOICE');

  const voiceChannelId = useVoiceStore((state) => state.channelId);
  const connectedChannel = channels.find((channel) => channel.id === voiceChannelId);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || !creating) return;
    await createChannel(trimmed, creating);
    setName('');
    setCreating(null);
  };

  const newChannelInput = (
    <input
      autoFocus
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => setCreating(null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void submit();
        if (event.key === 'Escape') setCreating(null);
      }}
      aria-label={creating === 'VOICE' ? 'New voice channel name' : 'New text channel name'}
      placeholder={creating === 'VOICE' ? 'new-voice' : 'new-channel'}
      className="mt-1 w-full rounded border border-surface-700 bg-surface-900 px-2 py-1.5 text-sm transition-colors duration-200 focus:border-accent"
    />
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-surface-800">
      <header className="flex h-12 items-center border-b border-black/30 px-4">
        <h2 className="truncate font-semibold text-slate-100">
          {workspace?.name ?? 'No workspace'}
        </h2>
      </header>

      <nav aria-label="Channels" className="flex-1 overflow-y-auto px-2 pb-2">
        <SectionHeading
          label="Text channels"
          onAdd={canManage ? () => setCreating('TEXT') : undefined}
          addLabel="Create text channel"
        />

        <div className="space-y-0.5">
          {textChannels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              onClick={() => void selectChannel(channel.id)}
              aria-current={channel.id === activeChannelId ? 'page' : undefined}
              className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 ${
                channel.id === activeChannelId
                  ? 'bg-surface-700 text-slate-50'
                  : 'text-slate-400 hover:bg-surface-700/60 hover:text-slate-200'
              }`}
            >
              <HashIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{channel.name}</span>
            </button>
          ))}
          {creating === 'TEXT' && newChannelInput}
          {textChannels.length === 0 && creating !== 'TEXT' && (
            <p className="px-2 py-2 text-sm text-slate-500">No text channels yet.</p>
          )}
        </div>

        <SectionHeading
          label="Voice channels"
          onAdd={canManage ? () => setCreating('VOICE') : undefined}
          addLabel="Create voice channel"
        />

        <div className="space-y-0.5">
          {voiceChannels.map((channel) => (
            <VoiceChannelRow key={channel.id} channel={channel} />
          ))}
          {creating === 'VOICE' && newChannelInput}
          {voiceChannels.length === 0 && creating !== 'VOICE' && (
            <p className="px-2 py-2 text-sm text-slate-500">No voice channels yet.</p>
          )}
          <VoiceError />
        </div>

        <MemberList />
      </nav>

      <VoicePanel channelName={connectedChannel?.name ?? null} />

      <div className="flex items-center gap-2 bg-surface-950 px-3 py-2">
        <div
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white"
        >
          {(user?.displayName ?? '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">{user?.displayName}</p>
          <p className="truncate text-xs text-slate-400">@{user?.username}</p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Sign out"
          title="Sign out"
          className="cursor-pointer rounded p-2 text-slate-400 transition-colors duration-200 hover:bg-surface-800 hover:text-red-400"
        >
          <LogOutIcon className="h-4 w-4" />
        </button>
      </div>
    </aside>
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
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={addLabel}
          title={addLabel}
          className="cursor-pointer rounded p-1 text-slate-400 transition-colors duration-200 hover:bg-surface-700 hover:text-slate-100"
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
        className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 ${
          here || connectingHere || viewing
            ? 'bg-surface-700 text-slate-50'
            : 'text-slate-400 hover:bg-surface-700/60 hover:text-slate-200'
        }`}
      >
        <SpeakerIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">{channel.name}</span>
        {connectingHere && <span className="text-xs text-emerald-400 animate-pulse">connecting...</span>}
        {occupants.length > 0 && (
          <span className="ml-auto text-xs text-slate-500">{occupants.length}</span>
        )}
      </button>

      <ul className="space-y-0.5 pl-8">
        {occupants.map((userId) => {
          const member = members.find((item) => item.userId === userId);
          return (
            <li key={userId} className="truncate py-0.5 text-xs text-slate-400">
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
    <p role="alert" className="mx-2 mt-1 rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
      {error}
    </p>
  );
}

function MemberList(): JSX.Element | null {
  const members = useChatStore((state) => state.members);
  const online = usePresenceStore((state) => state.online);

  if (members.length === 0) return null;

  // Online first, so a busy workspace still shows who is reachable now.
  const sorted = [...members].sort((left, right) => {
    const delta = Number(online.has(right.userId)) - Number(online.has(left.userId));
    return delta !== 0 ? delta : left.displayName.localeCompare(right.displayName);
  });

  return (
    <>
      <SectionHeading label={`Members - ${online.size} online`} addLabel="" />
      <ul className="space-y-0.5">
        {sorted.map((member) => (
          <li key={member.userId} className="flex items-center gap-2 px-2 py-1 text-sm">
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                online.has(member.userId) ? 'bg-emerald-400' : 'bg-slate-600'
              }`}
            />
            <span
              className={`truncate ${online.has(member.userId) ? 'text-slate-300' : 'text-slate-500'}`}
            >
              {member.displayName}
            </span>
            <span className="sr-only">{online.has(member.userId) ? 'online' : 'offline'}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
