import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { useFriendsStore } from '../../stores/friends';
import { Avatar } from '../../components/Avatar';
import { HashIcon, SearchIcon, SpeakerIcon } from '../../components/icons';
import { ServerIcon } from '../../components/ServerIcon';

interface Entry {
  key: string;
  label: string;
  hint: string;
  glyph: JSX.Element;
  open: () => void;
}

/**
 * Ctrl+K: one field over everywhere you can go - servers, the channels of the
 * server you are in, and open conversations.
 *
 * A chat app normally makes you find a place by pointing at it in a list, which
 * is fine with four channels and useless with forty. This is the same move an
 * editor makes with its file switcher, and it is why the command field in the
 * top bar is the middle of the window rather than a search box in a corner.
 */
export function QuickSwitcher({ onClose }: { onClose: () => void }): JSX.Element {
  const servers = useChatStore((state) => state.servers);
  const channels = useChatStore((state) => state.channels);
  const view = useChatStore((state) => state.view);
  const selectServer = useChatStore((state) => state.selectServer);
  const selectChannel = useChatStore((state) => state.selectChannel);
  const directChannels = useFriendsStore((state) => state.directChannels);
  const openDirect = useFriendsStore((state) => state.openDirect);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const all: Entry[] = [];

    for (const direct of directChannels) {
      all.push({
        key: `direct:${direct.channelId}`,
        label: direct.participant.displayName,
        hint: 'Conversation',
        glyph: (
          <Avatar
            name={direct.participant.displayName}
            avatarUrl={direct.participant.avatarUrl}
            size="sm"
          />
        ),
        open: () => void openDirect(direct.participant.id),
      });
    }

    // Only the open server's channels are loaded, so only those can be listed;
    // the servers themselves are always here, and opening one is one more
    // keystroke away from its channels.
    if (view === 'server') {
      for (const channel of channels) {
        all.push({
          key: `channel:${channel.id}`,
          label: channel.name,
          hint: channel.type === 'VOICE' ? 'Voice channel' : 'Channel',
          glyph:
            channel.type === 'VOICE' ? (
              <SpeakerIcon className="h-4 w-4" />
            ) : (
              <HashIcon className="h-4 w-4" />
            ),
          open: () => void selectChannel(channel.id),
        });
      }
    }

    for (const server of servers) {
      all.push({
        key: `server:${server.id}`,
        label: server.name,
        hint: 'Server',
        glyph: <ServerIcon server={server} size="sm" />,
        open: () => void selectServer(server.id),
      });
    }

    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((entry) => entry.label.toLowerCase().includes(needle));
  }, [
    channels,
    directChannels,
    openDirect,
    query,
    selectChannel,
    selectServer,
    servers,
    view,
  ]);

  // A filtered list whose selection stayed where it was would run the wrong
  // entry on Enter, so every change to the results puts it back at the top.
  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const run = (entry: Entry | undefined): void => {
    if (!entry) return;
    entry.open();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Go to"
      className="fixed inset-0 z-50 flex animate-fade justify-center bg-black/50 px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="h-fit w-full max-w-xl animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 shadow-pop"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-edge px-3.5">
          <SearchIcon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            aria-label="Search servers, channels and conversations"
            placeholder="Go to a server, channel or conversation…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'Enter') run(entries[cursor]);
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((value) => (entries.length ? (value + 1) % entries.length : 0));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((value) =>
                  entries.length ? (value - 1 + entries.length) % entries.length : 0,
                );
              }
            }}
            className="h-12 w-full bg-transparent text-[15px] text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>

        <ul ref={listRef} className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {entries.length === 0 && (
            <li className="px-2.5 py-6 text-center text-sm text-slate-500">Nothing matches that.</li>
          )}
          {entries.map((entry, index) => (
            <li key={entry.key} role="option" aria-selected={index === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => run(entry)}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 ${
                  index === cursor ? 'bg-accent/20 text-slate-50' : 'text-slate-300'
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md text-slate-400">
                  {entry.glyph}
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px]">{entry.label}</span>
                <span className="shrink-0 text-xs text-slate-500">{entry.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
