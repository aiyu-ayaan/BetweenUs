/**
 * Admin panel: server health, storage and bandwidth.
 *
 * This is the screen somebody opens when they have been woken up, so the whole
 * thing is built around one rule: **a dead dependency degrades its own card and
 * nothing else**. Every probe below is wrapped, timed and given a deadline of
 * its own; the endpoint answers 200 with a page full of red rather than a 500
 * that says nothing about which of eight things is broken.
 *
 * The other rule is that nothing here is invented. Where a number cannot be
 * known honestly - the byte count of an S3 bucket, the socket count of a
 * gateway that keeps no per-socket bookkeeping - the field is null, or zero
 * with a comment saying why, rather than a plausible-looking guess.
 */
import { Injectable } from '@nestjs/common';
import { cpus, loadavg, platform } from 'node:os';
import { readdir, stat, statfs } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Redis from 'ioredis';
import { envOr, isProduction } from '@betweenus/config';
import { prisma } from '@betweenus/database';
import { getStorage, isS3Configured } from '@betweenus/storage';
import type {
  AdminBandwidth,
  AdminComponentHealth,
  AdminDatabaseStorage,
  AdminHealthState,
  AdminLiveConnections,
  AdminLiveEndpoint,
  AdminMediaStorage,
  AdminRelayHealth,
  AdminRuntimeHealth,
  AdminServerHealth,
  AdminTableSize,
} from '@betweenus/shared-types';
import { publicBaseUrl } from './oauth-providers';

/** How long any single probe gets before it is called `down`. */
const PROBE_TIMEOUT_MS = 2_500;

/**
 * Version from package.json, read once at startup. Used as the last fallback
 * for `appVersion` when neither `APP_VERSION` nor `npm_package_version` is set
 * (which happens when the process is started directly with `node dist/main.js`).
 */
const PACKAGE_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
})();

/** Slower than this and the component is answering, but not well. */
const SLOW_MS = 750;

/**
 * The relay probe is two UDP round trips to another host, so it gets longer
 * than a local dependency does. Still bounded: a dead relay must not hold the
 * health page open.
 */
const RELAY_PROBE_TIMEOUT_MS = 6_000;

/** Biggest tables only: the panel draws a list, not a schema dump. */
const TABLE_LIMIT = 15;

/** Presence entries older than this are a client that died without saying so. */
const PRESENCE_STALE_MS = 90_000;

/** Bandwidth window bounds. A year of daily buckets is already a long chart. */
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_WINDOW_DAYS = 30;

/**
 * The window, clamped.
 *
 * A query string is a stranger: `?days=99999999` is a full sequential scan of
 * every call ever made, and `?days=-1` is a window that ends before it starts
 * and quietly returns nothing at all. Both come back as a number the chart can
 * draw.
 */
export function clampWindowDays(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.max(Math.trunc(value), MIN_WINDOW_DAYS), MAX_WINDOW_DAYS);
}

/**
 * The worst of several states, which is what the header badge shows.
 *
 * Deliberately pessimistic: one component down makes the deployment down, even
 * with seven green cards beside it, because a panel whose badge stays green
 * while Postgres is unreachable is a panel nobody will trust twice.
 */
export function worstState(states: AdminHealthState[]): AdminHealthState {
  if (states.includes('down')) return 'down';
  if (states.includes('degraded')) return 'degraded';
  return 'up';
}

/** A probe that answered, judged on how long it took about it. */
export function stateForLatency(latencyMs: number): AdminHealthState {
  return latencyMs > SLOW_MS ? 'degraded' : 'up';
}

/**
 * A connection string with any credentials taken out of it.
 *
 * `DATABASE_URL` and `REDIS_URL` both routinely carry `user:password@`, and
 * this response goes to a browser and into whatever that browser's console, an
 * error reporter or a support screenshot does with it next. Everything else
 * about the URL - scheme, host, port, database - is exactly what somebody
 * reading the panel needs, so only the userinfo is removed.
 *
 * The query string is searched too, and not as an afterthought: `?password=`
 * and `?sslpassword=` are ordinary in a Postgres URL, and `new URL` happily
 * parses `host:5432/db?password=hunter2` by reading `host:` as the scheme - so
 * a redaction that only cleared the userinfo would hand that one straight back
 * with the password still in it. That was a real failure of the first version
 * of this function, caught by the self-check rather than by a screenshot.
 *
 * A string that does not parse at all is not handed back on the chance that it
 * is harmless: it is replaced wholesale, because the one case that matters is
 * the malformed string that still has a secret in it.
 */
