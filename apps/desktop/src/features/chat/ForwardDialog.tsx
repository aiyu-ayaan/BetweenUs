/**
 * Where a message is being forwarded to.
 *
 * The server it is already in, and every other text channel of it. Not the
 * whole workspace: a forward is nearly always "the rest of this server needs
 * to see this", and the one answer that is never right is the channel it is
 * already in - so that one is left out rather than offered and then explained.
 *
 * A direct message has no server, so it offers the other conversations
 * instead. The same rule read the other way: everywhere this could go that is
 * not where it already is.
 *
 * Nothing is sent from here. Picking hands the channel back, and the send
 * happens on the chat view where a failure has somewhere to be reported.
 */
import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { HashIcon, MessageIcon, SearchIcon } from '../../components/icons';

export function ForwardDialog({
  fromChannelId,
  onPick,
  onClose,
}: {
  fromChannelId: string;
  onPick: (channelId: string) => void;
  onClose: () => void;
}): JSX.Element {
  const channels = useChatStore((state) => state.channels);
  const directs = useChatStore((state) => state.directs);
  const servers = useChatStore((state) => state.servers);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const source = [...channels, ...directs].find((channel) => channel.id === fromChannelId);
  const serverId = source?.serverId ?? null;
  const server = servers.find((entry) => entry.id === serverId);

  const needle = query.trim().toLowerCase();
  const matches = (text: string): boolean =>
    needle.length === 0 || text.toLowerCase().includes(needle);

  const targets = (
    serverId === null
      ? directs.filter((direct) => direct.id !== fromChannelId)
      : channels.filter(
          (channel) =>
            channel.serverId === serverId &&
            channel.type === 'TEXT' &&
            channel.id !== fromChannelId,
        )
  ).filter((channel) => matches(channel.name));

  const heading = serverId === null ? 'Direct messages' : (server?.name ?? 'This server');

  return (
    <div
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
              placeholder={serverId === null ? 'A name' : 'A channel'}
              aria-label="Search for somewhere to forward this to"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
            />
          </label>
        </div>

        <div className="overflow-y-auto px-2 py-2">
          {targets.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              {needle.length > 0
                ? 'Nothing by that name.'
                : serverId === null
                  ? 'No other conversation to send it to yet.'
                  : 'This server has nowhere else to put it yet.'}
            </p>
          ) : (
            <ul>
              {[heading].map((label) => (
                <li
                  key={label}
                  className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {label}
                </li>
              ))}
              {targets.map((channel) => (
                <li key={channel.id}>
                  <button
                    type="button"
                    onClick={() => onPick(channel.id)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-white/[0.05]"
                  >
                    {serverId === null ? (
                      <MessageIcon className="h-4 w-4 shrink-0 text-slate-500" />
                    ) : (
                      <HashIcon className="h-4 w-4 shrink-0 text-slate-500" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-100">
                      {channel.name}
                    </span>
                  </button>
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
