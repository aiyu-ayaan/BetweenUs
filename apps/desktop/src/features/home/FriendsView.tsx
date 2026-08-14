import { useState } from 'react';
import type { Friend } from '@nexora/shared-types';
import { useFriendsStore } from '../../stores/friends';
import { usePresenceStore } from '../../stores/presence';
import { Avatar } from '../../components/Avatar';
import {
  CheckIcon,
  MessageIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from '../../components/icons';

type Tab = 'online' | 'all' | 'pending' | 'add';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
];

/** Discord's friends screen: the tabs, and the "add friend" form behind one. */
export function FriendsView(): JSX.Element {
  const [tab, setTab] = useState<Tab>('online');
  const friends = useFriendsStore((state) => state.friends);
  const isOnline = usePresenceStore((state) => state.online);

  const accepted = friends.filter((friend) => friend.status === 'ACCEPTED');
  const pending = friends.filter((friend) => friend.status === 'PENDING');
  const online = accepted.filter((friend) => isOnline.has(friend.user.id));

  const shown = tab === 'online' ? online : tab === 'all' ? accepted : pending;

  return (
    <section className="panel flex min-w-0 flex-1 flex-col bg-surface-900">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-edge px-4">
        <span className="flex items-center gap-2 font-semibold text-slate-50">
          <UsersIcon className="h-5 w-5 text-slate-400" />
          Friends
        </span>
        <span aria-hidden="true" className="h-6 w-px bg-surface-700" />

        <div role="tablist" aria-label="Friends" className="flex items-center gap-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={`cursor-pointer rounded px-2.5 py-1 text-sm transition-colors duration-200 ${
                tab === entry.id
                  ? 'row-active'
                  : 'text-slate-300 hover:bg-white/[0.05]'
              }`}
            >
              {entry.label}
              {entry.id === 'pending' && pending.length > 0 && (
                <span className="ml-1.5 rounded-full bg-danger px-1.5 text-xs font-bold text-white">
                  {pending.length}
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'add'}
            onClick={() => setTab('add')}
            className={`ml-1 cursor-pointer rounded px-2.5 py-1 text-sm font-medium transition-colors duration-200 ${
              tab === 'add'
                ? 'bg-surface-700 text-status-online'
                : 'bg-status-online text-white hover:opacity-90'
            }`}
          >
            Add friend
          </button>
        </div>
      </header>

      {tab === 'add' ? <AddFriend /> : <FriendList friends={shown} tab={tab} />}
    </section>
  );
}

function FriendList({ friends, tab }: { friends: Friend[]; tab: Tab }): JSX.Element {
  const statusOf = usePresenceStore((state) => state.statusOf);
  const accept = useFriendsStore((state) => state.accept);
  const remove = useFriendsStore((state) => state.remove);
  const openDirect = useFriendsStore((state) => state.openDirect);

  if (friends.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-center text-slate-400">
          {tab === 'pending'
            ? 'No pending requests. When someone asks, they will be here.'
            : tab === 'online'
              ? 'Nobody is around right now.'
              : 'No friends yet. Add someone by their username.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
        {tab === 'pending' ? 'Pending' : tab === 'online' ? 'Online' : 'All friends'} —{' '}
        {friends.length}
      </p>

      <ul>
        {friends.map((friend) => (
          <li
            key={friend.user.id}
            className="flex items-center gap-3 border-t border-surface-700/60 py-3 first:border-t-0"
          >
            <Avatar
              name={friend.user.displayName}
              avatarUrl={friend.user.avatarUrl}
              status={statusOf(friend.user.id)}
              ringColour="border-surface-900"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-100">{friend.user.displayName}</p>
              <p className="truncate text-sm text-slate-400">
                @{friend.user.username}
                {friend.direction === 'incoming' && ' · Incoming request'}
                {friend.direction === 'outgoing' && ' · Request sent'}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {friend.status === 'ACCEPTED' && (
                <IconButton
                  label={`Message ${friend.user.displayName}`}
                  onClick={() => void openDirect(friend.user.id)}
                >
                  <MessageIcon className="h-5 w-5" />
                </IconButton>
              )}
              {friend.direction === 'incoming' && (
                <IconButton
                  label={`Accept ${friend.user.displayName}`}
                  onClick={() => void accept(friend.user.id)}
                  hoverClasses="hover:text-status-online"
                >
                  <CheckIcon className="h-5 w-5" />
                </IconButton>
              )}
              <IconButton
                label={
                  friend.status === 'ACCEPTED'
                    ? `Remove ${friend.user.displayName}`
                    : `Cancel request to ${friend.user.displayName}`
                }
                onClick={() => void remove(friend.user.id)}
                hoverClasses="hover:text-danger"
              >
                <XIcon className="h-5 w-5" />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddFriend(): JSX.Element {
  const search = useFriendsStore((state) => state.search);
  const results = useFriendsStore((state) => state.searchResults);
  const add = useFriendsStore((state) => state.add);
  const error = useFriendsStore((state) => state.error);

  const [query, setQuery] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  const send = async (username: string): Promise<void> => {
    setSent(null);
    try {
      await add(username);
      setSent(username);
    } catch {
      // The store already carries the reason; nothing to add here.
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <h2 className="text-base font-bold uppercase tracking-wide text-slate-100">Add friend</h2>
      <p className="mt-1 text-sm text-slate-400">
        You can add a friend with their Nexora username.
      </p>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-edge bg-surface-950 px-4 py-2.5 transition-colors focus-within:border-accent/60">
        <input
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value);
            void search(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && query.trim()) void send(query.trim());
          }}
          placeholder="Enter a username"
          aria-label="Username"
          className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={query.trim().length === 0}
          onClick={() => void send(query.trim())}
          className="cursor-pointer rounded bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-40"
        >
          Send request
        </button>
      </div>

      {sent && (
        <p role="status" className="mt-3 text-sm text-status-online">
          Request sent to {sent}.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <>
          <p className="mt-8 text-xs font-bold uppercase tracking-wide text-slate-400">
            Matching people
          </p>
          <ul className="mt-2">
            {results.map((person) => (
              <li
                key={person.id}
                className="flex items-center gap-3 border-t border-surface-700/60 py-3 first:border-t-0"
              >
                <Avatar
                  name={person.displayName}
                  avatarUrl={person.avatarUrl}
                  ringColour="border-surface-900"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-100">{person.displayName}</p>
                  <p className="truncate text-sm text-slate-400">@{person.username}</p>
                </div>
                <IconButton
                  label={`Send a request to ${person.displayName}`}
                  onClick={() => void send(person.username)}
                  hoverClasses="hover:text-status-online"
                >
                  <UserPlusIcon className="h-5 w-5" />
                </IconButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  hoverClasses = 'hover:text-slate-50',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  hoverClasses?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`cursor-pointer rounded-full bg-surface-850 p-2.5 text-slate-300 transition-colors duration-200 hover:bg-white/[0.06] ${hoverClasses}`}
    >
      {children}
    </button>
  );
}
