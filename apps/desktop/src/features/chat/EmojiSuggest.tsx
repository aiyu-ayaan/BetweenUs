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
import { EMOJI_SUGGESTION_LIMIT, searchEmoji, type NamedEmoji } from './emoji-names';

export function EmojiSuggest({
  term,
  onPick,
  onClose,
}: {
  /** What has been typed after the colon. */
  term: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
}): JSX.Element | null {
  const [matches, setMatches] = useState<NamedEmoji[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const found = searchEmoji(term, EMOJI_SUGGESTION_LIMIT);
    setMatches(found);
    // Back to the top whenever the term changes: keeping the index would leave
    // the highlight on whatever happens to be in that row now, which is how a
    // menu sends the wrong emoji.
    setActive(0);
  }, [term]);

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
        if (chosen) onPick(chosen.emoji);
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
          <li key={match.emoji}>
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              // The pointer must not take focus off the textarea: losing the
              // caret mid-insert is what turns a click into a message with the
              // half-typed shortcode still in it.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => onPick(match.emoji)}
              className={`flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors duration-100 ${
                index === active ? 'bg-white/[0.07]' : ''
              }`}
            >
              <span className="text-lg leading-none">{match.emoji}</span>
              <span className="text-sm text-slate-200">:{match.names[0]}:</span>
              {match.names.length > 1 && (
                <span className="ml-auto truncate text-xs text-slate-500">
                  {match.names.slice(1).map((alias) => `:${alias}:`).join(' ')}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