const SECRET_PARAM = /pass|secret|token|key|credential/i;

export function redactUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
    }
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAM.test(name)) url.searchParams.set(name, '***');
    }
    return url.toString();
  } catch {
    return '(unparseable url)';
  }
}

/**
 * A `BigInt` column as a JSON number.
 *
 * `bytes`, `bytesSent` and `bytesReceived` are `BigInt` in Postgres and
 * `JSON.stringify` throws outright on one, so this conversion is not a
 * nicety - it is the difference between a response and a 500. `Number()` is
 * what `calls.service.ts` already uses on the same columns and this stays
 * consistent with it, but it is lossy above 2^53, which is nine petabytes: past
 * that the figure on the panel is approximate and there is nothing a JSON
 * number can do about it. Null and undefined are zero, because "no rows
 * matched" is a real answer from every aggregate here.
 */
export function toNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
}

/**
 * A file extension, bucketed the way the panel groups storage.
 *
 * `Attachment` stores no content type - it cannot, since the bytes are sealed
 * and the manifest naming them lives inside the ciphertext - so the generated
 * storage key's extension is the only signal the server has. It comes from
 * `buildKey`, which lower-cases and strips the original filename's extension,
 * so it is a hint about what was uploaded rather than a declaration of it.
 */
export function kindOfExtension(extension: string | null): string {
  const ext = (extension ?? '').toLowerCase().replace(/^\./, '');
  if (/^(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico|tiff?)$/.test(ext)) return 'image';
  if (/^(mp4|webm|mov|mkv|avi|m4v|3gp|mpe?g|wmv)$/.test(ext)) return 'video';
  if (/^(mp3|ogg|oga|opus|wav|flac|aac|m4a|weba|amr)$/.test(ext)) return 'audio';
  if (/^(pdf|docx?|xlsx?|pptx?|odt|ods|odp|txt|md|rtf|csv|json|xml|zip|gz|7z|rar|tar)$/.test(ext)) {
    return 'document';
  }
  return 'other';
}

/** Runs `work` with a deadline, so one hung dependency cannot hold the page. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One sentence, never a stack trace, and never long enough to be one. */
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0]?.slice(0, 200) ?? 'Unknown error';
}

/**
 * Runs one probe and turns whatever happens into a card.
 *
 * The `catch` here is the whole design: a probe may throw, time out, or return
 * a rejection from three layers down, and all of it becomes a red card with a
 * sentence on it. Nothing propagates out of this function.
 */
async function probe(
  id: string,
  label: string,
  url: string | null,
  work: () => Promise<Record<string, string | number> | void>,
): Promise<AdminComponentHealth> {
  const started = Date.now();
  try {
    const detail = await withTimeout(Promise.resolve().then(work), PROBE_TIMEOUT_MS);
    const latencyMs = Date.now() - started;
    return {
      id,
      label,
      state: stateForLatency(latencyMs),
      latencyMs,
      url,
      error: null,
      ...(detail ? { detail } : {}),
    };
  } catch (error) {
    return {
      id,
      label,
      state: 'down',
      latencyMs: null,
      url,
      error: messageOf(error),
    };
  }
}

/**
 * The sibling services this deployment expects to be able to reach.
 *
 * Two fallbacks, because there are two places this runs and they do not share a
 * name for anything. In a container, `chat-service` is a hostname compose
 * resolves. On a developer's machine, `pnpm dev:backend` puts the same service
 * on localhost and that hostname resolves to nothing at all - so the page came
 * up with four red cards, a `down` badge, and no relation to the deployment in
 * front of it. A health page that is red on every machine it is developed on is
 * a health page nobody looks at twice.
 *
 * `*_SERVICE_URL` still overrides both, for a deployment that puts them
 * somewhere else again.
 */
