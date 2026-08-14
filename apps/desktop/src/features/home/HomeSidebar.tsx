import { useChatStore } from '../../stores/chat';
import { useFriendsStore } from '../../stores/friends';
import { usePresenceStore } from '../../stores/presence';
import { isDesktopRuntime } from '../../services/platform';
import { UserPanel } from '../settings/UserPanel';
import { VoicePanel } from '../voice/VoicePanel';
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
    <aside className="panel flex w-60 shrink-0 flex-col bg-surface-800">
      <header className="flex h-11 shrink-0 items-center border-b border-edge px-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
          Messages
        </h2>
      </header>

      <nav aria-label="Direct messages" className="flex-1 overflow-y-auto px-2 py-2">
        <button
          type="button"
          onClick={onShowFriends}
          aria-current={showingFriends ? 'page' : undefined}
          className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-200 ${
            showingFriends
              ? 'row-active'
              : 'row-idle'
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
            same kind of thing as opening a conversation with someone.

            Not in a browser tab, though: remote desktop is a desktop-app
            section end to end - the agent that offers a machine is the Electron
            main process - so the web client does not advertise a door it cannot
            open. See services/platform.ts. */}
        {isDesktopRuntime() && (
          <button
            type="button"
            onClick={onShowRemote}
            aria-current={showingRemote ? 'page' : undefined}
            className={`mt-0.5 flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-200 ${
              showingRemote
                ? 'row-active'
                : 'row-idle'
            }`}
          >
            <MonitorIcon className="h-5 w-5 shrink-0" />
            <span className="flex-1 font-medium">Remote machines</span>
          </button>
        )}

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
                className={`group flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-200 ${
                  active
                    ? 'row-active'
                    : 'row-idle'
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

      {/* A call started in a server keeps running while you read a direct
          message, so its controls have to be reachable from here too. */}
      <VoicePanel />
      <UserPanel onOpenSettings={onOpenUserSettings} />
    </aside>
  );
}
