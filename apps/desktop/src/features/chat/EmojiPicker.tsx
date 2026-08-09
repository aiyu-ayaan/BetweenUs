import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOJI_GROUPS } from './emoji';

/**
 * A floating emoji grid. Used twice - by the composer to type one, and by a
 * message to react with one - so it knows nothing about either: it reports the
 * emoji that was chosen and closes.
 *
 * `anchor` is a screen position, because the picker is rendered `fixed` above
 * everything rather than inside a scrolling list that would clip it.
 */
export function EmojiPicker({
  anchor,
  onPick,
  onClose,
}: {
  anchor: { x: number; y: number };
  onPick: (emoji: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    // Deferred: the click that opened this must not immediately close it.
    const timer = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  // Search is by group name, because this set carries no shortcodes; it is
  // enough to get from "food" to the food row without scrolling.
  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return EMOJI_GROUPS;
    return EMOJI_GROUPS.filter((group) => group.name.toLowerCase().includes(term));
  }, [query]);

  const width = 320;
  const height = 360;
  const left = Math.min(Math.max(8, anchor.x - width / 2), window.innerWidth - width - 8);
  const top = Math.min(Math.max(8, anchor.y - height - 8), window.innerHeight - height - 8);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label="Pick an emoji"
      style={{ left, top, width, height }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-black/40 bg-surface-800 shadow-xl"
    >
      <div className="shrink-0 p-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search categories"
          aria-label="Search emoji categories"
          className="w-full rounded bg-surface-950 px-2.5 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((group) => (
          <section key={group.name}>
            <h3 className="sticky top-0 bg-surface-800 py-1 text-xs font-bold uppercase tracking-wide text-slate-400">
              {group.name}
            </h3>
            <div className="grid grid-cols-8 gap-0.5">
              {group.emoji.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onPick(emoji);
                    onClose();
                  }}
                  aria-label={emoji}
                  className="cursor-pointer rounded p-1 text-xl leading-none transition-colors duration-150 hover:bg-surface-700"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="p-3 text-sm text-slate-400">No category by that name.</p>}
      </div>
    </div>
  );
}
