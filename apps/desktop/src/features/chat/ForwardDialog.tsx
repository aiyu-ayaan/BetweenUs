/**
 * Where a message is being forwarded to.
 *
 * Everywhere it could go, minus the one place it already is. This started as
 * the current server's other text channels and that was too narrow to be
 * usable: a server with one channel in it - which is every server on the day
 * it is made - offered nothing at all, and the dialog's whole answer was that
 * there was no answer. A forward is not a per-server action.
 *
 * So it is every direct message and every server's text channels, searchable,
 * in one column - the same list the phone's forward sheet draws, because two
 * pickers that answer "which conversation" differently is one of them being
 * wrong.
 *
 * The store only holds the *active* server's channels, since `selectServer`
 * clears them on every switch. The other servers are fetched here, once, while
 * the dialog is open, and thrown away with it - a list this is read from for
 * as long as it takes to click a row does not belong in the store, where it
 * would go stale for the sidebar to trip over.
 *
 * Nothing is sent from here. Picking hands the channel back, and the send
 * happens on the chat view where a failure has somewhere to be reported.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Channel } from '@betweenus/shared-types';
import { useChatStore } from '../../stores/chat';
import { useFriendsStore } from '../../stores/friends';
import { useStatusOf } from '../../stores/presence';
import { api } from '../../services/api';
import { Avatar } from '../../components/Avatar';
import { ServerIcon } from '../../components/ServerIcon';
import { HashIcon, SearchIcon } from '../../components/icons';
import { useFocusTrap } from '../../services/focus-trap';

/**
 * How many conversations the list shows before it stops.
 *
 * Somebody with sixty of them would otherwise get sixty rows above the first
 * server heading, and the channels - the other half of what this picker is
 * for - would be off the bottom of a dialog that is already as tall as it is
 * allowed to get. Six is about a screen's worth of "the people I actually talk
 * to"; the rest are one click or one search away, and searching lifts the cap
 * entirely because a search is somebody naming who they want.
 */
const DIRECTS_SHOWN = 6;

