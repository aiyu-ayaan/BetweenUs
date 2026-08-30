/**
 * Redis-backed presence state.
 *
 * Online users live in one sorted set scored by their last heartbeat, so a
 * crashed client ages out instead of appearing online forever, and no per-user
 * key bookkeeping is needed. Voice membership is a set per channel.
 *
 * Nothing here is durable on purpose: presence is realtime state, and Redis is
 * where the architecture puts it.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { prisma } from '@betweenus/database';
import { envOr } from '@betweenus/config';
import type {
  ActiveStatus,
  PresenceState,
  PresenceStatus,
  VoiceState,
} from '@betweenus/shared-types';
import { voiceLifetime } from './voice-lifetime';
import { readableLastSeen, toVisibility } from './last-seen-visibility';

const ONLINE_KEY = 'presence:online';
const STATUS_KEY = 'presence:status';
const VOICE_KEY = (channelId: string): string => `presence:voice:${channelId}`;
const VOICE_INDEX = 'presence:voice:channels';
const FOCUS_KEY = (channelId: string): string => `presence:focus:${channelId}`;
/**
 * userId -> the last millisecond this account was seen connected and visible.
 *
 * A hash rather than a score on `presence:online`, because that sorted set is
 * trimmed of anybody stale - which is precisely the moment the answer starts
 * being interesting. Nothing expires it: one small entry per account that has
 * ever connected, which is the same order as the user table.
 */
const LAST_SEEN_KEY = 'presence:lastseen';

/** Anything else in the hash is a status this build does not know; ignore it. */
const ACTIVE_STATUSES: ActiveStatus[] = ['online', 'idle', 'dnd', 'invisible'];

/** A client that has not checked in for this long is treated as gone. */
export const STALE_AFTER_MS = 90_000;

@Injectable()
export class PresenceStore implements OnModuleDestroy {
  private readonly redis = new Redis(envOr('REDIS_URL', 'redis://localhost:6379'), {
    maxRetriesPerRequest: null,
  });

  /**
   * Marks a user online, or refreshes their heartbeat, and notes the moment as
   * when they were last seen.
   *
   * An invisible account is skipped for the second half only. It is genuinely
   * connected, so it still ages correctly out of `presence:online`; it is just
   * not *seen*, and a last-seen time that kept ticking while somebody was
   * hidden would be a green dot spelled differently.
   */
  async touch(userId: string): Promise<void> {
    const now = Date.now();
    await this.redis.zadd(ONLINE_KEY, now, userId);
    if ((await this.statusOf(userId)) === 'invisible') return;
    await this.redis.hset(LAST_SEEN_KEY, userId, now);
  }

  async goOffline(userId: string): Promise<void> {
    await this.redis.zrem(ONLINE_KEY, userId);
  }

