/**
 * One line at the top of the window when this machine's clock is wrong.
 *
 * The same strip as VersionNotice next to it. A clock that is out by minutes
 * cannot open anything - every expiry is decided on the server, and
 * `services/server-clock.ts` says why that is not negotiable - but it does make
 * the app lie quietly to the person reading it: yesterday's conversation filed
 * under "Today", an invite still offered after it lapsed. Saying so once, where
 * it can be dismissed, is the difference between a wrong clock and software
 * that looks broken.
 */
import { clockIsWrong, skewWording, useServerClock } from '../services/server-clock';
import { ClockIcon, XIcon } from './icons';
import { useState } from 'react';

export function ClockNotice(): JSX.Element | null {
  const offsetMs = useServerClock((state) => state.offsetMs);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !clockIsWrong(offsetMs)) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-200"
    >
      <ClockIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{skewWording(offsetMs)}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="cursor-pointer rounded p-0.5 transition-colors duration-150 hover:bg-white/10"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
