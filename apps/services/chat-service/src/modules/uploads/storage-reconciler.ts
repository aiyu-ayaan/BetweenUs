/**
 * Deletes objects the database has no reference to at all.
 *
 * Every other sweep in this codebase starts from a row and asks whether its
 * object should go. This one starts from the *object* and asks whether any row
 * names it, and the difference is the whole point: an object with no row was
 * invisible to all the others. Not kept deliberately - unreachable. No query
 * could produce its key, so no code could produce its delete, and it sat in the
 * bucket being paid for until somebody went in with a console.
 *
 * Four ways one is made, all of them ordinary:
 *
 * - **A replaced picture.** Uploading a new avatar, cover or server icon
 *   writes a new object and points the column at it. Nothing has ever deleted
 *   the old one, and pictures are the most-replaced object in the system.
 * - **An abandoned status upload.** The bytes are written by the upload route
 *   and the `Status` row by a later request. Close the composer between the
 *   two and the object is a permanent orphan - `status/` keys have no
 *   `Attachment` row to be swept by.
 * - **A lost race on `record`.** The attachment route deletes the object when
 *   the row cannot be written, but a process killed between the two leaves the
 *   object behind with nothing to name it.
 * - **A half-finished multipart upload**, in a deployment where the bucket has
 *   no lifecycle rule of its own.
 *
 * ## The rule it follows
 *
 * Delete an object only when *no* reference to it exists anywhere and it is
 * older than the grace period. Both halves matter, and the second is not
 * politeness: an object is written before the row that names it, so a young
 * unreferenced object is very often an upload two seconds from being claimed.
 * Deleting it would be this sweep causing the exact loss it exists to prevent.
 *
 * Nothing here can be driven by a client, and it refuses to run at all when it
 * cannot read the references it needs - a failed query must never be read as
 * "nothing references anything", which would empty the bucket.
 *
 * ponytail: a timer in the process, like the sweeps beside it. Two replicas
 * overlapping is harmless: a delete that finds nothing is not an error.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { envNumber } from '@betweenus/config';
import { prisma } from '@betweenus/database';
import { Logger } from '@betweenus/logger';
import { MULTIPART_PREFIX, getStorage } from '@betweenus/storage';

const HOUR_MS = 60 * 60 * 1000;

/** Daily. It is disk, not correctness, and a bucket walk is not free. */
const INTERVAL_MS = 24 * HOUR_MS;

/** Not at boot: a service starting is the worst moment to walk a bucket. */
const FIRST_RUN_DELAY_MS = 30 * 60_000;

/** How many objects one pass will delete, so a backlog spreads over passes. */
const MAX_DELETES_PER_PASS = 2000;

/**
 * How old an unreferenced object must be before it is collected.
 *
 * Far longer than the attachment grace, and deliberately: this pass is looking
 * at objects whose reference *may never have been written*, so it cannot tell
 * "abandoned" from "the row is one request behind". A week is longer than any
 * upload flow in this system and short enough that a bucket does not fill with
 * a year of replaced avatars.
 */
function graceMs(): number {
  return envNumber('STORAGE_RECONCILE_GRACE_HOURS', 24 * 7) * HOUR_MS;
}

/** Turn it off in a deployment that would rather sweep its bucket by hand. */
function enabled(): boolean {
  return envNumber('STORAGE_RECONCILE_ENABLED', 1) === 1;
}

export interface ReconcileReport {
  scanned: number;
  deleted: number;
  bytes: number;
  /** Objects that were unreferenced but too young to touch yet. */
  young: number;
}

/**
 * Every storage key the database currently points at.
 *
 * Read in one go rather than queried per object, because the alternative is a
 * round trip per key over a bucket with millions of them. The sets are of keys,
 * not of urls: a picture is stored as a URL in its column and the key is the
 * tail of it, so `keyOf` is the one place that conversion happens.
 *
 * Every table that can name an object has to be in here. One that is missed is
 * not a sweep that under-collects, it is a sweep that deletes live data, which
 * is why this function is the thing to read before adding a column that holds
 * a storage key.
 */
