import { useState } from 'react';
import { useFocusTrap } from '../../services/focus-trap';

/**
 * One dialog for the two things a category's name is asked for: making one,
 * and renaming one. `onSubmit` throws to show a failure inline.
 */
export function CategoryDialog({
  title,
  action,
  initial = '',
  onSubmit,
  onClose,
}: {
  title: string;
  action: string;
  initial?: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That could not be saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 p-6 text-start shadow-pop"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-50">{title}</h2>
        <label
          htmlFor="category-name"
          className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-300"
        >
          Category name
        </label>
        <input
          id="category-name"
          autoFocus
          value={name}
          maxLength={64}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
            if (event.key === 'Escape') onClose();
          }}
          className="mt-2 w-full rounded-lg border border-edge bg-surface-950 px-3 py-2.5 text-slate-100 outline-none transition-colors focus:border-accent/60"
          placeholder="Games"
        />
        {failure && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {failure}
          </p>
        )}
        <div className="-mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t border-edge bg-black/20 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working...' : action}
          </button>
        </div>
      </div>
    </div>
  );
}
