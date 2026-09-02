import { useEffect, useMemo } from 'react';
import { commandKey, shortcuts, type Shortcut } from '../services/shortcuts';
import { useFocusTrap } from '../services/focus-trap';

/**
 * What the keyboard can do, on `?`.
 *
 * The list itself lives in `services/shortcuts.ts` so that adding a binding and
 * telling anybody about it are the same edit. A shortcut whose only record is
 * the handler that implements it is one nobody presses.
 *
 * Grouped by where each works, because "nothing happened" is what an
 * unqualified list produces: `F` full-screens a call and does nothing in a
 * conversation, and a sheet that does not say so has taught somebody the app is
 * broken.
 */
export function ShortcutSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const groups = useMemo(() => {
    const all = shortcuts(commandKey());
    const order: Shortcut['where'][] = ['Anywhere', 'In a conversation', 'In a call'];
    return order
      .map((where) => ({ where, items: all.filter((entry) => entry.where === where) }))
      .filter((group) => group.items.length > 0);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex animate-fade justify-center bg-black/50 px-2 pt-[6vh] sm:px-4 sm:pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="h-fit w-full max-w-lg animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 shadow-pop"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-edge px-4 py-3">
          <h2 className="text-[15px] font-semibold text-slate-100">Keyboard shortcuts</h2>
        </header>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {groups.map((group) => (
            <section key={group.where} className="mb-2 last:mb-0">
              <h3 className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group.where}
              </h3>
              <ul>
                {group.items.map((entry) => (
                  <li
                    key={`${group.where}:${entry.keys.join('+')}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2"
                  >
                    <span className="min-w-0 flex-1 text-sm text-slate-200">{entry.what}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {entry.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded border border-edge bg-surface-700 px-1.5 py-0.5 text-xs font-medium text-slate-200"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
