import type { CallRingState } from '@betweenus/shared-types';
import { useOutgoingRingStore } from '../../stores/outgoing-ring';
import { api } from '../../services/api';
import { canRingAgain, ringStatusText } from './ring-status';

/**
 * "Ringing Ana…", "Ana declined the call", "Ana didn't answer".
 *
 * Drawn above the call for as long as the ring it describes is the news. A
 * declined or unanswered ring stays until the caller dismisses it or rings
 * again, because it is the answer to a question they are still waiting on.
 */
export function OutgoingRingStatus({
  channelId,
  compact = false,
}: {
  channelId: string;
  compact?: boolean;
}): JSX.Element | null {
  const ring = useOutgoingRingStore((state) => state.ring);
  const clear = useOutgoingRingStore((state) => state.clear);
  if (!ring || ring.channelId !== channelId) return null;

  const again = canRingAgain(ring.state);
  const tone: Record<typeof ring.state, string> = {
    ringing: 'bg-white/[0.06] text-slate-200',
    declined: 'bg-red-500/10 text-red-300',
    unanswered: 'bg-amber-500/10 text-amber-200',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-between gap-3 rounded ${tone[ring.state]} ${
        compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{ringStatusText(ring.state, ring.targetName)}</span>
      {again && (
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="cursor-pointer font-medium underline-offset-2 hover:underline"
            onClick={() => {
              // The cooldown may refuse a second ring inside thirty seconds; a
              // refusal is not worth a message when the status line is there.
              void api.callRing(ring.channelId, ring.targetId).catch(() => undefined);
            }}
          >
            Ring again
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            className="cursor-pointer opacity-70 hover:opacity-100"
            onClick={clear}
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
}

/** Kept here so the one place that maps the wire event to the store reads it too. */
export type { CallRingState };
