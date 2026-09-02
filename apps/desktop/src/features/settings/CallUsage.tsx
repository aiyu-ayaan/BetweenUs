/**
 * Calls & Data: what this account's calls have cost, and what each one did.
 *
 * The page a call log hangs under. The log alone answers "when did I talk to
 * them"; it cannot answer "why was my month 12 GB", because a mesh call is not
 * one connection but one per other person and they do not behave alike - the
 * one that went through a relay is usually the whole answer.
 *
 * Everything drawn here is measured by the clients, not by any server: media
 * goes directly between the people in a call, so nothing in the backend is in
 * the path to count a byte. That is also why a call the app was killed in
 * reports nothing at all, which is said on the page rather than hidden.
 *
 * ponytail: the chart is a row of divs rather than a charting library. It is
 * one stacked series over one bounded window; a dependency for that is a
 * megabyte to draw thirty rectangles.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CallAnalytics, CallHistoryEntry, CallLinkReport } from '@betweenus/shared-types';
import { api } from '../../services/api';
import { formatBytes } from '../../services/attachments';
import { formatCallDuration } from '../../services/call-stats';

/** What the server sends back for the log, said here so the page is not a guess. */
const HISTORY_SHOWN = 50;

/** The windows worth offering: a week, a month, a quarter. */
const RANGES = [7, 30, 90] as const;

