import { useMemo, useState } from 'react';
import { dayLabel } from './day';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { PersonAvatar } from '../../components/Avatar';
import { SearchIcon, XIcon } from '../../components/icons';

export interface SearchPanelProps {
  onClose?: () => void;
  className?: string;
}

/**
 * Search inside the open conversation.
 *
 * It runs in the client, over the decrypted history this window is holding,
 * and it has to: `messages.content` is ciphertext, so the server cannot match a
 * word in it without being given the channel key, which is the one thing the
 * design will not do. What this means in practice is documented rather than
 * hidden - the footer says how far back the search reached, and scrolling the
 * conversation further back widens it.
 */
export function SearchPanel({
  onClose,
  className = 'w-60 shrink-0',
}: SearchPanelProps = {}): JSX.Element {
  const me = useAuthStore((state) => state.user);
  const channelId = useChatStore((state) => state.activeChannelId);
  const history = useChatStore((state) => (channelId ? state.history[channelId] : undefined));
  const messages = useChatStore((state) => state.messages);
  const jumpToMessage = useChatStore((state) => state.jumpToMessage);
  const showPanel = useChatStore((state) => state.showPanel);

  const [query, setQuery] = useState('');
  const searchable = history ?? messages;

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];
    return searchable
      .filter((message) => !message.deletedAt && message.content.toLowerCase().includes(term))
      .slice(-100)
      .reverse();
  }, [query, searchable]);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      showPanel('members');
    }
  };

  return (
    <aside className={`panel flex flex-col bg-surface-850 ${className}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        <SearchIcon className="h-4 w-4 text-slate-400" />
        <h2 className="flex-1 text-sm font-semibold text-slate-100">Search</h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close search"
          className="flex h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7 cursor-pointer items-center justify-center rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="shrink-0 p-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search this channel"
          aria-label="Search this channel"
          className="w-full rounded bg-surface-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {query.trim().length >= 2 && results.length === 0 && (
          <p className="px-2 py-4 text-sm text-slate-400">Nothing in the loaded history matches.</p>
        )}

        <ul className="space-y-2">
          {results.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => jumpToMessage(message.id)}
                className="w-full cursor-pointer rounded-lg bg-surface-800 p-2.5 text-left transition-colors duration-200 hover:bg-white/[0.06]"
              >
                <span className="flex items-center gap-2">
                  <PersonAvatar
                    userId={message.author.id}
                    name={message.author.displayName}
                    avatarUrl={message.author.avatarUrl}
                    size="sm"
                    ringColour="border-surface-800"
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm font-medium ${
                      message.author.id === me?.id ? 'font-semibold text-accent' : 'text-slate-100'
                    }`}
                  >
                    {message.author.id === me?.id ? 'You' : message.author.displayName}
                  </span>
                  <time dateTime={message.createdAt} className="shrink-0 text-xs text-slate-500">
                    {dayLabel(message.createdAt)}
                  </time>
                </span>
                <span className="mt-1.5 block line-clamp-3 break-words text-sm text-slate-300">
                  {highlight(message, query)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="shrink-0 border-t border-edge px-3 py-2 text-xs text-slate-500">
        Searches the {searchable.length} messages this window has decrypted. Messages are encrypted,
        so the server cannot search them.
      </p>
    </aside>
  );
}

/** Trims a long body down to the part the term is actually in. */
function highlight(message: DecryptedMessage, query: string): string {
  const at = message.content.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at <= 60) return message.content.slice(0, 160);
  return `…${message.content.slice(at - 40, at + 120)}`;
}
