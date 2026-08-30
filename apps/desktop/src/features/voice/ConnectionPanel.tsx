/**
 * What the call is doing, in numbers, for the person in it.
 *
 * "It looks bad" and "the link is bad" were the same sentence until this
 * existed, and telling them apart meant opening `chrome://webrtc-internals` -
 * which is not something to ask of somebody mid-meeting. One row per person,
 * the four numbers that decide how a call feels, and nothing else.
 */
import { useVoiceStore } from '../../stores/voice';
import { healthWarning, type LinkStats, type QualityLimit } from '../../services/call-stats';

/** `qualityLimitationReason`, said the way somebody in a call would say it. */
const LIMIT_REASON: Record<QualityLimit, string> = {
  bandwidth: 'the link',
  cpu: 'this PC',
  other: 'the encoder',
};

export function ConnectionPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const stats = useVoiceStore((state) => state.stats);
  const warning = healthWarning(stats);

  return (
    <div className="absolute bottom-full left-1/2 z-40 mb-2 w-[320px] -translate-x-1/2 animate-pop rounded-xl border border-edge bg-surface-900 p-3 shadow-pop">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Connection</h2>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded px-2 py-0.5 text-xs text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          Close
        </button>
      </div>

      {warning && <p className="mt-2 rounded bg-danger/10 px-2 py-1 text-xs text-danger">{warning}</p>}

      {stats.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          Nobody else is connected yet, so there is nothing to measure.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {stats.map((link) => (
            <PeerRow key={link.peerId} link={link} />
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-snug text-slate-500">
        Media goes straight between the two machines, so these are the two of you and whatever is
        between - no server is in this path to blame.
      </p>
    </div>
  );
}

function PeerRow({ link }: { link: LinkStats }): JSX.Element {
  const loss = link.lossPercent ?? 0;
  const rtt = link.roundTripMs ?? 0;

  return (
    <li className="rounded-lg bg-surface-800 px-3 py-2">
      <p className="truncate text-sm text-slate-100">{link.name}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <Stat label="Down" value={rate(link.downKbps)} />
        <Stat label="Up" value={rate(link.upKbps)} />
        <Stat
          label="Loss"
          value={link.lossPercent === null ? '—' : `${link.lossPercent}%`}
          tone={loss >= 5 ? 'bad' : loss >= 1 ? 'warn' : 'plain'}
        />
        <Stat
          label="Round trip"
          value={link.roundTripMs === null ? '—' : `${link.roundTripMs} ms`}
          tone={rtt >= 300 ? 'bad' : rtt >= 150 ? 'warn' : 'plain'}
        />
        {link.frameWidth && link.frameHeight && (
          <Stat
            label="In"
            value={`${link.frameWidth}×${link.frameHeight}${
              link.framesPerSecond ? ` @ ${link.framesPerSecond}` : ''
            }`}
          />
        )}
        {link.sendWidth && link.sendHeight && (
          <Stat label="Out" value={`${link.sendWidth}×${link.sendHeight}`} />
        )}
        {/*
          Only when something is actually holding the picture down, and it is
          the whole answer to "why did my share go soft": the link, this
          machine's encoder, or neither.
        */}
        {link.sendLimitedBy && (
          <Stat label="Held by" value={LIMIT_REASON[link.sendLimitedBy]} tone="warn" />
        )}
      </dl>
    </li>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'warn' | 'bad';
}): JSX.Element {
  const colour =
    tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-amber-300' : 'text-slate-200';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`tabular-nums ${colour}`}>{value}</dd>
    </div>
  );
}

/** Kilobits until it is silly, then megabits. A share is megabits. */
function rate(kbps: number | null): string {
  if (kbps === null) return '—';
  if (kbps < 1000) return `${kbps} kbps`;
  return `${(kbps / 1000).toFixed(1)} Mbps`;
}