const SIBLINGS: Array<{ id: string; label: string; envVar: string; host: string; port: number }> = [
  { id: 'chat-service', label: 'Chat service', envVar: 'CHAT_SERVICE_URL', host: 'chat-service', port: 3004 },
  {
    id: 'presence-service',
    label: 'Presence service',
    envVar: 'PRESENCE_SERVICE_URL',
    host: 'presence-service',
    port: 3005,
  },
  { id: 'call-service', label: 'Call service', envVar: 'CALL_SERVICE_URL', host: 'call-service', port: 3007 },
  {
    id: 'remote-gateway',
    label: 'Remote gateway',
    envVar: 'REMOTE_GATEWAY_URL',
    host: 'remote-gateway',
    port: 3008,
  },
];

/** Where a sibling is, absent an explicit `*_SERVICE_URL`. */
function siblingUrl(sibling: (typeof SIBLINGS)[number]): string {
  const host = isProduction() ? sibling.host : '127.0.0.1';
  return envOr(sibling.envVar, `http://${host}:${sibling.port}`);
}

/** Rows as `pg_stat_user_tables` hands them back, before they are trimmed. */
interface TableSizeRow {
  table: string;
  rowEstimate: bigint;
  totalBytes: bigint;
  indexBytes: bigint;
}

interface DailyRow {
  date: string;
  bytes: bigint;
}

interface ExtensionRow {
  ext: string | null;
  count: bigint;
  bytes: bigint;
}

@Injectable()
export class AdminHealthService {
  /**
   * One connection, kept for the life of the process.
   *
   * A client per request would put a TCP connect and a handshake inside a probe
   * that is measuring round-trip latency, which measures the wrong thing.
   * `lazyConnect` keeps it from dialling at all until the first health request,
   * so a deployment where nobody ever opens the panel pays nothing for it.
   */
  private readonly redis = new Redis(envOr('REDIS_URL', 'redis://localhost:6379'), {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: PROBE_TIMEOUT_MS,
  });

  /**
   * The whole screen, in one response.
   *
   * The sections run concurrently and each one owns its own failure: the
   * `catch` on every branch is what keeps a broken Redis from taking the
   * database panel down with it.
   */
  async snapshot(days: number): Promise<AdminServerHealth> {
    const windowDays = clampWindowDays(days);
    const [components, database, media, bandwidth, live, relay] = await Promise.all([
      this.components(),
      this.database(),
      this.media(),
      this.bandwidth(windowDays),
      this.live(),
      this.relay(),
    ]);

    return {
      at: new Date().toISOString(),
      // The relay is deliberately not folded into `overall`. Running without
      // one is the default and not a fault, and a deployment that chose
      // STUN-only must not be shown a permanently red badge for it. The relay
      // card carries its own state.
      overall: worstState(components.map((component) => component.state)),
      components,
      runtime: this.runtime(),
      database,
      media,
      bandwidth,
      live: { ...live, endpoints: this.endpoints(components, live) },
      relay,
    };
  }

  /**
   * The TURN relay, as `call-service` reports it.
   *
   * Asked rather than worked out here: `call-service` owns `TURN_URLS` and is
   * what hands ICE to clients, so it is the only source that cannot disagree
   * with what a call actually gets. Reading the variable a second time in this
   * process would recreate exactly the split-brain that removing the hosted
   * minting path was meant to end.
   *
   * A `call-service` that cannot be reached is reported as such rather than as
   * a broken relay: those are different problems with different fixes, and the
   * sibling probe above already says which one this is.
   */
  private async relay(): Promise<AdminRelayHealth> {
    const base = envOr('CALL_SERVICE_URL', 'http://call-service:3007');
    try {
      const response = await withTimeout(
        fetch(`${base}/api/v1/internal/relay`),
        RELAY_PROBE_TIMEOUT_MS,
      );
      if (!response.ok) throw new Error(`call-service answered ${response.status}`);
      return (await response.json()) as AdminRelayHealth;
    } catch (error) {
      return {
        configured: false,
        username: null,
        probes: [],
        state: 'down',
        error: `Could not ask call-service about the relay: ${messageOf(error)}`,
      };
    }
  }

