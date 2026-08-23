import { useEffect, useState } from 'react';
import { useVoiceStore } from '../../stores/voice';
import { formatCallDuration } from '../../services/call-stats';

/**
 * How long the call has been running.
 *
 * The phone has had this from the beginning and neither of the other two
 * clients did, which was not a decision: on Android an ongoing-call
 * notification counts itself, and a desktop window or a browser tab has no
 * notification to hang that on. So it is drawn here.
 *
 * The clock is ticked rather than stored. Keeping a running count in the store
 * would be a state write a second for the length of every call, waking every
 * subscriber to the voice store each time - the participants list, the
 * controls, the tiles - to redraw one line of text. A local tick redraws
 * exactly this.
 *
 * It reads the wall clock on every tick rather than counting its own ticks,
 * because a timer that is throttled - which a background window's is,
 * aggressively - loses time, and a call clock that runs slow while the window
 * is behind another one is worse than no clock.
 */
export function CallDuration(): JSX.Element | null {
  const connectedAt = useVoiceStore((state) => state.connectedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (connectedAt === null) return;
    // Set immediately as well as on the interval: mounting this a second into
    // a call should not show 00:00 for a second.
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connectedAt]);

  if (connectedAt === null) return null;

  return (
    <span
      // A live region would announce every second, which is a screen reader
      // reading a clock aloud for the length of a call. The duration is
      // available on demand, like a clock on a wall.
      aria-label="Call duration"
      className="shrink-0 font-mono text-slate-400 tabular-nums"
    >
      {formatCallDuration((now - connectedAt) / 1000)}
    </span>
  );
}
