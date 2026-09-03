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
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { blockedIdsAround, friendIdsOf, prisma } from '@betweenus/database';
import type { Status, StatusKind as PrismaStatusKind } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { getStorage } from '@betweenus/storage';
import {
  STATUS_TTL_MS,
  type CreateStatusRequest,
  type StatusEntry,
  type StatusFeed,
  type StatusFeedEntry,
  type StatusViewer,
  type UserSummary,
} from '@betweenus/shared-types';

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
      },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: USER_FIELDS },
        // Two view slices in one query rather than two round trips: whether
        // *this* reader has opened each post, and - for the reader's own posts
        // - how many people have.
        views: { where: { viewerId: userId }, select: { id: true } },
        _count: { select: { views: true } },
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
    let row: Status;
    try {
      row = await prisma.status.create({
        data: {
          authorId: userId,
          kind: dto.kind as PrismaStatusKind,
          mediaKey,
          caption: dto.caption?.trim() || null,
          background: dto.background ?? null,
          durationMs: dto.durationMs ?? null,
          expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
        },
      });
    } catch (error) {
      if (mediaKey) await getStorage().delete(mediaKey).catch(() => undefined);
      throw error;
    }

    await this.announce(userId);
    return toEntry({ ...row, views: [], _count: { views: 0 } }, { seen: true, viewCount: 0 });
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
    if (!audience.includes(row.authorId)) {
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
    select: { authorId: true },
  });
  if (!row) return false;
  if (row.authorId === userId) return true;

  const [friends, blocked] = await Promise.all([
    friendIdsOf(userId),
    blockedIdsAround(userId),
  ]);
  return statusAudience(friends, blocked).includes(row.authorId);
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
    caption: row.caption,
    background: row.background,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    seen: read.seen,
    viewCount: read.viewCount,
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