  /**
   * What this process knows about the machine under it.
   *
   * Only ever the *auth-service* process, which matters when the services are
   * spread across hosts: this is the uptime and memory of the one answering,
   * not a deployment-wide figure, and the panel should label it as such.
   */
  private runtime(): AdminRuntimeHealth {
    const memory = process.memoryUsage();
    const [one = 0, five = 0, fifteen = 0] = loadavg();
    return {
      uptimeSeconds: Math.round(process.uptime()),
      memoryRssBytes: memory.rss,
      memoryHeapUsedBytes: memory.heapUsed,
      memoryHeapTotalBytes: memory.heapTotal,
      // Windows has no load average and Node reports [0, 0, 0] there. The
      // contract says so, so it is passed through rather than nulled.
      loadAverage: [one, five, fifteen],
      cpuCount: cpus().length,
      nodeVersion: process.version,
      platform: platform(),
      // The release tag when a pipeline set one, the package version otherwise.
      // PACKAGE_VERSION is the last resort for processes not started via npm.
      appVersion: process.env.APP_VERSION ?? process.env.npm_package_version ?? PACKAGE_VERSION,
    };
  }

  /**
   * Postgres' own accounting of itself.
   *
   * All of it is raw SQL because none of it is in the Prisma schema: table
   * sizes, backend counts and the server version live in catalog views no ORM
   * models. No caller input reaches any of these statements - the only
   * parameter anywhere in this file is the bandwidth cutoff, and that is bound
   * by Prisma rather than interpolated into the string.
   */
  private async database(): Promise<AdminDatabaseStorage> {
    try {
      return await withTimeout(this.readDatabase(), PROBE_TIMEOUT_MS);
    } catch {
      // The `postgres` component card already carries the reason; this section
      // simply has nothing to show.
      return { totalBytes: 0, tables: [], connections: 0, maxConnections: 0, version: null };
    }
  }

  private async readDatabase(): Promise<AdminDatabaseStorage> {
    const [size, tables, connections, maxConnections, version] = await Promise.all([
      prisma.$queryRaw<Array<{ bytes: bigint }>>`
        SELECT pg_database_size(current_database()) AS bytes
      `,
      // `n_live_tup` is the planner's estimate on purpose: an exact count(*) of
      // every table is a sequential scan of the entire database, which is a
      // strange thing for a health page to do to a server that is struggling.
      prisma.$queryRaw<TableSizeRow[]>`
        SELECT
          relname AS "table",
          n_live_tup AS "rowEstimate",
          pg_total_relation_size(relid) AS "totalBytes",
          pg_indexes_size(relid) AS "indexBytes"
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT ${TABLE_LIMIT}
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM pg_stat_activity
      `,
      prisma.$queryRaw<Array<{ max_connections: string }>>`SHOW max_connections`,
      prisma.$queryRaw<Array<{ server_version: string }>>`SHOW server_version`,
    ]);

    const rows: AdminTableSize[] = tables.map((row) => ({
      table: row.table,
      rowEstimate: toNumber(row.rowEstimate),
      totalBytes: toNumber(row.totalBytes),
      indexBytes: toNumber(row.indexBytes),
    }));

    return {
      totalBytes: toNumber(size[0]?.bytes),
      tables: rows,
      connections: toNumber(connections[0]?.count),
      maxConnections: Number(maxConnections[0]?.max_connections ?? 0) || 0,
      version: version[0]?.server_version ?? null,
    };
  }

