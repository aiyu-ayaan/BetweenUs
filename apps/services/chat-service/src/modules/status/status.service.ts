/**
 * Statuses: posts that expire after 24 hours and are read by accepted friends.
 *
 * The audience is the whole design. A status has no channel, so
 * `resolveChannelAccess` has nothing to answer here; the equivalent rule is
 * `friendIdsOf` plus the block list, and it is applied in exactly three places
 * - reading the tray, opening one post, and reading who saw yours. Every one
 * of them goes through `audienceOf` below rather than assembling the query
 * again, because three copies of an authorization rule is three chances to get
 * it wrong once.
 *
 * Expiry is stamped at write time and filtered at read time, so a sweep that
 * is late never shows a stale post: the row outliving its stamp is invisible
 * before it is collected. See `status-sweeper.ts` for the collection half.
 *
 * The content is end-to-end encrypted and the audience is frozen when it is
 * posted - the author wraps the post's key once per device of every friend it
 * had at that moment, and `status_keys` holds those wraps. So there are now two
 * gates rather than one, and they answer different questions: the friend rule
 * below still decides whom a post may be *addressed* to, and the wrap decides
 * who can actually open it. A friendship made after the post passes the first
 * and fails the second, which is the whole of "a new friend does not see
 * yesterday's update".
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { blockedIdsAround, friendIdsOf, prisma } from '@betweenus/database';
import type { Status, StatusKind as PrismaStatusKind } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { getStorage } from '@betweenus/storage';
import {
  STATUS_TTL_MS,
  type CreateStatusRequest,
  type DeviceKey,
  type StatusEntry,
  type StatusFeed,
  type StatusFeedEntry,
  type StatusKeyEntry,
  type StatusViewer,
  type UserSummary,
} from '@betweenus/shared-types';
import { toDeviceKey } from '../e2ee/e2ee.service';

interface UserRow {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  about: string;
}

const USER_FIELDS = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  coverUrl: true,
  about: true,
} as const;

@Injectable()
export class StatusService {
  constructor(private readonly events: EventBus) {}

  /**
   * The tray: this account's own run, and one row per friend who has posted.
   *
   * Ordered newest-run-first with unopened runs ahead of opened ones, which is
   * the order every app with this feature uses and the only one where the
   * thing you have not seen is the thing under your thumb.
   */
  async feed(userId: string): Promise<StatusFeed> {
    const audience = await this.audienceOf(userId);
    const now = new Date();

    const rows = await prisma.status.findMany({
      where: {
        expiresAt: { gt: now },
        authorId: { in: [userId, ...audience] },
        // And a wrap addressed to this account, which is what makes the tray
        // agree with what the reader can actually open. Their own posts are
        // exempt from the condition rather than from the wrap: the author
        // seals for their own devices too, and a post they cannot open on
        // this machine is still theirs and still deletable.
        OR: [{ authorId: userId }, { keys: { some: { recipientUserId: userId } } }],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: USER_FIELDS },
        // Two view slices in one query rather than two round trips: whether
        // *this* reader has opened each post, and - for the reader's own posts
        // - how many people have.
        views: { where: { viewerId: userId }, select: { id: true } },
        _count: { select: { views: true } },
        // Every copy addressed to this account, one per machine they had when
        // the post was written. The client keeps whichever its private half
        // opens - see the note on `StatusEntry.keys`.
        keys: { where: { recipientUserId: userId } },
      },
    });

    const mine: StatusEntry[] = [];
    const byAuthor = new Map<string, { author: UserSummary; statuses: StatusEntry[] }>();

    for (const row of rows) {
      if (row.authorId === userId) {
        mine.push(toEntry(row, { seen: true, viewCount: row._count.views }));
        continue;
      }
      const group = byAuthor.get(row.authorId) ?? {
        author: toSummary(row.author),
        statuses: [],
      };
      group.statuses.push(toEntry(row, { seen: row.views.length > 0, viewCount: null }));
      byAuthor.set(row.authorId, group);
    }

    return { mine, others: orderRuns([...byAuthor.values()]) };
  }

  /**
   * Posts one.
   *
   * `mediaKey` is already in storage by the time this runs - the controller
   * puts the bytes there in the same request - so a failure below leaves an
   * object with no row. That is why it is deleted on the way out rather than
   * left for a sweep to guess at: nothing else ever writes under `status/`, so
   * an unreferenced object there is unambiguously rubbish.
   */
  async create(
    userId: string,
    dto: CreateStatusRequest,
    mediaKey: string | null,
  ): Promise<StatusEntry> {
    const now = new Date();
    // Only for people who may be addressed *now*: the client built its bundle
    // from the directory a moment ago, and somebody who has since blocked the
    // author must not get a wrap out of that gap. The author's own devices are
    // always allowed - they are sealing for themselves.
    const allowed = new Set([userId, ...(await this.audienceOf(userId))]);
    const entries = keysForAudience(dto.keys, allowed);

    let row: Status;
    try {
      // One transaction: a status whose keys failed to write is a post nobody
      // can ever open, including its author, and it would sit in the tray for
      // a day looking like a bug.
      row = await prisma.$transaction(async (tx) => {
        const created = await tx.status.create({
          data: {
            authorId: userId,
            kind: dto.kind as PrismaStatusKind,
            mediaKey,
            mediaIv: dto.mediaIv ?? null,
            mediaType: dto.mediaType ?? null,
            caption: dto.caption?.trim() || null,
            background: dto.background ?? null,
            durationMs: dto.durationMs ?? null,
            expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
          },
        });
        if (entries.length > 0) {
          await tx.statusKey.createMany({
            data: entries.map((entry) => ({
              statusId: created.id,
              recipientUserId: entry.recipientUserId,
              recipientDeviceId: entry.recipientDeviceId,
              senderDeviceId: dto.senderDeviceId,
              senderPublicKey: entry.senderPublicKey,
              wrappedKey: entry.wrappedKey,
              iv: entry.iv,
            })),
            skipDuplicates: true,
          });
        }
        return created;
      });
    } catch (error) {
      if (mediaKey) await getStorage().delete(mediaKey).catch(() => undefined);
      throw error;
    }

    await this.announce(userId);
    return toEntry(
      {
        ...row,
        views: [],
        _count: { views: 0 },
        // What goes back to the author is only their own copies: this response
        // is read by the machine that posted, which already holds the key it
        // just minted, and nobody else's wrap is any of its business.
        keys: entries.filter((entry) => entry.recipientUserId === userId),
      },
      { seen: true, viewCount: 0 },
    );
  }

  /**
   * Records that this account opened somebody's post.
   *
   * Idempotent by the unique pair, so re-opening a status does not write a
   * second row and does not move the time on the first: what the author is
   * shown is when somebody first looked, not when they last scrolled past.
   * Opening your own is a no-op rather than an error - the client does not
   * special-case it, and a viewer list with the author in it would be a lie.
   */
  async markViewed(userId: string, statusId: string): Promise<void> {
    const row = await this.readable(userId, statusId);
    if (row.authorId === userId) return;

    await prisma.statusView.upsert({
      where: { statusId_viewerId: { statusId, viewerId: userId } },
      create: { statusId, viewerId: userId },
      update: {},
    });
    // The author's own tray shows a view count, and nobody else's changes.
    await this.events.publish(EVENTS.STATUS_CHANGED, {
      userIds: [row.authorId],
      authorId: row.authorId,
    });
  }

  /** Who opened one of your posts, newest first. Only the author may ask. */
  async viewers(userId: string, statusId: string): Promise<StatusViewer[]> {
    const row = await prisma.status.findUnique({
      where: { id: statusId },
      select: { authorId: true },
    });
    if (!row) throw new NotFoundException({ code: 'STATUS_NOT_FOUND', message: 'No such status' });
    if (row.authorId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the author can see who viewed a status',
      });
    }

    const rows = await prisma.statusView.findMany({
      where: { statusId },
      orderBy: { viewedAt: 'desc' },
      include: { viewer: { select: USER_FIELDS } },
    });
    return rows.map((view) => ({
      user: toSummary(view.viewer),
      viewedAt: view.viewedAt.toISOString(),
    }));
  }

  /** Takes one of your own down early. The blob goes with it. */
  async remove(userId: string, statusId: string): Promise<void> {
    const row = await prisma.status.findUnique({
      where: { id: statusId },
      select: { authorId: true, mediaKey: true },
    });
    if (!row) throw new NotFoundException({ code: 'STATUS_NOT_FOUND', message: 'No such status' });
    if (row.authorId !== userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only the author can delete a status',
      });
    }

    // Object first, then row: a failure between the two leaves a row pointing
    // at nothing, which draws as a broken post and can be deleted again. The
    // other order leaves a blob nothing can ever name.
    if (row.mediaKey) await getStorage().delete(row.mediaKey).catch(() => undefined);
    await prisma.status.delete({ where: { id: statusId } });
    await this.announce(userId);
  }

  /**
   * The one post, if this account is allowed it. Used by the view marker and
   * by the download gate - see `mayReadStatusMedia`.
   */
  private async readable(
    userId: string,
    statusId: string,
  ): Promise<{ authorId: string }> {
    const row = await prisma.status.findFirst({
      where: { id: statusId, expiresAt: { gt: new Date() } },
      select: { authorId: true },
    });
    if (!row) throw new NotFoundException({ code: 'STATUS_NOT_FOUND', message: 'No such status' });
    if (row.authorId === userId) return row;

    const audience = await this.audienceOf(userId);
    // Both gates. A wrap addressed to this account is what "may open it"
    // means; the friend list is what "may still see it" means, because
    // unfriending does not delete a wrap that was already written.
    if (!audience.includes(row.authorId) || !(await hasKey(userId, statusId))) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'This status is not yours to see',
      });
    }
    return row;
  }

  /**
   * Whose statuses this account may read: accepted friends, minus anyone
   * either side has blocked.
   *
   * A block is checked in both directions because it is directional and either
   * direction closes the door - the same rule the conversation gate uses. It
   * is subtracted here rather than relied on to have ended the friendship,
   * because unblocking does not restore one and the two facts drift.
   */
  private async audienceOf(userId: string): Promise<string[]> {
    const [friends, blocked] = await Promise.all([
      friendIdsOf(userId),
      blockedIdsAround(userId),
    ]);
    return statusAudience(friends, blocked);
  }

  /**
   * Every device a post written now may be sealed for: the author's own, and
   * every friend's, minus the revoked ones.
   *
   * The same answer `devicesForChannel` gives for a channel, from the same
   * directory - a status simply has a friend list where a channel has a
   * membership. Revoked machines are filtered here rather than left to the
   * client for the same reason they are there: "never seal for that laptop
   * again" has to be enforced where the answer is produced.
   */
  async audienceDevices(userId: string): Promise<DeviceKey[]> {
    const audience = await this.audienceOf(userId);
    const rows = await prisma.deviceKey.findMany({
      where: { userId: { in: [userId, ...audience] }, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDeviceKey);
  }

  /**
   * Tells the author's friends - and the author's own other devices - to
   * re-read the tray.
   *
   * The audience is computed here because this is where the friend list is
   * already loaded; the gateway holds sockets and knows nothing about
   * friendships.
   */
  private async announce(authorId: string): Promise<void> {
    const friends = await friendIdsOf(authorId);
    await this.events.publish(EVENTS.STATUS_CHANGED, {
      userIds: [authorId, ...friends],
      authorId,
    });
  }
}

/**
 * Whether this account may fetch the bytes behind a `status/` key.
 *
 * Lives here, beside the audience rule it shares, rather than in the uploads
 * controller: that route already answers two different questions about two
 * kinds of object, and a third rule written inline there is the third place
 * the friendship check could drift out of step.
 */
export async function mayReadStatusMedia(userId: string, key: string): Promise<boolean> {
  const row = await prisma.status.findFirst({
    where: { mediaKey: key, expiresAt: { gt: new Date() } },
    select: { id: true, authorId: true },
  });
  if (!row) return false;
  if (row.authorId === userId) return true;

  const [friends, blocked, keyed] = await Promise.all([
    friendIdsOf(userId),
    blockedIdsAround(userId),
    hasKey(userId, row.id),
  ]);
  // The bytes are ciphertext, so this gate is not what keeps them secret - the
  // wrap is. It is still the same two questions the tray asks, and asking them
  // here stops anybody hoarding blobs they hold no key for.
  return keyed && statusAudience(friends, blocked).includes(row.authorId);
}

/** Whether a wrap of this post's key was addressed to any of an account's devices. */
async function hasKey(userId: string, statusId: string): Promise<boolean> {
  const row = await prisma.statusKey.findFirst({
    where: { statusId, recipientUserId: userId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Whose statuses an account may read, given its friends and its blocks.
 *
 * Split out of the query so the rule can be asserted on without a database,
 * and shared by the tray, the single-post gate and the media download - three
 * callers that must never answer this differently. A block is subtracted in
 * both directions (`blockedIdsAround` returns both) rather than relied on to
 * have ended the friendship, because unblocking does not restore one and the
 * two facts drift apart the moment somebody unblocks.
 */
export function statusAudience(friendIds: string[], blocked: Set<string>): string[] {
  return friendIds.filter((id) => !blocked.has(id));
}

/**
 * The wraps a bundle may actually contain: the ones addressed to somebody the
 * author may post to.
 *
 * The client assembles the bundle from a directory it read a moment earlier,
 * so this is not a formality - it is the gap between that read and this write,
 * and the person who blocked the author inside it. Sealing is done by the
 * author and cannot be checked here; who may be *addressed* can be, and is.
 */
export function keysForAudience(
  entries: StatusKeyEntry[],
  allowed: Set<string>,
): StatusKeyEntry[] {
  return entries.filter((entry) => allowed.has(entry.recipientUserId));
}

/**
 * The order the tray is drawn in: unopened runs first, then newest first
 * inside each half.
 *
 * That order is not a preference. A list sorted purely by time puts a run you
 * have already watched above one you have not the moment somebody posts twice,
 * and the thing under your thumb stops being the thing you opened the screen
 * for. Every app with this feature splits the list the same way.
 */
export function orderRuns(
  runs: Array<{ author: UserSummary; statuses: StatusEntry[] }>,
): StatusFeedEntry[] {
  return runs
    .map((run) => ({
      author: run.author,
      statuses: run.statuses,
      // The run is built oldest-first, so the last one is the newest.
      latestAt: run.statuses[run.statuses.length - 1]!.createdAt,
      unseen: run.statuses.some((status) => !status.seen),
    }))
    .sort((left, right) => {
      if (left.unseen !== right.unseen) return left.unseen ? -1 : 1;
      // ISO-8601 in UTC sorts lexicographically, which is why these are
      // compared as strings rather than parsed back into dates.
      return right.latestAt.localeCompare(left.latestAt);
    });
}

type StatusRow = Status & {
  views?: Array<{ id: string }>;
  _count?: { views: number };
  /** The wraps addressed to the reader - see `StatusEntry.keys`. */
  keys?: StatusKeyEntry[];
};

function toEntry(
  row: StatusRow,
  read: { seen: boolean; viewCount: number | null },
): StatusEntry {
  return {
    id: row.id,
    authorId: row.authorId,
    kind: row.kind,
    // The route, not the key: every client resolves this against whichever
    // deployment it is pointed at, the same way an attachment url is resolved.
    mediaUrl: row.mediaKey ? `/api/v1/uploads/${row.mediaKey}` : null,
    mediaIv: row.mediaIv,
    mediaType: row.mediaType,
    caption: row.caption,
    background: row.background,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    seen: read.seen,
    viewCount: read.viewCount,
    keys: (row.keys ?? []).map((entry) => ({
      recipientUserId: entry.recipientUserId,
      recipientDeviceId: entry.recipientDeviceId,
      senderPublicKey: entry.senderPublicKey,
      wrappedKey: entry.wrappedKey,
      iv: entry.iv,
    })),
  };
}

function toSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    coverUrl: row.coverUrl,
    about: row.about,
  };
}