  /**
   * Writes the live last-seen value through to Postgres.
   *
   * Called when an account's last window closes, which is the only moment the
   * value stops changing and therefore the only moment it is worth a row write.
   * Redis answers while somebody is online and for as long as it keeps the
   * hash; this is what survives a wipe, a restart, or an absence long enough
   * that nobody remembers the session.
   *
   * A failure is logged nowhere and swallowed here on purpose: the caller is a
   * socket closing, and a database that is briefly unhappy must not turn a
   * disconnect into an unhandled rejection. The value stays in Redis and the
   * next disconnect writes it.
   */
  async flushLastSeen(userId: string): Promise<void> {
    const seen = await this.redis.hget(LAST_SEEN_KEY, userId);
    if (seen === null) return;
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: new Date(Number(seen)) },
      });
    } catch {
      return;
    }
  }

  /**
   * When each of these accounts was last seen, ISO-8601, as far as `askerId` is
   * allowed to know.
   *
   * Redis and Postgres are both consulted rather than one falling back to the
   * other: Redis is ahead for anybody who has connected since the last flush,
   * and Postgres is the only answer for anybody whose entry a wipe took. Taking
   * the later of the two is right in both directions and needs no bookkeeping
   * about which store is authoritative.
   *
   * **The privacy filter lives here rather than at the call sites**, so there is
   * one place that decides who may read a last-seen time and no way to reach the
   * value without going through it. `LastSeenVisibility`, the friendship it may
   * depend on, and the reciprocity rule are all applied before anything is
   * returned - see `last-seen-visibility.ts` for what the rule actually is.
   *
   * An account that has never been seen, one whose setting excludes the asker,
   * and one the asker has disqualified themselves from reading are all simply
   * absent from the map. That is deliberate: every client already draws a
   * missing timestamp as no line at all, so which of the three reasons produced
   * it is not something the wire says.
   */
  async lastSeenOf(askerId: string, userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();

    const [live, rows, asker, friendships] = await Promise.all([
      this.redis.hmget(LAST_SEEN_KEY, ...userIds),
      prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, lastSeenAt: true, lastSeenVisibility: true },
      }),
      prisma.user.findUnique({
        where: { id: askerId },
        select: { lastSeenVisibility: true },
      }),
      // Only the friendships that could matter - the asker's, with these
      // subjects - rather than their whole friend list.
      prisma.friendship.findMany({
        where: {
          status: 'ACCEPTED',
          OR: [
            { userAId: askerId, userBId: { in: userIds } },
            { userBId: askerId, userAId: { in: userIds } },
          ],
        },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const friendIds = new Set(
      friendships.map((row) => (row.userAId === askerId ? row.userBId : row.userAId)),
    );
    const allowed = readableLastSeen(
      askerId,
      toVisibility(asker?.lastSeenVisibility),
      rows.map((row) => ({ id: row.id, visibility: toVisibility(row.lastSeenVisibility) })),
      friendIds,
    );

    const stored = new Map(rows.map((row) => [row.id, row.lastSeenAt?.getTime() ?? 0]));
    const seen = new Map<string, string>();
    userIds.forEach((userId, index) => {
      if (!allowed.has(userId)) return;
      const at = Math.max(Number(live[index] ?? 0), stored.get(userId) ?? 0);
      if (at > 0) seen.set(userId, new Date(at).toISOString());
    });
    return seen;
  }

  /**
   * The status a user chose. It outlives the connection on purpose: someone who
   * set themselves invisible expects to still be invisible after a restart.
   */
  async setStatus(userId: string, status: ActiveStatus): Promise<void> {
    await this.redis.hset(STATUS_KEY, userId, status);
  }

  async statusOf(userId: string): Promise<ActiveStatus> {
    const stored = await this.redis.hget(STATUS_KEY, userId);
    return isActiveStatus(stored) ? stored : 'online';
  }

  /**
   * What everyone else may see. An invisible user is reported `offline`, and
   * that resolution happens here rather than in the client, because a status
   * that only the UI hides is not invisible.
   */
  async visibleStatusOf(userId: string): Promise<PresenceStatus> {
    const status = await this.statusOf(userId);
    return status === 'invisible' ? 'offline' : status;
  }

  /**
   * One account's status as everybody else sees it, connection included.
   *
   * `visibleStatusOf` answers only what was *chosen*, and a chosen status
   * outlives the connection - so somebody who has never been seen, and
   * somebody who signed off a week ago, both read back `online` from it. This
   * is the one that asks whether they are actually here, and it is what a
   * `presence.query` needs: the question is being asked precisely about people
   * who are probably not.
   */
  async stateOf(userId: string): Promise<PresenceStatus> {
    const score = await this.redis.zscore(ONLINE_KEY, userId);
    if (score === null || Number(score) < Date.now() - STALE_AFTER_MS) return 'offline';
    return this.visibleStatusOf(userId);
  }

  async onlineUsers(): Promise<PresenceState[]> {
    const cutoff = Date.now() - STALE_AFTER_MS;
    // Drop stale entries as a side effect of reading, so no sweeper job is
    // needed for a set this small.
    await this.redis.zremrangebyscore(ONLINE_KEY, '-inf', cutoff);
    const ids = await this.redis.zrange(ONLINE_KEY, 0, -1);

    const states = await Promise.all(
      ids.map(async (userId) => ({ userId, status: await this.visibleStatusOf(userId) })),
    );
    // An invisible user resolves to `offline`, which is the same as not being
    // in the list at all - so leave them out rather than sending a contradiction.
    return states.filter((state) => state.status !== 'offline');
  }

  /**
   * Writes a channel's roster to exactly what `call-service` says it is.
   *
   * A replace rather than an add or a remove, because the authority sends the
   * whole roster: anything left in Redis that is not in it is a client that
   * said it joined and never did, or one that died without saying goodbye.
   *
   * And it expires, for the same reason `presence:online` does. A roster is
   * only ever replaced per channel, so a channel `call-service` never mentions
   * again keeps whatever it last said - which after that service restarts
   * mid-call is a room full of people who left. `call-service` re-announces
   * every live call on its heartbeat, three times inside this window, so a
   * roster that stops being refreshed is a roster nothing is behind any more.
   */
  async replaceVoice(channelId: string, userIds: string[]): Promise<VoiceState> {
    const key = VOICE_KEY(channelId);
    if (userIds.length === 0) {
      await this.redis.del(key);
      await this.redis.srem(VOICE_INDEX, channelId);
      return { channelId, userIds: [] };
    }

    // Delete and rewrite in one round trip, so a reader never sees the empty
    // moment in between.
    await this.redis
      .multi()
      .del(key)
      .sadd(key, ...userIds)
      .pexpire(key, STALE_AFTER_MS)
      .sadd(VOICE_INDEX, channelId)
      .exec();
    return { channelId, userIds };
  }

  /**
   * Rosters nothing has refreshed, dropped from the index and named.
   *
   * The key expires by itself; this is what notices, so the people looking at
   * that channel can be told rather than left on a stale list until they
   * reconnect. The gateway calls it on its heartbeat.
   */
  async expireVoice(): Promise<string[]> {
    const channels = await this.redis.smembers(VOICE_INDEX);
    const lifetimes = await Promise.all(
      channels.map((channelId) => this.redis.pttl(VOICE_KEY(channelId))),
    );

    const gone: string[] = [];
    await Promise.all(
      channels.map(async (channelId, index) => {
        switch (voiceLifetime(lifetimes[index] ?? -2)) {
          case 'gone':
            gone.push(channelId);
            return;
          // A roster written before rosters had a lifetime. Put on the same
          // clock rather than deleted outright, so a call that is genuinely
          // running is re-announced onto it instead of blinking empty.
          case 'adopt':
            await this.redis.pexpire(VOICE_KEY(channelId), STALE_AFTER_MS);
            return;
          case 'live':
            return;
        }
      }),
    );

    if (gone.length > 0) await this.redis.srem(VOICE_INDEX, ...gone);
    return gone;
  }

  // There were `joinVoice`, `leaveVoice` and `voiceChannelsOf` here, one per
  // thing a client claimed about itself. They are gone with the claim: a roster
  // arrives whole from call-service, so there is nothing to add, nothing to
  // remove, and no need to ask which channels somebody is in so that a
  // disconnect can guess its way out of them.

  /**
   * Who has this channel on screen, scored by when they last said so.
   *
   * The same shape as `presence:online` and for the same reason: a client that
   * dies without saying goodbye has to age out rather than suppress that
   * channel's notifications forever. The gateway clears the entry on a clean
   * disconnect, the score handles the unclean one, and the TTL on the key
   * itself means a channel nobody is reading leaves nothing behind in Redis.
   *
   * Per user, not per device. If any of somebody's windows is looking at the
   * channel, none of their devices needs to be woken for it.
   */
  async focus(channelId: string, userId: string): Promise<void> {
    const key = FOCUS_KEY(channelId);
    await this.redis
      .multi()
      .zadd(key, Date.now(), userId)
      .pexpire(key, STALE_AFTER_MS)
      .exec();
  }

  async blur(channelId: string, userId: string): Promise<void> {
    await this.redis.zrem(FOCUS_KEY(channelId), userId);
  }

  /**
   * Which of [userIds] are reading [channelId] right now.
   *
   * Stale entries are dropped as a side effect of the read, exactly as
   * `onlineUsers` does - there is no sweeper for either.
   */
  async focusedAmong(channelId: string, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const key = FOCUS_KEY(channelId);
    await this.redis.zremrangebyscore(key, '-inf', Date.now() - STALE_AFTER_MS);
    const reading = new Set(await this.redis.zrange(key, 0, -1));
    return userIds.filter((userId) => reading.has(userId));
  }

  async voiceState(channelId: string): Promise<VoiceState> {
    return { channelId, userIds: await this.redis.smembers(VOICE_KEY(channelId)) };
  }

  async allVoiceStates(): Promise<VoiceState[]> {
    const channels = await this.redis.smembers(VOICE_INDEX);
    const states = await Promise.all(channels.map((channelId) => this.voiceState(channelId)));
    // An expired roster leaves its channel in the index until the sweep gets to
    // it. Sending it as an empty room would be harmless; sending nothing is
    // what a client already understands as "nobody is in there".
    return states.filter((state) => state.userIds.length > 0);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}

export function isActiveStatus(value: string | null): value is ActiveStatus {
  return value !== null && (ACTIVE_STATUSES as string[]).includes(value);
}
