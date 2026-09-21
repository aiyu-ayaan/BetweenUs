import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { serverNow } from '../../services/server-clock';
import {
  checkDue,
  dueLabel,
  parseLocalDateTime,
  resolvePreset,
  toLocalDateTime,
  type Preset,
} from '../../services/schedule';
import { ClockIcon } from '../../components/icons';

/**
 * "When?" - a few presets and a date-and-time box, for a scheduled message and
 * for a reminder alike.
 *
 * Every preset shows the time it resolves to, worked out on open: "Tomorrow
 * morning" means nothing precise until it says 9:00, and a person scheduling
 * across midnight is exactly who needs to see which tomorrow it is.
 *
 * The custom box is a native `datetime-local`, which is in the reader's own
 * zone and their own date format, and which every runtime this ships in draws
 * as a proper picker.
 *
 * Drawn into `document.body`: the composer that opens it is a `<form>`, and the
 * custom box is one of its own - a form inside a form is not HTML, and the
 * inner submit would have sent the message.
 */
export function WhenPicker({
  at,
  title,
  presets,
  confirmLabel,
  note,
  initial,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  title: string;
  presets: ReadonlyArray<{ preset: Preset; label: string }>;
  confirmLabel: string;
  /** A line under the title, for the one thing worth knowing before choosing. */
  note?: string;
  /** Prefills the custom box, when a time is being changed rather than chosen. */
  initial?: number;
  onPick: (dueAt: number) => void;
  onClose: () => void;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const now = serverNow();
  const [custom, setCustom] = useState(() =>
    toLocalDateTime(initial ?? resolvePreset('in-1-hour', new Date(now))),
  );
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', escape);
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  const choose = (dueAt: number): void => {
    const check = checkDue(dueAt, serverNow());
    if (!check.ok) {
      setProblem(check.message);
      return;
    }
    onPick(dueAt);
    onClose();
  };

  const width = 272;
  const height = 150 + presets.length * 40;
  const left = Math.max(8, Math.min(at.x - width / 2, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(at.y - height, window.innerHeight - height - 8));

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={title}
      style={{ left, top, width }}
      className="fixed z-50 animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 py-1 shadow-pop"
    >
      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <ClockIcon className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      {note && <p className="px-3 pb-1 text-xs text-slate-500">{note}</p>}

      <ul className="py-1">
        {presets.map(({ preset, label }) => {
          const dueAt = resolvePreset(preset, new Date(now));
          return (
            <li key={preset}>
              <button
                type="button"
                onClick={() => choose(dueAt)}
                className="flex w-full cursor-pointer items-baseline gap-2 px-3 py-2 text-start text-sm text-slate-200 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
              >
                <span className="flex-1">{label}</span>
                <span className="text-xs text-slate-500">{dueLabel(dueAt, new Date(now))}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <form
        className="border-t border-edge px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseLocalDateTime(custom);
          choose(parsed ?? Number.NaN);
        }}
      >
        <label htmlFor="when-custom" className="mb-1 block text-xs text-slate-400">
          Pick a date and time
        </label>
        <div className="flex items-center gap-2">
          <input
            id="when-custom"
            type="datetime-local"
            value={custom}
            min={toLocalDateTime(now)}
            onChange={(event) => {
              setCustom(event.target.value);
              setProblem(null);
            }}
            className="min-w-0 flex-1 rounded-md border border-edge bg-surface-800 px-2 py-1 text-sm text-slate-100 focus:border-white/[0.14] focus:outline-none"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-white transition-opacity duration-150 hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
        {problem && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {problem}
          </p>
        )}
      </form>
    </div>,
    document.body,
  );
}
