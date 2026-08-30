/**
 * Health & storage: what this deployment is made of, and whether it is well.
 *
 * The screen is split in two on purpose. `HealthScreen` owns the fetching, the
 * polling timer and the error banner; `HealthView` is a pure function of one
 * `AdminServerHealth` and draws every section from it. The backend endpoint is
 * new, so the only way to see the awkward shapes - an S3 driver that cannot
 * report a disk size, a component that is `down` and carries an error sentence,
 * a window with no traffic in it at all - is to hand the view a fixture and
 * render it. That is `HealthScreen.check.tsx`, and it is why the split exists.
 *
 * The rule this screen is written around: **a null is not a zero.** Several
 * fields are deliberately nullable because the number genuinely cannot be
 * known here - walking an S3 bucket to total it is not free, and a volume that
 * does not exist has no free space. Drawing those as "0 B" would be the panel
 * quietly inventing a measurement, which is worse than saying nothing. Every
 * one of them renders as "not measurable here" with the reason attached.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdminComponentHealth,
  AdminHealthState,
  AdminServerHealth,
} from '@betweenus/shared-types';
import { api } from '../api';
import { messageOf } from '../App';
import { formatBytes, formatCount, formatDuration, percentOf } from '../format';

/** How often the snapshot is retaken while the tab is open. */
const REFRESH_MS = 30_000;

/** Default bandwidth window, matching the endpoint's own default. */
const WINDOW_DAYS = 30;

/**
 * How each state is drawn.
 *
 * Every state carries a **glyph as well as a colour**. A red dot beside a green
 * dot is two grey dots to a deuteranopic operator, and this is a screen read
 * when something is already wrong - so the shape and the word do the work and
 * the colour is only there to make the right card catch the eye first.
 */
const STATES: Record<AdminHealthState, { label: string; glyph: string; text: string; ring: string }> =
  {
    up: { label: 'Up', glyph: '●', text: 'text-emerald-300', ring: 'border-emerald-500/40 bg-emerald-500/10' },
    degraded: {
      label: 'Degraded',
      glyph: '◐',
      text: 'text-amber-300',
      ring: 'border-amber-500/40 bg-amber-500/10',
    },
    down: { label: 'Down', glyph: '■', text: 'text-red-300', ring: 'border-red-500/40 bg-red-500/10' },
  };

export function HealthScreen(): JSX.Element {
  const [health, setHealth] = useState<AdminServerHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);

  // The timer must not restart every time a snapshot lands, so the callback is
  // held in a ref and the interval is set up once per live/paused change.
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setHealth(await api.health(WINDOW_DAYS));
      setError(null);
    } catch (caught) {
      // The previous snapshot is left on screen behind the banner. A panel that
      // blanks itself the moment one poll fails is a panel that hides the very
      // reading somebody was in the middle of.
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    void latest.current();
    if (!live) return;
    const timer = setInterval(() => void latest.current(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live]);

  return (
    <section aria-busy={loading}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {health ? (
          <StatePill state={health.overall} />
        ) : (
          <span className="text-sm text-slate-500">{loading ? 'Loading…' : 'No snapshot'}</span>
        )}

        {health && (
          <span className="text-sm text-slate-500">
            Snapshot {new Date(health.at).toLocaleString()}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLive((current) => !current)}
            aria-pressed={live}
            className="cursor-pointer rounded-md border border-surface-700 px-3 py-1.5 text-sm text-slate-300 transition-colors duration-200 hover:border-accent"
          >
            {live ? `Auto-refresh on (${REFRESH_MS / 1000}s)` : 'Auto-refresh paused'}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="cursor-pointer rounded-md border border-surface-700 px-3 py-1.5 text-sm text-slate-300 transition-colors duration-200 hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Refreshing…' : 'Refresh now'}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {health ? (
        <HealthView health={health} />
      ) : (
        !error && <p className="text-sm text-slate-500">Reading the deployment…</p>
      )}
    </section>
  );
}

/** Everything below the header, as a pure function of one snapshot. */
export function HealthView({ health }: { health: AdminServerHealth }): JSX.Element {
  return (
    <div className="space-y-6">
      <Components components={health.components} />
      <Runtime runtime={health.runtime} />
      <Database database={health.database} />
      <Media media={health.media} />
      <Bandwidth bandwidth={health.bandwidth} />
      <Live live={health.live} />
    </div>
  );
}

