/**
 * The `:` menu: type two letters and pick an emoji without leaving the keyboard.
 *
 * The picker button already exists and is the wrong tool mid-sentence - it
 * takes a hand off the keyboard, covers the message, and has to be closed
 * again. Teams, Slack and Discord all answer this the same way and people
 * arrive expecting it: `:` then a name.
 *
 * It renders above the composer rather than at the caret. A menu that follows
 * the caret needs the caret's pixel position, which a textarea does not offer
 * without measuring the text in a mirror element - a well-known trick and a
 * well-known source of off-by-a-line bugs at every font size and wrap. Above
 * the box is where the composer's other popovers already are.
 */
import { useEffect, useState } from 'react';
import type { ServerEmoji } from '@nexora/shared-types';
import { EMOJI_SUGGESTION_LIMIT, searchEmoji, type NamedEmoji } from './emoji-names';
import { absoluteUrl } from '../../services/endpoint';

/**
 * One row of the menu: a Unicode emoji from the table, or one of this server's
 * own. They are the same choice to whoever is typing, so they are the same
 * list - the server's come first, because a server that has invented `:shipit:`
 * has invented it for a reason.
 */
type Suggestion =
  | { kind: 'unicode'; entry: NamedEmoji }
  | { kind: 'custom'; emoji: ServerEmoji };

function suggestionsFor(term: string, custom: readonly ServerEmoji[]): Suggestion[] {
  const needle = term.trim().toLowerCase().replace(/^:+/, '');

  const mine = custom
    .filter((emoji) => emoji.name.includes(needle))
    // Exact first, then a prefix, then anything containing it - the same
    // ranking the Unicode table uses, for the same reason.
    .sort((left, right) => rank(left.name, needle) - rank(right.name, needle))
    .map((emoji): Suggestion => ({ kind: 'custom', emoji }));

  const rest = searchEmoji(term, EMOJI_SUGGESTION_LIMIT).map(
    (entry): Suggestion => ({ kind: 'unicode', entry }),
  );

  return [...mine, ...rest].slice(0, EMOJI_SUGGESTION_LIMIT);
}

function rank(name: string, needle: string): number {
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  return 2;
}

export function EmojiSuggest({
  term,
  custom,
  onPick,
  onClose,
}: {
  /** What has been typed after the colon. */
  term: string;
  /** This server's own emoji, offered above the Unicode ones. */
  custom: readonly ServerEmoji[];
  /**
   * What to put in the box. A Unicode emoji is the character itself; a custom
   * one is its `:name:`, because the shortcode is what the message carries and
   * the picture is resolved from the manifest at render time.
   */
  onPick: (text: string) => void;
  onClose: () => void;
}): JSX.Element | null {
  const [matches, setMatches] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const found = suggestionsFor(term, custom);
    setMatches(found);
    // Back to the top whenever the term changes: keeping the index would leave
    // the highlight on whatever happens to be in that row now, which is how a
    // menu sends the wrong emoji.
    setActive(0);
  }, [term, custom]);

  /**
   * The keys are caught here rather than in the composer.
   *
   * Capture phase and on the window, because the textarea has its own handler
   * for Enter - it sends the message - and it must not while this is open.
   * That is the whole reason this listens instead of being handed events: the
   * two handlers disagree about what Enter means, and the one that is on screen
   * wins.
   */
  useEffect(() => {
    if (matches.length === 0) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((at) => (at + 1) % matches.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((at) => (at - 1 + matches.length) % matches.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const chosen = matches[active];
        if (chosen) onPick(textFor(chosen));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [matches, active, onPick, onClose]);

  if (matches.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Emoji suggestions"
      className="absolute bottom-full left-3.5 right-3.5 z-30 mb-2 overflow-hidden rounded-xl border border-edge bg-surface-900 py-1 shadow-pop"
    >
      <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">
        Emoji matching :{term}
      </p>
      <ul>
        {matches.map((match, index) => (
          <li key={match.kind === 'custom' ? match.emoji.id : match.entry.emoji}>
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              // The pointer must not take focus off the textarea: losing the
              // caret mid-insert is what turns a click into a message with the
              // half-typed shortcode still in it.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => onPick(textFor(match))}
              className={`flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors duration-100 ${
                index === active ? 'bg-white/[0.07]' : ''
              }`}
            >
              {match.kind === 'custom' ? (
                <>
                  <img
                    src={absoluteUrl(match.emoji.url)}
                    alt=""
                    className="h-[22px] w-[22px] object-contain"
                  />
                  <span className="text-sm text-slate-200">:{match.emoji.name}:</span>
                  <span className="ml-auto text-xs text-slate-500">
                    {match.emoji.animated ? 'this server · animated' : 'this server'}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-lg leading-none">{match.entry.emoji}</span>
                  <span className="text-sm text-slate-200">:{match.entry.names[0]}:</span>
                  {match.entry.names.length > 1 && (
                    <span className="ml-auto truncate text-xs text-slate-500">
                      {match.entry.names.slice(1).map((alias) => `:${alias}:`).join(' ')}
                    </span>
                  )}
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What choosing one puts in the box.
 *
 * A Unicode emoji is the character. A custom one stays `:name:` - the message
 * carries the shortcode and a manifest of pictures, so what goes in the
 * textarea is the thing that will still make sense if the emoji is deleted.
 */
function textFor(suggestion: Suggestion): string {
  return suggestion.kind === 'custom' ? `:${suggestion.emoji.name}:` : suggestion.entry.emoji;
}