export function ForwardDialog({
  fromChannelId,
  onPick,
  onClose,
}: {
  fromChannelId: string;
  onPick: (channelId: string, name: string) => void;
  onClose: () => void;
}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const servers = useChatStore((state) => state.servers);
  const loadedChannels = useChatStore((state) => state.channels);
  const activeServerId = useChatStore((state) => state.activeServerId);
  // The friends store's copy, not the chat store's: that one flattens a
  // conversation into a `Channel` and drops the participant, which is where the
  // face and the online dot live. A row that says who it is with a grey bubble
  // is a row that has forgotten the only thing worth drawing on it.
  const directChannels = useFriendsStore((state) => state.directChannels);
  const loadFriends = useFriendsStore((state) => state.load);
  const statusOf = useStatusOf();
  const [fetched, setFetched] = useState<Record<string, Channel[]>>({});
  const [query, setQuery] = useState('');
  const [allDirects, setAllDirects] = useState(false);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  useEffect(() => {
    let live = true;
    void loadFriends().catch(() => undefined);
    // A server whose channels have never been opened has none in the store, and
    // a list that is short because nothing fetched it looks exactly like a list
    // that is short because there is nowhere to send it.
    for (const server of servers) {
      if (server.id === activeServerId) continue;
      void api
        .channels(server.id)
        .then((channels) => {
          if (live) setFetched((known) => ({ ...known, [server.id]: channels }));
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
    // Servers do not change while a dialog is open; this is the one fetch pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = (text: string): boolean =>
    needle.length === 0 || text.toLowerCase().includes(needle);

  const matched = directChannels.filter(
    (direct) =>
      direct.channelId !== fromChannelId &&
      (matches(direct.participant.displayName) || matches(direct.participant.username)),
  );
  // A search is somebody naming who they want, so it lifts the cap rather than
  // hiding the one row they typed the name of.
  const capped = allDirects || needle.length > 0;
  const people = capped ? matched : matched.slice(0, DIRECTS_SHOWN);
  const hidden = matched.length - people.length;

  const sections = useMemo(
    () =>
      servers
        .map((server) => ({
          server,
          channels: (server.id === activeServerId
            ? loadedChannels
            : (fetched[server.id] ?? [])
          ).filter(
            (channel) =>
              channel.type === 'TEXT' && channel.id !== fromChannelId && matches(channel.name),
          ),
        }))
        .filter((section) => section.channels.length > 0),
    // `matches` closes over `needle`, which is what actually changes here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [servers, activeServerId, loadedChannels, fetched, fromChannelId, needle],
  );

  const empty = people.length === 0 && sections.length === 0;

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="Forward message"
      className="fixed inset-0 z-50 flex animate-fade items-end justify-center bg-black/60 px-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[75vh] w-full max-w-sm animate-pop flex-col overflow-hidden rounded-t-xl border border-edge bg-surface-900 shadow-pop sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-edge px-5 py-4">
          <h2 className="text-base font-bold text-slate-50">Forward to</h2>
          <label className="mt-3 flex items-center gap-2 rounded-lg border border-edge bg-surface-950 px-2.5 py-1.5">
            <SearchIcon className="h-4 w-4 shrink-0 text-slate-500" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="A name or a channel"
              aria-label="Search for somewhere to forward this to"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
            />
          </label>
        </div>

        <div className="overflow-y-auto px-2 py-2">
          {empty ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              {needle.length > 0
                ? 'Nothing by that name.'
                : 'Start a conversation or make another channel, and it will be on this list.'}
            </p>
          ) : (
            <ul>
              {people.length > 0 && <Heading label="Direct messages" />}
              {people.map((direct) => (
                <Row
                  key={direct.channelId}
                  name={direct.participant.displayName || direct.participant.username}
                  icon={
                    <Avatar
                      name={direct.participant.displayName}
                      avatarUrl={direct.participant.avatarUrl}
                      status={statusOf(direct.participant.id)}
                      size="sm"
                      ringColour="border-surface-900"
                      // The face is part of the row, not a control of its own:
                      // clicking it must pick the conversation, not open the
                      // photo over the top of the picker.
                      viewable={false}
                    />
                  }
                  onClick={() =>
                    onPick(
                      direct.channelId,
                      direct.participant.displayName || direct.participant.username,
                    )
                  }
                />
              ))}
              {hidden > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setAllDirects(true)}
                    className="w-full cursor-pointer rounded-lg px-3 py-1.5 text-start text-xs font-medium text-slate-400 transition-colors duration-150 hover:bg-white/[0.05] hover:text-slate-200"
                  >
                    Show {hidden} more conversation{hidden === 1 ? '' : 's'}
                  </button>
                </li>
              )}

              {sections.map(({ server, channels }) => (
                <li key={server.id}>
                  <ul>
                    <Heading
                      label={server.name}
                      // The server's own picture beside its name. A column of
                      // "# general" rows all look alike, and the heading is the
                      // only thing saying which server one belongs to.
                      icon={<ServerIcon server={server} size="xs" />}
                    />
                    {channels.map((channel) => (
                      <Row
                        key={channel.id}
                        name={channel.name}
                        icon={<HashIcon className="h-4 w-4 shrink-0 text-slate-500" />}
                        onClick={() => onPick(channel.id, `#${channel.name}`)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer border-t border-edge px-5 py-3 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/[0.04] hover:text-slate-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Heading({ label, icon }: { label: string; icon?: JSX.Element }): JSX.Element {
  return (
    <li className="flex items-center gap-2 px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </li>
  );
}

function Row({
  name,
  icon,
  onClick,
}: {
  name: string;
  icon: JSX.Element;
  onClick: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-start transition-colors duration-150 hover:bg-white/[0.05]"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{name}</span>
      </button>
    </li>
  );
}