  /**
   * Where the uploads are and how much room they take.
   *
   * The two byte counts answer different questions and neither replaces the
   * other. `recordedBytes` is what the database says was stored; `diskBytes` is
   * what is actually on the volume, which includes anything the attachment
   * sweeper has not caught up with yet. The gap between them is the interesting
   * number, so both are reported rather than reconciled into one.
   */
  private async media(): Promise<AdminMediaStorage> {
    const driver = this.storageDriver();
    const base: AdminMediaStorage = {
      driver,
      recordedBytes: 0,
      diskBytes: null,
      diskFreeBytes: null,
      attachmentCount: 0,
      byKind: [],
      location: null,
    };

    const [recorded, disk] = await Promise.all([
      this.recordedMedia().catch(() => null),
      // S3 keeps both sizes null deliberately: listing every object in a bucket
      // costs a request per thousand keys, and the contract would rather have a
      // null than a number somebody was billed for.
      driver === 'local' ? this.localDisk().catch(() => null) : Promise.resolve(null),
    ]);

    return {
      ...base,
      ...(recorded ?? {}),
      ...(disk ?? {}),
      location:
        driver === 's3'
          ? (process.env.S3_BUCKET ?? null)
          : resolve(envOr('LOCAL_STORAGE_PATH', './storage-data')),
    };
  }

  /** `getStorage()` throws on a half-configured bucket; that is not fatal here. */
  private storageDriver(): 'local' | 's3' {
    try {
      return getStorage().name;
    } catch {
      return isS3Configured() ? 's3' : 'local';
    }
  }

  private async recordedMedia(): Promise<
    Pick<AdminMediaStorage, 'recordedBytes' | 'attachmentCount' | 'byKind'>
  > {
    // Grouped in SQL on the key's extension rather than by reading every row
    // back: the bucketing is then a handful of regexes over at most a few dozen
    // distinct extensions, however many million attachments there are.
    const rows = await prisma.$queryRaw<ExtensionRow[]>`
      SELECT
        lower(substring(key from '\\.([A-Za-z0-9]+)$')) AS ext,
        count(*) AS count,
        coalesce(sum(size), 0) AS bytes
      FROM attachments
      GROUP BY 1
    `;

    const byKind = new Map<string, { kind: string; count: number; bytes: number }>();
    let recordedBytes = 0;
    let attachmentCount = 0;

    for (const row of rows) {
      const kind = kindOfExtension(row.ext);
      const count = toNumber(row.count);
      const bytes = toNumber(row.bytes);
      recordedBytes += bytes;
      attachmentCount += count;
      const bucket = byKind.get(kind) ?? { kind, count: 0, bytes: 0 };
      bucket.count += count;
      bucket.bytes += bytes;
      byKind.set(kind, bucket);
    }

    return {
      recordedBytes,
      attachmentCount,
      byKind: [...byKind.values()].sort((a, b) => b.bytes - a.bytes),
    };
  }

  /**
   * The uploads directory, measured by walking it.
   *
   * Only ever done for the local driver, where the tree is a developer's or a
   * single host's and the walk is cheap. It counts apparent size rather than
   * blocks, which is the same figure the attachment rows are recorded in and
   * therefore the one that compares against them.
   */
  private async localDisk(): Promise<Pick<AdminMediaStorage, 'diskBytes' | 'diskFreeBytes'>> {
    const root = resolve(envOr('LOCAL_STORAGE_PATH', './storage-data'));
    const [diskBytes, stats] = await Promise.all([
      directorySize(root),
      statfs(root).catch(() => null),
    ]);
    return {
      diskBytes,
      diskFreeBytes: stats ? stats.bsize * stats.bavail : null,
    };
  }

  /**
   * What has moved over the window.
   *
   * **The call figures are not this host's traffic.** Media is peer-to-peer and
   * never touches the server, so these are the clients' own reported totals off
   * `CallSession` - the only place the number exists at all. A client that was
   * closed mid-call reported nothing and its row reads zero, so the totals are
   * a floor rather than a measurement. Attachment bytes, by contrast, are bytes
   * this deployment genuinely stored.
   */
  private async bandwidth(windowDays: number): Promise<AdminBandwidth> {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    try {
      const [calls, attachments, daily] = await withTimeout(
        Promise.all([
          prisma.callSession.aggregate({
            where: { joinedAt: { gte: since } },
            _sum: { bytes: true, bytesSent: true, bytesReceived: true },
            _count: { _all: true },
          }),
          prisma.attachment.aggregate({
            where: { createdAt: { gte: since } },
            _sum: { size: true },
            _count: { _all: true },
          }),
          this.daily(since),
        ]),
        PROBE_TIMEOUT_MS,
      );

      return {
        windowDays,
        callBytes: toNumber(calls._sum.bytes),
        callBytesSent: toNumber(calls._sum.bytesSent),
        callBytesReceived: toNumber(calls._sum.bytesReceived),
        callSessions: calls._count._all,
        attachmentBytes: toNumber(attachments._sum.size),
        attachmentCount: attachments._count._all,
        daily,
      };
    } catch {
      return {
        windowDays,
        callBytes: 0,
        callBytesSent: 0,
        callBytesReceived: 0,
        callSessions: 0,
        attachmentBytes: 0,
        attachmentCount: 0,
        daily: [],
      };
    }
  }

