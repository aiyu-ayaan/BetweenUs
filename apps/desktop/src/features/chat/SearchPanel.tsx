import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayLabel } from './day';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { PersonAvatar } from '../../components/Avatar';
import { SearchIcon, XIcon } from '../../components/icons';
import {
  matchMessages,
  mergeHits,
  normaliseTerm,
  walkOlder,
  walkStatus,
  type WalkStop,
} from './search-walk';

export interface SearchPanelProps {
  onClose?: () => void;
  className?: string;
}

/**
 * Search inside the open conversation.
 *
 * It runs in the client, and it has to: `messages.content` is ciphertext, so
 * the server cannot match a word in it without being given the channel key,
 * which is the one thing the design will not do. Matches in the window this
 * device has already decrypted appear at once. Then the search walks back
 * through older pages - fetched as ciphertext with the ordinary history
 * cursor, opened here, matched here - in a bounded run that shows how far back
 * it has read, can be stopped, and stops on its own at a cap rather than
 * decrypting a whole channel because somebody typed two letters.
 */
export function SearchPanel({
  onClose,
  className = 'w-60 shrink-0',
}: SearchPanelProps = {}): JSX.Element {
  const me = useAuthStore((state) => state.user);
  const channelId = useChatStore((state) => state.activeChannelId);
  const history = useChatStore((state) => (channelId ? state.history[channelId] : undefined));
  const messages = useChatStore((state) => state.messages);
  const revealMessage = useChatStore((state) => state.revealMessage);
  const fetchSearchPage = useChatStore((state) => state.fetchSearchPage);
  const showPanel = useChatStore((state) => state.showPanel);

  const [query, setQuery] = useState('');
  const searchable = history ?? messages;
  const term = normaliseTerm(query);

  const [older, setOlder] = useState<DecryptedMessage[]>([]);
  const [walk, setWalk] = useState<{
    running: boolean;
    stop: WalkStop | null;
    scanned: number;
    oldestAt: string | null;
  } | null>(null);
  // Bumped to abandon a walk in flight: a new term, another channel, Stop.
  const generation = useRef(0);
  const stopped = useRef(false);
  const resume = useRef<string | null>(null);
  const scannedBefore = useRef(0);

  const run = useCallback(
    async (cursor: string, forTerm: string, forChannel: string) => {
      const mine = ++generation.current;
      stopped.current = false;
      setWalk((current) => ({
        running: true,
        stop: null,
        scanned: scannedBefore.current,
        oldestAt: current?.oldestAt ?? null,
      }));
      const result = await walkOlder({
        term: forTerm,
        cursor,
        fetchPage: (next) => fetchSearchPage(forChannel, next),
        isStopped: () => generation.current !== mine || stopped.current,
        onProgress: (progress) => {
          setOlder((current) => mergeHits(current, progress.hits));
          setWalk({
            running: true,
            stop: null,
            scanned: scannedBefore.current + progress.scanned,
            oldestAt: progress.oldestAt,
          });
          resume.current = progress.cursor;
        },
      });
      // Somebody else's run now: leave the state to it.
      if (generation.current !== mine) return;
      scannedBefore.current += result.scanned;
      resume.current = result.cursor;
      setWalk((current) => ({
        running: false,
        stop: result.stop,
        scanned: scannedBefore.current,
        oldestAt: result.oldestAt ?? current?.oldestAt ?? null,
      }));
    },
    [fetchSearchPage],
  );

  // A new term or channel starts over: the window is matched instantly, the
  // walk begins from the oldest page it has not read after a short pause so
  // typing a word does not start a decryption per letter.
  useEffect(() => {
    generation.current += 1;
    setOlder([]);
    setWalk(null);
    scannedBefore.current = 0;
    resume.current = null;
    if (!term || !channelId) return;
    const cursor = useChatStore.getState().cursors[channelId];
    if (!cursor) return; // whole history is already in the window, or not loaded yet
    const timer = window.setTimeout(() => void run(cursor, term, channelId), 400);
    return () => {
      window.clearTimeout(timer);
      generation.current += 1;
    };
  }, [term, channelId, run]);

  const stop = () => {
    stopped.current = true;
    setWalk((current) => (current ? { ...current, running: false, stop: 'stopped' } : current));
  };

  const goOn = () => {
    if (!term || !channelId || !resume.current) return;
    void run(resume.current, term, channelId);
  };

  const results = useMemo(
    () => (term ? mergeHits(matchMessages(searchable, term).slice(0, 100), older) : []),
    [term, searchable, older],
  );

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
        {term && results.length === 0 && !walk?.running && (
          <p className="px-2 py-4 text-sm text-slate-400">
            {walk ? 'Nothing found in the part of the history searched.' : 'Nothing in the loaded history matches.'}
          </p>
        )}

        <ul className="space-y-2">
          {results.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => void revealMessage(message.id)}
                className="w-full cursor-pointer rounded-lg bg-surface-800 p-2.5 text-start transition-colors duration-200 hover:bg-white/[0.06]"
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

      <div className="shrink-0 space-y-1.5 border-t border-edge px-3 py-2 text-xs text-slate-500">
        {walk ? (
          <p role="status" aria-live="polite">
            {walkStatus(
              walk.running ? null : walk.stop,
              walk.scanned,
              walk.oldestAt ? dayLabel(walk.oldestAt) : null,
            )}
          </p>
        ) : (
          <p>
            Searches the {searchable.length} messages this window has decrypted. Messages are
            encrypted, so the server cannot search them.
          </p>
        )}
        {walk?.running && (
          <button
            type="button"
            onClick={stop}
            className="cursor-pointer rounded bg-surface-800 px-2 py-1 text-slate-200 hover:bg-white/[0.08]"
          >
            Stop
          </button>
        )}
        {walk && !walk.running && (walk.stop === 'cap' || walk.stop === 'stopped' || walk.stop === 'error') && (
          <button
            type="button"
            onClick={goOn}
            className="cursor-pointer rounded bg-surface-800 px-2 py-1 text-slate-200 hover:bg-white/[0.08]"
          >
            {walk.stop === 'error' ? 'Try again' : 'Search further back'}
          </button>
        )}
      </div>
    </aside>
  );
}

/** Trims a long body down to the part the term is actually in. */
function highlight(message: DecryptedMessage, query: string): string {
  const at = message.content.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at <= 60) return message.content.slice(0, 160);
  return `…${message.content.slice(at - 40, at + 120)}`;
}