export async function referencedKeys(): Promise<Set<string>> {
  const [attachments, statuses, users, servers, webhooks, emojis] = await Promise.all([
    prisma.attachment.findMany({ select: { key: true } }),
    prisma.status.findMany({ where: { mediaKey: { not: null } }, select: { mediaKey: true } }),
    prisma.user.findMany({ select: { avatarUrl: true, coverUrl: true } }),
    prisma.server.findMany({ select: { iconUrl: true } }),
    prisma.webhook.findMany({ select: { avatarUrl: true } }),
    prisma.serverEmoji.findMany({ select: { url: true } }),
  ]);

  const keys = new Set<string>();
  for (const row of attachments) keys.add(row.key);
  for (const row of statuses) if (row.mediaKey) keys.add(row.mediaKey);
  for (const row of users) {
    for (const url of [row.avatarUrl, row.coverUrl]) {
      const key = keyOf(url);
      if (key) keys.add(key);
    }
  }
  for (const row of servers) {
    const key = keyOf(row.iconUrl);
    if (key) keys.add(key);
  }
  for (const row of webhooks) {
    const key = keyOf(row.avatarUrl);
    if (key) keys.add(key);
  }
  for (const row of emojis) {
    const key = keyOf(row.url);
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * The storage key inside a stored URL, or null when there is not one.
 *
 * Columns hold `/api/v1/uploads/pictures/<id>/picture.png` in a local
 * deployment and `https://bucket.example/pictures/<id>/picture.png` behind S3,
 * and the key is the same string in both. Anything that does not look like
 * either is left alone rather than guessed at: a URL this cannot parse is a
 * reference this pass must treat as live.
 */
export function keyOf(url: string | null): string | null {
  if (!url) return null;
  const path = url.includes('://') ? safePath(url) : url;
  if (!path) return null;

  const marker = '/uploads/';
  const at = path.indexOf(marker);
  const key = at >= 0 ? path.slice(at + marker.length) : path.replace(/^\/+/, '');
  return key.length > 0 ? key : null;
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * Whether an object may be collected, given what the database says and when
 * the object was written.
 *
 * Split out from the walk so the decision can be asserted on without a bucket
 * or a database - see `storage-reconciler.check.ts`. It is three conditions
 * and every one of them is the difference between collecting garbage and
 * deleting somebody's photograph.
 */
export function collectable(
  object: { key: string; modifiedAt: Date },
  referenced: Set<string>,
  now: Date,
  grace: number,
): boolean {
  // Scratch space for parts in flight. It has its own sweep with its own
  // (much shorter) clock, and this pass would otherwise delete the parts of
  // an upload that is still running.
  if (object.key.startsWith(`${MULTIPART_PREFIX}/`)) return false;
  if (referenced.has(object.key)) return false;
  return now.getTime() - object.modifiedAt.getTime() >= grace;
}

/**
 * Walks the store and deletes what nothing points at.
 *
 * Returns what it did rather than logging it, so the timer below and a
 * one-shot script can both use it and only one of them decides what to say.
 */
export async function reconcileStorage(
  now: Date = new Date(),
  grace: number = graceMs(),
): Promise<ReconcileReport> {
  // Read the references *first*. If this throws, nothing is deleted - which is
  // the only acceptable behaviour, because an empty reference set and a failed
  // query are indistinguishable at the point of the delete and one of them
  // means "delete the whole bucket".
  const referenced = await referencedKeys();

  const storage = getStorage();
  const report: ReconcileReport = { scanned: 0, deleted: 0, bytes: 0, young: 0 };
  let cursor: string | undefined;

  do {
    const page = await storage.list('', cursor);
    cursor = page.cursor;

    for (const object of page.objects) {
      report.scanned += 1;
      if (object.key.startsWith(`${MULTIPART_PREFIX}/`)) continue;
      if (referenced.has(object.key)) continue;
      if (!collectable(object, referenced, now, grace)) {
        report.young += 1;
        continue;
      }
      if (report.deleted >= MAX_DELETES_PER_PASS) return report;

      try {
        await storage.delete(object.key);
        report.deleted += 1;
        report.bytes += object.size;
      } catch {
        // Storage that is unhappy now will be walked again tomorrow.
      }
    }
  } while (cursor);

  return report;
}

@Injectable()
export class StorageReconciler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;

  constructor(private readonly logger: Logger) {}

  onModuleInit(): void {
    if (!enabled()) return;
    this.first = setTimeout(() => {
      void this.run();
      this.timer = setInterval(() => void this.run(), INTERVAL_MS);
      this.timer.unref?.();
    }, FIRST_RUN_DELAY_MS);
    this.first.unref?.();
  }

  private async run(): Promise<void> {
    try {
      const report = await reconcileStorage();
      // Logged even when nothing went, unlike the sweeps beside it. The number
      // that matters here is `scanned`: a pass that reports nothing is how
      // somebody notices this stopped walking the bucket at all.
      this.logger.info('Reconciled object storage', { ...report });
    } catch (error) {
      this.logger.warn('Could not reconcile object storage', { reason: String(error) });
    }
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }
}