  /**
   * One row per day that had traffic, oldest first.
   *
   * Two grouped queries merged in memory rather than a full outer join, because
   * the two sides are different date columns on different tables and the join
   * is more SQL than the merge is code. Days with nothing at all are left out:
   * the chart then draws a gap, which is what happened.
   */
  private async daily(since: Date): Promise<AdminBandwidth['daily']> {
    const [callDays, attachmentDays] = await Promise.all([
      prisma.$queryRaw<DailyRow[]>`
        SELECT to_char(date_trunc('day', "joinedAt"), 'YYYY-MM-DD') AS date,
               coalesce(sum(bytes), 0) AS bytes
        FROM call_sessions
        WHERE "joinedAt" >= ${since}
        GROUP BY 1
      `,
      prisma.$queryRaw<DailyRow[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
               coalesce(sum(size), 0) AS bytes
        FROM attachments
        WHERE "createdAt" >= ${since}
        GROUP BY 1
      `,
    ]);

    const days = new Map<string, { date: string; callBytes: number; attachmentBytes: number }>();
    const entryFor = (date: string): { date: string; callBytes: number; attachmentBytes: number } =>
      days.get(date) ?? { date, callBytes: 0, attachmentBytes: 0 };

    for (const row of callDays) {
      days.set(row.date, { ...entryFor(row.date), callBytes: toNumber(row.bytes) });
    }
    for (const row of attachmentDays) {
      days.set(row.date, { ...entryFor(row.date), attachmentBytes: toNumber(row.bytes) });
    }

    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Who is connected right now, read straight out of Redis.
   *
   * Presence and the voice rosters are the only live state shared between
   * services, so they are the only live state a *different* service can report
   * on. The keys are `presence-service`'s own - `presence:online`,
   * `presence:voice:channels` and `presence:voice:<channelId>` - and this is a
   * second reader of them; if they ever change, this changes with them.
   */
  private async live(): Promise<Omit<AdminLiveConnections, 'endpoints'>> {
    const [presence, remote] = await Promise.all([
      this.presenceCounts().catch(() => ({ online: 0, calls: 0, participants: 0 })),
      prisma.remoteSession.count({ where: { endedAt: null } }).catch(() => 0),
    ]);

    return {
      onlineUsers: presence.online,
      // Presence is keyed per account, not per socket - two windows of the same
      // account are one entry in `presence:online`, and nothing anywhere keeps
      // a per-device count. So this is connected *accounts* and will never
      // exceed `onlineUsers`. Making it a true socket count would mean presence
      // keying by device, which is a change to presence-service, not to this.
      totalSockets: presence.online,
      activeCalls: presence.calls,
      activeCallParticipants: presence.participants,
      activeRemoteSessions: remote,
    };
  }

  private async presenceCounts(): Promise<{ online: number; calls: number; participants: number }> {
    // The same cutoff `PresenceStore` applies when it reads: an entry nobody
    // has refreshed is a client that died, not somebody who is online.
    const cutoff = Date.now() - PRESENCE_STALE_MS;
    const online = await withTimeout(
      this.redis.zcount('presence:online', cutoff, '+inf'),
      PROBE_TIMEOUT_MS,
    );

    const channels = await this.redis.smembers('presence:voice:channels');
    const sizes = await Promise.all(
      channels.map((channelId) => this.redis.scard(`presence:voice:${channelId}`)),
    );
    // A roster whose key has expired is a call `call-service` stopped
    // re-announcing; the index still names the channel, so an empty set is a
    // call that is over rather than a call with nobody in it.
    const live = sizes.filter((size) => size > 0);

    return {
      online,
      calls: live.length,
      participants: live.reduce((total, size) => total + size, 0),
    };
  }

  /**
   * The four realtime paths, as a client dials them.
   *
   * Built from the deployment's own public URL rather than a hardcoded host,
   * with the scheme swapped for its WebSocket equivalent - which is the whole
   * reason these are computed at all: an administrator checking whether the
   * tunnel is configured correctly wants to see the URL their clients actually
   * use, not the one this service would guess.
   */
  private endpoints(
    components: AdminComponentHealth[],
    live: Omit<AdminLiveConnections, 'endpoints'>,
  ): AdminLiveEndpoint[] {
    const base = publicBaseUrl().replace(/^http/, 'ws');
    const stateOf = (id: string): AdminHealthState =>
      components.find((component) => component.id === id)?.state ?? 'down';

    return [
      // `chat-service` keeps its subscriptions inside the gateway process and
      // publishes nothing about them, so there is no count to read. Zero here
      // means "not tracked"; the card's state still says whether the service is
      // answering, which is the question the endpoint list is really asked.
      {
        id: 'chat',
        label: 'Chat',
        url: `${base}/ws/chat`,
        connections: 0,
        state: stateOf('chat-service'),
      },
      {
        id: 'presence',
        label: 'Presence',
        url: `${base}/ws/presence`,
        connections: live.onlineUsers,
        state: stateOf('presence-service'),
      },
      {
        id: 'call',
        label: 'Voice & video',
        url: `${base}/ws/call`,
        connections: live.activeCallParticipants,
        state: stateOf('call-service'),
      },
      {
        id: 'remote',
        label: 'Remote desktop',
        url: `${base}/ws/remote`,
        connections: live.activeRemoteSessions,
        state: stateOf('remote-gateway'),
      },
    ];
  }

  /** Every dependency, probed concurrently, each failing only for itself. */
  private components(): Promise<AdminComponentHealth[]> {
    return Promise.all([
      probe('postgres', 'PostgreSQL', redactUrl(process.env.DATABASE_URL), async () => {
        await prisma.$queryRaw`SELECT 1`;
      }),
      probe('redis', 'Redis', redactUrl(envOr('REDIS_URL', 'redis://localhost:6379')), async () => {
        const pong = await this.redis.ping();
        if (pong !== 'PONG') throw new Error(`Unexpected reply: ${pong}`);
      }),
      ...SIBLINGS.map((sibling) => {
        const url = `${siblingUrl(sibling).replace(/\/$/, '')}/health`;
        // Redacted for the same reason the database URL is: a service URL with
        // basic-auth credentials in it is unusual but entirely legal.
        return probe(sibling.id, sibling.label, redactUrl(url), async () => {
          const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const body: unknown = await response.json();
          const status =
            typeof body === 'object' && body !== null && 'status' in body
              ? String((body as { status: unknown }).status)
              : 'unknown';
          // A service answering `degraded` is reporting that its own dependency
          // is unwell; that is its card to be red, not this one's to hide.
          if (status !== 'ok') throw new Error(`Reported ${status}`);
          return { status };
        });
      }),
    ]);
  }
}

/**
 * Apparent size of everything under `root`, in bytes.
 *
 * Iterative rather than recursive, and `withFileTypes` so each entry costs one
 * `stat` and not two. A directory that has gone missing between the listing and
 * the walk contributes nothing rather than throwing the whole measurement away.
 *
 * ponytail: a full walk on every request. Fine for a local-disk deployment,
 * which is the only one that reaches here; cache it behind a timestamp if an
 * uploads tree ever gets big enough for an administrator to notice the wait.
 */
async function directorySize(root: string): Promise<number> {
  const pending = [root];
  let total = 0;

  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) break;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile()) {
        const info = await stat(path).catch(() => null);
        total += info?.size ?? 0;
      }
    }
  }

  return total;
}