// --- Shared pieces ---

function StatePill({ state }: { state: AdminHealthState }): JSX.Element {
  const style = STATES[state];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${style.ring} ${style.text}`}
    >
      <span aria-hidden="true">{style.glyph}</span>
      {style.label}
    </span>
  );
}

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-surface-700 bg-surface-900/60 p-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** A labelled number with an optional unit line under it. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-slate-100">{value}</dd>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * A proportional bar. `tone` is only ever a *second* signal - the figure it
 * illustrates is always written out beside it in text.
 */
function Bar({ percent, tone = 'accent' }: { percent: number; tone?: 'accent' | 'warn' | 'alarm' }): JSX.Element {
  const fill =
    tone === 'alarm' ? 'bg-red-400' : tone === 'warn' ? 'bg-amber-400' : 'bg-accent';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-800" aria-hidden="true">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * What the panel says instead of a number it does not have.
 *
 * Never "0 B" and never an empty cell: both read as a measurement. The reason
 * is part of the answer, because "we cannot see this from here" and "there is
 * none of it" are different facts about the deployment.
 */
function NotMeasurable({ why }: { why: string }): JSX.Element {
  return (
    <span className="text-sm text-slate-500">
      Not measurable here <span className="text-slate-600">— {why}</span>
    </span>
  );
}

/** Copies a URL, and says so for a moment. Clipboard access can be refused. */
function CopyUrl({ url }: { url: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(url)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
        setTimeout(() => setCopied(false), 1500);
      }}
      className="cursor-pointer rounded border border-surface-700 px-2 py-0.5 text-xs text-slate-400 transition-colors duration-200 hover:border-accent hover:text-slate-200"
    >
      {copied ? 'Copied' : 'Copy'}
      <span className="sr-only"> {url}</span>
    </button>
  );
}

// --- Sections ---

function Components({ components }: { components: AdminComponentHealth[] }): JSX.Element {
  return (
    <Card title="Components">
      {components.length === 0 ? (
        <p className="text-sm text-slate-500">No dependencies were probed.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {components.map((component) => {
            const style = STATES[component.state];
            return (
              <li
                key={component.id}
                className={`rounded-md border bg-surface-900 p-3 ${style.ring.split(' ')[0] ?? ''}`}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={style.text}>
                    {style.glyph}
                  </span>
                  <span className="font-medium text-slate-100">{component.label}</span>
                  <span className={`ml-auto text-xs font-semibold ${style.text}`}>{style.label}</span>
                </div>

                <p className="mt-1 text-xs text-slate-400">
                  {/* Null latency means the probe never came back at all, which
                      is not the same as an instant answer. */}
                  {component.latencyMs === null ? 'No response' : `${component.latencyMs} ms`}
                </p>

                {component.url && (
                  <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                    {component.url}
                  </p>
                )}

                {component.error && (
                  <p className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-300">
                    {component.error}
                  </p>
                )}

                {component.detail && Object.keys(component.detail).length > 0 && (
                  <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
                    {Object.entries(component.detail).map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="text-slate-500">{key}</dt>
                        <dd className="truncate text-slate-300">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Runtime({ runtime }: { runtime: AdminServerHealth['runtime'] }): JSX.Element {
  const heapPercent = percentOf(runtime.memoryHeapUsedBytes, runtime.memoryHeapTotalBytes);
  // Windows reports no load average at all, and three zeroes there mean "not
  // available" rather than "idle" - saying so is the difference between an
  // operator trusting the row and puzzling over it.
  const hasLoad = runtime.loadAverage.some((value) => value > 0);

  return (
    <Card title="Runtime">
      <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Uptime" value={formatDuration(runtime.uptimeSeconds)} />
        <Stat label="Resident memory" value={formatBytes(runtime.memoryRssBytes)} />
        <Stat label="CPUs" value={formatCount(runtime.cpuCount)} />
        <Stat label="Node" value={runtime.nodeVersion} hint={runtime.platform} />
        <Stat label="App version" value={runtime.appVersion ?? 'unknown'} />
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Heap</dt>
          <dd className="mt-0.5 text-sm text-slate-200">
            {formatBytes(runtime.memoryHeapUsedBytes)} of{' '}
            {formatBytes(runtime.memoryHeapTotalBytes)} ({heapPercent.toFixed(0)}%)
          </dd>
          <div className="mt-1.5">
            <Bar percent={heapPercent} tone={heapPercent > 90 ? 'alarm' : 'accent'} />
          </div>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Load average</dt>
          <dd className="mt-0.5 text-sm text-slate-200">
            {hasLoad
              ? runtime.loadAverage.map((value) => value.toFixed(2)).join('  ·  ')
              : 'Not reported on this platform'}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function Database({ database }: { database: AdminServerHealth['database'] }): JSX.Element {
  const connectionPercent = percentOf(database.connections, database.maxConnections);
  const largest = database.tables[0]?.totalBytes ?? 0;

  return (
    <Card title="Database storage">
      <dl className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Total size" value={formatBytes(database.totalBytes)} />
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Connections</dt>
          <dd className="mt-0.5 text-lg font-semibold text-slate-100">
            {formatCount(database.connections)} / {formatCount(database.maxConnections)}
          </dd>
          <div className="mt-1.5">
            {/* Running out of backends takes the whole deployment down at once,
                so the bar warns well before the cap rather than at it. */}
            <Bar
              percent={connectionPercent}
              tone={connectionPercent >= 90 ? 'alarm' : connectionPercent >= 75 ? 'warn' : 'accent'}
            />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {connectionPercent >= 90
              ? 'Close to the cap'
              : connectionPercent >= 75
                ? 'Approaching the cap'
                : `${connectionPercent.toFixed(0)}% of the cap`}
          </p>
        </div>
        <Stat label="Server version" value={database.version ?? 'unknown'} />
      </dl>

      <div className="overflow-x-auto rounded-lg border border-surface-700">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Largest tables, biggest first</caption>
          <thead className="bg-surface-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2">Table</th>
              <th scope="col" className="px-4 py-2 text-right">Total</th>
              <th scope="col" className="px-4 py-2 text-right">Indexes</th>
              <th scope="col" className="px-4 py-2 text-right">Rows (est.)</th>
              <th scope="col" className="w-40 px-4 py-2">Share</th>
            </tr>
          </thead>
          <tbody>
            {database.tables.map((table) => (
              <tr key={table.table} className="border-t border-surface-700/60">
                <td className="px-4 py-2 font-mono text-xs text-slate-200">{table.table}</td>
                <td className="px-4 py-2 text-right text-slate-200">
                  {formatBytes(table.totalBytes)}
                </td>
                <td className="px-4 py-2 text-right text-slate-400">
                  {formatBytes(table.indexBytes)}
                </td>
                <td className="px-4 py-2 text-right text-slate-400">
                  {formatCount(table.rowEstimate)}
                </td>
                <td className="px-4 py-2">
                  <Bar percent={percentOf(table.totalBytes, largest)} />
                </td>
              </tr>
            ))}
            {database.tables.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  No table sizes were reported.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Media({ media }: { media: AdminServerHealth['media'] }): JSX.Element {
  const s3 = media.driver === 's3';

  return (
    <Card
      title="Media storage"
      action={
        <span className="rounded-full border border-surface-700 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
          {s3 ? 'S3 object storage' : 'Local disk'}
        </span>
      }
    >
      <dl className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Recorded size"
          value={formatBytes(media.recordedBytes)}
          hint="Sum of every stored object's recorded size"
        />
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">On disk</dt>
          <dd className="mt-0.5">
            {media.diskBytes === null ? (
              <NotMeasurable why={s3 ? 'walking the bucket is not free' : 'the volume did not answer'} />
            ) : (
              <span className="text-lg font-semibold text-slate-100">
                {formatBytes(media.diskBytes)}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Free space</dt>
          <dd className="mt-0.5">
            {media.diskFreeBytes === null ? (
              <NotMeasurable why={s3 ? 'object storage has no volume to be full' : 'the volume did not answer'} />
            ) : (
              <span className="text-lg font-semibold text-slate-100">
                {formatBytes(media.diskFreeBytes)}
              </span>
            )}
          </dd>
        </div>
        <Stat label="Attachments" value={formatCount(media.attachmentCount)} hint={media.location ?? undefined} />
      </dl>

      <div className="overflow-x-auto rounded-lg border border-surface-700">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Attachments by broad content type</caption>
          <thead className="bg-surface-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2">Kind</th>
              <th scope="col" className="px-4 py-2 text-right">Files</th>
              <th scope="col" className="px-4 py-2 text-right">Size</th>
              <th scope="col" className="w-40 px-4 py-2">Share</th>
            </tr>
          </thead>
          <tbody>
            {media.byKind.map((kind) => (
              <tr key={kind.kind} className="border-t border-surface-700/60">
                <td className="px-4 py-2 text-slate-200">{kind.kind}</td>
                <td className="px-4 py-2 text-right text-slate-400">{formatCount(kind.count)}</td>
                <td className="px-4 py-2 text-right text-slate-200">{formatBytes(kind.bytes)}</td>
                <td className="px-4 py-2">
                  <Bar percent={percentOf(kind.bytes, media.recordedBytes)} />
                </td>
              </tr>
            ))}
            {media.byKind.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Nothing has been uploaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Categorical slot 1 (blue) and slot 2 (orange), stepped for a dark surface. */
const SERIES_CALL = '#3987e5';
const SERIES_ATTACHMENT = '#d95926';

function Bandwidth({ bandwidth }: { bandwidth: AdminServerHealth['bandwidth'] }): JSX.Element {
  return (
    <Card
      title="Bandwidth"
      action={
        <span className="text-xs text-slate-500">Last {formatCount(bandwidth.windowDays)} days</span>
      }
    >
      <dl className="mb-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Call traffic"
          value={formatBytes(bandwidth.callBytes)}
          hint="Peer-to-peer; reported by the clients"
        />
        <Stat label="Sent" value={formatBytes(bandwidth.callBytesSent)} />
        <Stat label="Received" value={formatBytes(bandwidth.callBytesReceived)} />
        <Stat label="Call sessions" value={formatCount(bandwidth.callSessions)} />
        <Stat
          label="Attachments served"
          value={formatBytes(bandwidth.attachmentBytes)}
          hint={`${formatCount(bandwidth.attachmentCount)} files`}
        />
      </dl>

      <TrendChart daily={bandwidth.daily} />
    </Card>
  );
}

/**
 * Daily traffic, stacked, oldest on the left.
 *
 * Stacked rather than two lines because the two series share a unit and the
 * question is "how much moved, and which kind" - a stack answers both at once
 * where two lines make the reader add them up. One axis, always: the day the
 * panel puts call bytes and attachment bytes on separate scales is the day the
 * chart starts implying a relationship that is not in the data.
 *
 * The hover layer is a native SVG `<title>` per column rather than a scripted
 * tooltip - it is the whole of what a tooltip would say, it works on the
 * keyboard-less path, and it costs nothing. The `<details>` table underneath is
 * the non-visual reading of exactly the same numbers.
 */
function TrendChart({
  daily,
}: {
  daily: AdminServerHealth['bandwidth']['daily'];
}): JSX.Element {
  if (daily.length === 0) {
    return <p className="text-sm text-slate-500">No traffic recorded in this window.</p>;
  }

  const width = 720;
  const height = 150;
  const floor = height - 20; // room for the two date labels under the baseline
  const peak = Math.max(...daily.map((day) => day.callBytes + day.attachmentBytes), 1);
  const slot = width / daily.length;
  const barWidth = Math.max(2, Math.min(24, slot - 3));

  return (
    <figure className="m-0">
      <div className="mb-2 flex items-center gap-4 text-xs text-slate-400">
        {/* A legend is present because there are two series, and each swatch is
            named in text - identity is never carried by the colour alone. */}
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: SERIES_CALL }}
          />
          Call traffic
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: SERIES_ATTACHMENT }}
          />
          Attachments
        </span>
        <span className="ml-auto text-slate-500">Peak day {formatBytes(peak)}</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Daily traffic over ${daily.length} days, call traffic and attachments stacked. Peak day ${formatBytes(peak)}.`}
        className="block"
      >
        <line x1={0} y1={floor} x2={width} y2={floor} stroke="#334155" strokeWidth={1} />

        {daily.map((day, index) => {
          const total = day.callBytes + day.attachmentBytes;
          const totalHeight = (total / peak) * (floor - 6);
          const attachmentHeight = total > 0 ? (day.attachmentBytes / total) * totalHeight : 0;
          // A 2px surface gap keeps the two segments from reading as one block.
          const callHeight = Math.max(0, totalHeight - attachmentHeight - (attachmentHeight > 0 ? 2 : 0));
          const x = index * slot + (slot - barWidth) / 2;

          return (
            <g key={day.date}>
              <title>
                {`${day.date} — call ${formatBytes(day.callBytes)}, attachments ${formatBytes(
                  day.attachmentBytes,
                )}`}
              </title>
              {callHeight > 0 && (
                <rect
                  x={x}
                  y={floor - callHeight}
                  width={barWidth}
                  height={callHeight}
                  rx={attachmentHeight > 0 ? 0 : 2}
                  fill={SERIES_CALL}
                />
              )}
              {attachmentHeight > 0 && (
                <rect
                  x={x}
                  y={floor - totalHeight}
                  width={barWidth}
                  height={attachmentHeight}
                  rx={2}
                  fill={SERIES_ATTACHMENT}
                />
              )}
            </g>
          );
        })}

        {/* Only the ends are labelled. A tick per day is unreadable at 30 and
            tells nobody anything the two endpoints do not. */}
        <text x={0} y={height - 4} fill="#94a3b8" fontSize={11}>
          {daily[0]?.date ?? ''}
        </text>
        <text x={width} y={height - 4} fill="#94a3b8" fontSize={11} textAnchor="end">
          {daily[daily.length - 1]?.date ?? ''}
        </text>
      </svg>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
          Show the daily figures as a table
        </summary>
        <div className="mt-2 overflow-x-auto rounded-lg border border-surface-700">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Daily call and attachment traffic</caption>
            <thead className="bg-surface-800 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2">Day</th>
                <th scope="col" className="px-4 py-2 text-right">Call traffic</th>
                <th scope="col" className="px-4 py-2 text-right">Attachments</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((day) => (
                <tr key={day.date} className="border-t border-surface-700/60">
                  <td className="px-4 py-1.5 text-slate-300">{day.date}</td>
                  <td className="px-4 py-1.5 text-right text-slate-200">
                    {formatBytes(day.callBytes)}
                  </td>
                  <td className="px-4 py-1.5 text-right text-slate-200">
                    {formatBytes(day.attachmentBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function Live({ live }: { live: AdminServerHealth['live'] }): JSX.Element {
  return (
    <Card title="Live connections">
      <dl className="mb-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Online users" value={formatCount(live.onlineUsers)} />
        <Stat
          label="Sockets"
          value={formatCount(live.totalSockets)}
          hint="More than users when somebody has two clients open"
        />
        <Stat label="Active calls" value={formatCount(live.activeCalls)} />
        <Stat label="In calls" value={formatCount(live.activeCallParticipants)} />
        <Stat label="Remote sessions" value={formatCount(live.activeRemoteSessions)} />
      </dl>

      <div className="overflow-x-auto rounded-lg border border-surface-700">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Realtime endpoints and their socket counts</caption>
          <thead className="bg-surface-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2">Endpoint</th>
              <th scope="col" className="px-4 py-2">URL</th>
              <th scope="col" className="px-4 py-2 text-right">Sockets</th>
              <th scope="col" className="px-4 py-2">State</th>
            </tr>
          </thead>
          <tbody>
            {live.endpoints.map((endpoint) => {
              const style = STATES[endpoint.state];
              return (
                <tr key={endpoint.id} className="border-t border-surface-700/60">
                  <td className="px-4 py-2 text-slate-200">{endpoint.label}</td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="break-all font-mono text-xs text-slate-400">
                        {endpoint.url}
                      </span>
                      <CopyUrl url={endpoint.url} />
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-200">
                    {formatCount(endpoint.connections)}
                  </td>
                  <td className={`px-4 py-2 ${style.text}`}>
                    <span aria-hidden="true">{style.glyph}</span> {style.label}
                  </td>
                </tr>
              );
            })}
            {live.endpoints.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  No realtime endpoints were reported.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
