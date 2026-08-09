import { useChatStore } from '../../stores/chat';
import { useFriendsStore } from '../../stores/friends';
import { usePresenceStore } from '../../stores/presence';
import { UserPanel } from '../settings/UserPanel';
import { Avatar } from '../../components/Avatar';
import { MonitorIcon, UsersIcon, XIcon } from '../../components/icons';

/**
 * The home sidebar: the Friends screen at the top, then one row per open
 * conversation. Closing a conversation only hides it - the messages stay, and
 * it comes back the moment anything new arrives in it.
 */
export function HomeSidebar({
  showingFriends,
  onShowFriends,
  showingRemote,
  onShowRemote,
  onOpenUserSettings,
}: {
  showingFriends: boolean;
  onShowFriends: () => void;
  showingRemote: boolean;
  onShowRemote: () => void;
  onOpenUserSettings: () => void;
}): JSX.Element {
  const directChannels = useFriendsStore((state) => state.directChannels);
  const openDirect = useFriendsStore((state) => state.openDirect);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const unread = useChatStore((state) => state.unread);
  const statusOf = usePresenceStore((state) => state.statusOf);
  const pending = useFriendsStore((state) =>
    state.friends.filter((friend) => friend.direction === 'incoming').length,
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-surface-800">
      <header className="flex h-12 items-center border-b border-black/20 px-3">
        <p className="w-full truncate rounded bg-surface-950 px-2 py-1 text-sm text-slate-400">
          Find or start a conversation
        </p>
      </header>

      <nav aria-label="Direct messages" className="flex-1 overflow-y-auto px-2 py-2">
        <button
          type="button"
          onClick={onShowFriends}
          aria-current={showingFriends ? 'page' : undefined}
          className={`flex w-full cursor-pointer items-center gap-3 rounded px-2 py-2 text-left transition-colors duration-200 ${
            showingFriends
              ? 'bg-surface-700 text-slate-50'
              : 'text-slate-400 hover:bg-surface-700/60 hover:text-slate-200'
          }`}
        >
          <UsersIcon className="h-5 w-5 shrink-0" />
          <span className="flex-1 font-medium">Friends</span>
          {pending > 0 && (
            <span className="rounded-full bg-danger px-1.5 text-xs font-bold text-white">
              {pending}
              <span className="sr-only"> pending requests</span>
            </span>
          )}
        </button>

        {/* Machines sit beside people on purpose: reaching your desktop is the
            same kind of thing as opening a conversation with someone. */}
        <button
          type="button"
          onClick={onShowRemote}
          aria-current={showingRemote ? 'page' : undefined}
          className={`mt-0.5 flex w-full cursor-pointer items-center gap-3 rounded px-2 py-2 text-left transition-colors duration-200 ${
            showingRemote
              ? 'bg-surface-700 text-slate-50'
              : 'text-slate-400 hover:bg-surface-700/60 hover:text-slate-200'
          }`}
        >
          <MonitorIcon className="h-5 w-5 shrink-0" />
          <span className="flex-1 font-medium">Remote machines</span>
        </button>

        <p className="px-2 pb-1 pt-5 text-xs font-bold uppercase tracking-wide text-slate-400">
          Direct messages
        </p>

        <div className="space-y-0.5">
          {directChannels.length === 0 && (
            <p className="px-2 py-2 text-sm text-slate-500">
              No conversations yet. Add a friend and start one.
            </p>
          )}
          {directChannels.map((direct) => {
            const active = !showingFriends && direct.channelId === activeChannelId;
            const count = unread[direct.channelId] ?? 0;
            return (
              <button
                key={direct.channelId}
                type="button"
                onClick={() => void openDirect(direct.participant.id)}
                aria-current={active ? 'page' : undefined}
                className={`group flex w-full cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-left transition-colors duration-200 ${
                  active
                    ? 'bg-surface-700 text-slate-50'
                    : 'text-slate-400 hover:bg-surface-700/60 hover:text-slate-200'
                }`}
              >
                <Avatar
                  name={direct.participant.displayName}
                  avatarUrl={direct.participant.avatarUrl}
                  status={statusOf(direct.participant.id)}
                  size="sm"
                  ringColour="border-surface-800"
                />
                <span className={`flex-1 truncate ${count ? 'font-semibold text-white' : ''}`}>
                  {direct.participant.displayName}
                </span>
                {count > 0 ? (
                  <span className="rounded-full bg-danger px-1.5 text-xs font-bold text-white">
                    {count}
                    <span className="sr-only"> unread messages</span>
                  </span>
                ) : (
                  <XIcon className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-60" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <UserPanel onOpenSettings={onOpenUserSettings} />
    </aside>
  );
}
