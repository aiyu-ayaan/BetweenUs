import { useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import { HashIcon, LogOutIcon, PlusIcon } from '../../components/icons';

export function ChannelSidebar(): JSX.Element {
  const { workspaces, channels, activeWorkspaceId, activeChannelId, selectChannel, createChannel } =
    useChatStore();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const canManage = workspace?.role === 'OWNER' || workspace?.role === 'ADMIN';

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await createChannel(trimmed);
    setName('');
    setCreating(false);
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-surface-800">
      <header className="flex h-12 items-center border-b border-black/30 px-4">
        <h2 className="truncate font-semibold text-slate-100">
          {workspace?.name ?? 'No workspace'}
        </h2>
      </header>

      <div className="flex items-center justify-between px-4 pb-1 pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Text channels
        </span>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="Create channel"
            title="Create channel"
            className="cursor-pointer rounded p-1 text-slate-400 transition-colors duration-200 hover:bg-surface-700 hover:text-slate-100"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav aria-label="Channels" className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {channels.map((channel) => {
          const active = channel.id === activeChannelId;
          return (
            <button
              key={channel.id}
              type="button"
              onClick={() => void selectChannel(channel.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 ${
                active
                  ? 'bg-surface-700 text-slate-50'
                  : 'text-slate-400 hover:bg-surface-700/60 hover:text-slate-200'
              }`}
            >
              <HashIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{channel.name}</span>
            </button>
          );
        })}

        {creating && (
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setCreating(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') setCreating(false);
            }}
            aria-label="New channel name"
            placeholder="new-channel"
            className="mt-1 w-full rounded border border-surface-700 bg-surface-900 px-2 py-1.5 text-sm transition-colors duration-200 focus:border-accent"
          />
        )}

        {channels.length === 0 && !creating && (
          <p className="px-2 py-4 text-sm text-slate-500">No channels yet.</p>
        )}
      </nav>

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