export function CallUsageSection(): JSX.Element {
  const [days, setDays] = useState<number>(30);
  const [analytics, setAnalytics] = useState<CallAnalytics | null>(null);
  const [entries, setEntries] = useState<CallHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setAnalytics(null);
    Promise.all([api.callAnalytics(days), api.callHistory()])
      .then(([usage, history]) => {
        if (!live) return;
        setAnalytics(usage);
        setEntries(history);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Could not load your calls');
      });
    return () => {
      live = false;
    };
  }, [days]);

  const totals = analytics?.totals;
  const totalBytes = totals ? totals.bytesSent + totals.bytesReceived : 0;

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Calls &amp; Data</h1>
      <p className="mt-2 text-sm text-slate-400">
        Every call this account has been in, and what it moved. Media goes directly between the
        people in a call, so these are your own machine&apos;s numbers rather than a server&apos;s -
        a call the app was killed in has none to report.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-1.5" role="group" aria-label="How far back to look">
        {RANGES.map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => setDays(range)}
            aria-pressed={days === range}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              days === range
                ? 'bg-accent text-white'
                : 'bg-surface-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {range} days
          </button>
        ))}
      </div>

      {analytics === null && !error && <p className="mt-5 text-sm text-slate-500">Loading…</p>}

      {analytics && totals && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Total label="Data used" value={formatBytes(totalBytes)}>
              {formatBytes(totals.bytesSent)} up · {formatBytes(totals.bytesReceived)} down
            </Total>
            <Total label="Time in calls" value={formatCallDuration(totals.seconds)}>
              across {totals.calls} {totals.calls === 1 ? 'call' : 'calls'}
            </Total>
            <Total label="How it connected" value={describeTransport(analytics.transport)}>
              {analytics.transport.relay > 0
                ? `${analytics.transport.relay} of ${linkCount(analytics)} links went through a relay`
                : 'nothing needed a relay'}
            </Total>
          </div>

          <UsageChart daily={analytics.daily} />

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Ranked
              title="Busiest channels"
              empty="No calls in this window."
              rows={analytics.channels.map((channel) => ({
                key: channel.channelId,
                label: channel.serverName
                  ? `${channel.serverName} · ${channel.channelName}`
                  : channel.channelName,
                value: formatCallDuration(channel.seconds),
                sub: formatBytes(channel.bytesSent + channel.bytesReceived),
              }))}
            />
            <Ranked
              title="Most time with"
              empty="Nobody else was in them."
              rows={analytics.peers.map((peer) => ({
                key: peer.id,
                label: peer.displayName || peer.username,
                value: formatCallDuration(peer.seconds),
                sub: `${peer.calls} ${peer.calls === 1 ? 'call' : 'calls'}`,
              }))}
            />
          </div>
        </>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Call history
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Your last {HISTORY_SHOWN} calls, newest first. Open one for what each connection in it did.
      </p>

      {entries?.length === 0 && (
        <p className="mt-4 text-sm text-slate-500">
          No calls yet. Join a voice channel and this fills itself in.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {(entries ?? []).map((entry) => (
          <li key={entry.id} className="overflow-hidden rounded-lg bg-surface-800">
            <button
              type="button"
              onClick={() => setOpen(open === entry.id ? null : entry.id)}
              aria-expanded={open === entry.id}
              className="w-full px-4 py-3 text-start transition hover:bg-surface-700/60"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium text-slate-100">
                  {entry.serverName ? `${entry.serverName} · ` : ''}
                  {entry.channelName}
                </p>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {entry.durationSeconds === null
                    ? 'no ending recorded'
                    : formatCallDuration(entry.durationSeconds)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {describeWhen(entry.joinedAt)} · {describeWho(entry.peers)} ·{' '}
                {entry.bytes > 0 ? formatBytes(entry.bytes) : 'no data recorded'}
              </p>
            </button>

            {open === entry.id && <CallDetail entry={entry} />}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * One call, opened up: when it ran, and one row per connection it held.
 *
 * The per-link rows are the part worth having. Two people in the same call can
 * have completely different answers about whether it went direct, and an
 * expensive call is nearly always one link doing something the others were not.
 */
function CallDetail({ entry }: { entry: CallHistoryEntry }): JSX.Element {
  return (
    <div className="border-t border-white/5 bg-surface-900/40 px-4 py-3">
      <dl className="grid grid-cols-3 gap-3 text-xs">
        <Fact label="Started">{new Date(entry.joinedAt).toLocaleString()}</Fact>
        <Fact label="Ended">
          {entry.endedAt ? new Date(entry.endedAt).toLocaleString() : 'never recorded'}
        </Fact>
        <Fact label="Data">
          {entry.bytesSent + entry.bytesReceived > 0
            ? `${formatBytes(entry.bytesSent)} up · ${formatBytes(entry.bytesReceived)} down`
            : 'nothing reported'}
        </Fact>
      </dl>

      {entry.links.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          No connection detail for this call. The client reports it on the way out, so a call the
          app was killed in - or one from an older build - has none.
        </p>
      ) : (
        <table className="mt-3 w-full text-start text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 font-medium">Connection</th>
              <th className="py-1 font-medium">Path</th>
              <th className="py-1 text-end font-medium">Up</th>
              <th className="py-1 text-end font-medium">Down</th>
              <th className="py-1 text-end font-medium">Ping</th>
              <th className="py-1 text-end font-medium">Loss</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {entry.links.map((link) => (
              <tr key={`${link.userId}-${link.username}`} className="border-t border-white/5">
                <td className="py-1.5 pe-2 truncate">{link.username || link.userId}</td>
                <td className="py-1.5 pe-2">
                  <span className={link.transport === 'relay' ? 'text-amber-300' : 'text-slate-400'}>
                    {link.transport === 'relay'
                      ? 'relayed'
                      : link.transport === 'direct'
                        ? 'direct'
                        : 'unknown'}
                  </span>
                </td>
                <td className="py-1.5 text-end tabular-nums">{formatBytes(link.bytesSent)}</td>
                <td className="py-1.5 text-end tabular-nums">{formatBytes(link.bytesReceived)}</td>
                <td className="py-1.5 text-end tabular-nums">
                  {link.roundTripMs === null ? '—' : `${link.roundTripMs} ms`}
                </td>
                <td className="py-1.5 text-end tabular-nums">{describeLoss(link)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * A day per bar, sent stacked on received.
 *
 * Drawn against the busiest day in the window rather than a fixed ceiling: what
 * a person reads off this is the shape of their month, and a scale that never
 * moves turns every ordinary week into a flat line at the bottom.
 */
function UsageChart({ daily }: { daily: CallAnalytics['daily'] }): JSX.Element {
  const peak = useMemo(
    () => Math.max(1, ...daily.map((day) => day.bytesSent + day.bytesReceived)),
    [daily],
  );

  return (
    <div className="mt-4 rounded-lg bg-surface-800 p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-slate-400">Data per day</p>
        <p className="text-xs tabular-nums text-slate-500">busiest day {formatBytes(peak)}</p>
      </div>

      <div className="mt-3 flex h-28 items-end gap-[2px]">
        {daily.map((day) => {
          const total = day.bytesSent + day.bytesReceived;
          const height = (total / peak) * 100;
          return (
            <div
              key={day.date}
              title={`${day.date}: ${formatBytes(total)} · ${formatCallDuration(day.seconds)}`}
              className="flex h-full flex-1 flex-col justify-end"
            >
              {/* Two stacked pieces rather than two charts: the question is how
                  much of a day's total was upload, which a stack answers. */}
              <div
                className="w-full rounded-t-sm bg-accent"
                style={{ height: `${(day.bytesSent / peak) * 100}%` }}
              />
              <div
                className="w-full bg-accent/40"
                style={{ height: `${(day.bytesReceived / peak) * 100}%` }}
              />
              {/* A day with nothing in it still gets a floor, so the axis reads
                  as a row of days rather than as a gap. */}
              {height === 0 && <div className="h-[2px] w-full rounded-sm bg-white/5" />}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>{daily[0]?.date ?? ''}</span>
        <span className="flex items-center gap-3">
          <Key className="bg-accent">sent</Key>
          <Key className="bg-accent/40">received</Key>
        </span>
        <span>{daily[daily.length - 1]?.date ?? ''}</span>
      </div>
    </div>
  );
}

function Key({ className, children }: { className: string; children: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-sm ${className}`} />
      {children}
    </span>
  );
}

function Ranked({
  title,
  empty,
  rows,
}: {
  title: string;
  empty: string;
  rows: Array<{ key: string; label: string; value: string; sub: string }>;
}): JSX.Element {
  return (
    <div className="rounded-lg bg-surface-800 p-4">
      <p className="text-xs text-slate-400">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <li key={row.key} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-slate-200">{row.label}</span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {row.value} · {row.sub}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Total({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-lg bg-surface-800 px-4 py-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">{value}</p>
      {children && <p className="mt-0.5 text-[11px] text-slate-500">{children}</p>}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-300">{children}</dd>
    </div>
  );
}

function linkCount(analytics: CallAnalytics): number {
  const { direct, relay, unknown } = analytics.transport;
  return direct + relay + unknown;
}

/** The headline answer: relayed at all, all direct, or nothing measured yet. */
function describeTransport(transport: CallAnalytics['transport']): string {
  if (transport.direct + transport.relay === 0) return 'not measured';
  if (transport.relay === 0) return 'all direct';
  const share = Math.round((transport.relay / (transport.direct + transport.relay)) * 100);
  return `${share}% relayed`;
}

function describeLoss(link: CallLinkReport): string {
  const total = link.packetsLost + link.packetsReceived;
  if (total === 0) return '—';
  return `${Math.round((link.packetsLost / total) * 1000) / 10}%`;
}

function describeWhen(iso: string): string {
  const at = new Date(iso);
  const sameDay = new Date().toDateString() === at.toDateString();
  return sameDay
    ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Who else was there, by name up to three of them.
 *
 * "Alone" is a real answer and worth saying: a call somebody sat in by
 * themselves waiting for anybody to join is the entry they are most likely to
 * be looking for when they ask why nothing happened.
 */
function describeWho(peers: CallHistoryEntry['peers']): string {
  if (peers.length === 0) return 'alone';
  const names = peers.map((peer) => peer.displayName || peer.username);
  if (names.length <= 3) return `with ${names.join(', ')}`;
  return `with ${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}
