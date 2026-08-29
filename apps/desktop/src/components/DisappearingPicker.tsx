/**
 * Picking a disappearing window.
 *
 * One component for both places it is asked, because it is the same question
 * asked of two different things - a server's window and an account's own - and
 * two pickers would be two chances to disagree about what the durations are
 * called or which order they come in.
 *
 * A row of buttons rather than a `<select>`: there are five options, they are
 * all short, and the one that matters most is "Off" - which a dropdown hides
 * behind a click. Seeing the current setting without opening anything is the
 * whole point of a control like this.
 */
import { DISAPPEARING_WINDOWS, disappearingWindowLabel } from '@betweenus/shared-types';

export function DisappearingPicker({
  value,
  disabled = false,
  onChange,
}: {
  /** Seconds, or null for off. */
  value: number | null;
  disabled?: boolean;
  onChange: (next: number | null) => void;
}): JSX.Element {
  // Off first, then shortest to longest. The list itself is ordered - see the
  // check beside it - so nothing is sorted here.
  const options: Array<number | null> = [null, ...DISAPPEARING_WINDOWS];

  return (
    <div role="radiogroup" aria-label="Disappearing messages" className="mt-4 flex flex-wrap gap-2">
      {options.map((seconds) => {
        const on = seconds === value;
        return (
          <button
            key={seconds ?? 'off'}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(seconds)}
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
              on
                ? 'border-accent bg-accent/15 text-slate-100'
                : 'border-edge text-slate-300 hover:border-accent hover:text-slate-100'
            }`}
          >
            {disappearingWindowLabel(seconds)}
          </button>
        );
      })}
    </div>
  );
}
