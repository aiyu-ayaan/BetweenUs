/**
 * Decides who may join a channel's call, and hands out ICE servers.
 *
 * That is the whole of it. There is no room to create, no token to sign and no
 * media server address to advertise, because media goes directly between the
 * participants - see `call.gateway.ts` for the introduction and `ice.ts` for
 * how a path between them is found.
 *
 * The permission check lives here as well as in the gateway on purpose: the
 * client asks for ICE servers before it opens the signalling socket, so a
 * member who may not start a call finds out from a 403 rather than from a
 * socket that connects and then refuses.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { iceServers } from '@betweenus/config';
import { Prisma, prisma, resolveChannelAccess } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { PERMISSIONS } from '@betweenus/permissions';
import type {
  CallAnalytics,
  CallHistoryEntry,
  CallIceResponse,
  CallLinkReport,
  CallUsageTotals,
} from '@betweenus/shared-types';
import { ringIsAllowed, ringKey } from './ring-cooldown';
import { clampReportedBytes, clampReportedLinks } from './usage';

/** How far back a person's own call log goes when they open it. */
const HISTORY_LIMIT = 50;

@Injectable()
export class CallsService {
  constructor(private readonly events: EventBus) {}

  /**
   * When each pair last rang.
   *
   * ponytail: in memory, so two instances of this service would each allow one
   * ring per window. One instance is what the compose file runs - the same
   * assumption `push.service.ts` makes about its roster cache. Move both to
   * Redis together if there is ever a second.
   */
  private readonly lastRing = new Map<string, number>();

  async ice(userId: string, channelId: string): Promise<CallIceResponse> {
    await this.requireChannelAccess(userId, channelId);
    return { iceServers: await iceServers() };
  }

  /**
   * Rings one person into a call in a channel both of them can see.
   *
   * Three questions, and they are separate: may the caller start a call here,
   * may the person being rung be in this conversation at all, and have they
   * been rung too recently. The middle one is the one worth being careful
   * about - without it this endpoint is a way to make an arbitrary account's
   * phone ring by naming a channel they have never heard of.
   *
   * It does not require the caller to already be in the call. Ringing somebody
   * and then joining is a normal order to do it in, and refusing it would only
   * mean the client had to join first - which is a rule with no one behind it.
   */
  async ring(callerId: string, channelId: string, targetId: string): Promise<void> {
    if (callerId === targetId) {
      throw new ForbiddenException({
        code: 'CANNOT_RING_SELF',
        message: 'You cannot ring yourself',
      });
    }

    // The caller's access first, so somebody probing for channels they cannot
    // see gets the same 404 they would get from anything else.
    await this.requireChannelAccess(callerId, channelId);

    // And the recipient's, which is what stops this being a way to ring any
    // account in the deployment. `VIEW_CHANNEL` rather than `START_CALL`:
    // being able to hear the conversation is what makes an invitation into it
    // meaningful, and somebody who may not start a call may certainly be
    // invited to one.
    const target = await resolveChannelAccess(targetId, channelId);
    if (!target?.permissions.includes(PERMISSIONS.VIEW_CHANNEL)) {
      throw new ForbiddenException({
        code: 'CANNOT_RING_USER',
        message: 'They are not in this channel',
      });
    }

    const key = ringKey(callerId, targetId);
    const now = Date.now();
    if (!ringIsAllowed(this.lastRing.get(key), now)) {
      throw new ForbiddenException({
        code: 'RING_TOO_SOON',
        message: 'You just rang them. Give them a moment.',
      });
    }
    this.lastRing.set(key, now);

    const [channel, caller] = await Promise.all([
      prisma.channel.findUnique({ where: { id: channelId }, select: { name: true } }),
      prisma.user.findUnique({
        where: { id: callerId },
        select: { username: true, displayName: true, avatarUrl: true },
      }),
    ]);
    if (!channel || !caller) {
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    // Everything a subscriber could need is on the event, so neither the push
    // fan-out nor the presence gateway reads a table this service owns.
    await this.events.publish(EVENTS.CALL_RING, {
      channelId,
      channelName: channel.name,
      callerId,
      callerName: caller.displayName || caller.username,
      ...(caller.avatarUrl ? { callerAvatarUrl: caller.avatarUrl } : {}),
      targetId,
    });
  }

  /**
   * Opens a row for one person's stay in one call.
   *
   * Called by the gateway once a join has been allowed, because the gateway is
   * the only thing that knows the join happened. The channel and server names
   * are copied in here: the log is read months later, and a join is the last
   * moment they are certainly still there to read.
   *
   * Returns null rather than throwing when the write fails. A call whose
   * history could not be opened is still a call, and taking it down over a
   * bookkeeping row would be the wrong trade every time.
   */
  async startSession(userId: string, channelId: string): Promise<string | null> {
    const channel = await prisma.channel
      .findUnique({
        where: { id: channelId },
        select: { name: true, serverId: true, server: { select: { name: true } } },
      })
      .catch(() => null);
    if (!channel) return null;

    const session = await prisma.callSession
      .create({
        data: {
          userId,
          channelId,
          channelName: channel.name,
          serverId: channel.serverId,
          serverName: channel.server?.name ?? null,
        },
        select: { id: true },
      })
      .catch(() => null);

    return session?.id ?? null;
  }

  /**
   * Closes it: when they left, who they were in it with, and what their machine
   * moved.
   *
   * `bytes` is the client's own count and nothing here can check it - the
   * service is not in the media path - so it is clamped rather than trusted.
   */
  async endSession(sessionId: string, peerIds: string[], usage: ReportedUsage): Promise<void> {
    const links = clampReportedLinks(usage.links);
    const sent = clampReportedBytes(usage.bytesSent);
    const received = clampReportedBytes(usage.bytesReceived);

    await prisma.callSession
      .update({
        where: { id: sessionId },
        data: {
          endedAt: new Date(),
          peerIds,
          // The total is still the total the client reported, not the sum of
          // the halves: a client that reports one and not the other should read
          // back as the number it actually gave rather than as a repair.
          bytes: BigInt(clampReportedBytes(usage.bytes)),
          bytesSent: BigInt(sent),
          bytesReceived: BigInt(received),
          // Prisma's JSON input type does not accept a typed array as itself.
          links: links as unknown as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }

  /**
   * One person's own call log, newest first.
   *
   * Only their own: there is no parameter for whose log to read, because a
   * "whose" is the only thing that could ever be wrong here.
   */
  async history(userId: string): Promise<CallHistoryEntry[]> {
    const sessions = await prisma.callSession.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      take: HISTORY_LIMIT,
    });

    // One lookup for every name on the page rather than one per row, and by
    // current name rather than a snapshot: somebody who renamed themselves
    // reads back as who they are now, which is who the reader is looking for.
    const peerIds = [...new Set(sessions.flatMap((session) => session.peerIds))];
    const people = peerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: peerIds } },
          select: { id: true, username: true, displayName: true },
        })
      : [];
    const byId = new Map(people.map((person) => [person.id, person]));

    return sessions.map((session) => ({
      id: session.id,
      channelId: session.channelId,
      channelName: session.channelName,
      serverId: session.serverId,
      serverName: session.serverName,
      joinedAt: session.joinedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      durationSeconds: session.endedAt
        ? Math.max(0, Math.round((session.endedAt.getTime() - session.joinedAt.getTime()) / 1000))
        : null,
      // A peer whose account is gone is dropped rather than drawn as an id.
      peers: session.peerIds.flatMap((id) => {
        const person = byId.get(id);
        return person ? [person] : [];
      }),
      bytes: Number(session.bytes),
      bytesSent: Number(session.bytesSent),
      bytesReceived: Number(session.bytesReceived),
      links: readLinks(session.links),
    }));
  }

  /**
   * The same rows, added up: what calls have cost this account lately.
   *
   * Read from `call_sessions` rather than from a counter kept somewhere else,
   * so the totals and the log can never disagree - there is one set of rows and
   * two readings of it. The window is bounded and the rows are one person's, so
   * this is a small scan rather than the aggregate query it looks like.
   *
   * ponytail: added up in this process. A month of one account's calls is
   * hundreds of rows; `groupBy` in SQL is the fix if it is ever thousands, and
   * the shape of what comes back does not change when it is.
   */
  async analytics(userId: string, days: number): Promise<CallAnalytics> {
    const window = Math.min(Math.max(Math.round(days) || DEFAULT_ANALYTICS_DAYS, 1), MAX_ANALYTICS_DAYS);
    const since = startOfDay(new Date());
    since.setDate(since.getDate() - (window - 1));

    const sessions = await prisma.callSession.findMany({
      where: { userId, joinedAt: { gte: since } },
      orderBy: { joinedAt: 'asc' },
    });

    // Every day in the window, including the empty ones. A chart drawn from a
    // series with holes in it either invents the missing days or draws a week
    // as five points, and both are wrong in a way nobody reading it can see.
    const daily = new Map<string, CallUsageTotals>();
    for (let day = 0; day < window; day += 1) {
      const at = new Date(since);
      at.setDate(at.getDate() + day);
      daily.set(dayKey(at), emptyTotals());
    }

    const totals = emptyTotals();
    const channels = new Map<string, { channelId: string; channelName: string; serverName: string | null } & CallUsageTotals>();
    const peerSeconds = new Map<string, { calls: number; seconds: number }>();
    const transport = { direct: 0, relay: 0, unknown: 0 };

    for (const session of sessions) {
      const seconds = session.endedAt
        ? Math.max(0, Math.round((session.endedAt.getTime() - session.joinedAt.getTime()) / 1000))
        : 0;
      const sent = Number(session.bytesSent);
      const received = Number(session.bytesReceived);

      add(totals, seconds, sent, received);
      const day = daily.get(dayKey(session.joinedAt));
      if (day) add(day, seconds, sent, received);

      const channel = channels.get(session.channelId) ?? {
        channelId: session.channelId,
        channelName: session.channelName,
        serverName: session.serverName,
        ...emptyTotals(),
      };
      add(channel, seconds, sent, received);
      channels.set(session.channelId, channel);

      for (const peerId of new Set(session.peerIds)) {
        const peer = peerSeconds.get(peerId) ?? { calls: 0, seconds: 0 };
        peer.calls += 1;
        peer.seconds += seconds;
        peerSeconds.set(peerId, peer);
      }

      for (const link of readLinks(session.links)) {
        if (link.transport === 'direct') transport.direct += 1;
        else if (link.transport === 'relay') transport.relay += 1;
        else transport.unknown += 1;
      }
    }

    const people = peerSeconds.size
      ? await prisma.user.findMany({
          where: { id: { in: [...peerSeconds.keys()] } },
          select: { id: true, username: true, displayName: true },
        })
      : [];

    return {
      days: window,
      totals,
      daily: [...daily.entries()].map(([date, entry]) => ({ date, ...entry })),
      channels: [...channels.values()].sort((a, b) => b.seconds - a.seconds).slice(0, TOP_N),
      peers: people
        .map((person) => ({ ...person, ...(peerSeconds.get(person.id) ?? { calls: 0, seconds: 0 }) }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, TOP_N),
      transport,
    };
  }

  /**
   * The same resolver chat- and presence-service use, so a private channel or a
   * revoked permission takes effect here at the same moment it does there.
   */
  private async requireChannelAccess(userId: string, channelId: string): Promise<void> {
    const access = await resolveChannelAccess(userId, channelId);
    if (!access) {
      // 404, not 403: a non-member must not learn the channel exists.
      throw new NotFoundException({ code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
    }

    if (!access.permissions.includes(PERMISSIONS.START_CALL)) {
      throw new ForbiddenException({
        code: 'MISSING_PERMISSION',
        message: `Missing permission ${PERMISSIONS.START_CALL}`,
      });
    }
  }
}

/** What a client says one stay in a call moved. Nothing here is checkable. */
export interface ReportedUsage {
  bytes: number;
  bytesSent: number;
  bytesReceived: number;
  links: unknown;
}

/** How far back the analytics page looks when nothing says otherwise. */
const DEFAULT_ANALYTICS_DAYS = 30;
/** And the furthest it will, so one request cannot ask for every row ever. */
const MAX_ANALYTICS_DAYS = 365;
/** How many channels and people the page names before it stops being a list. */
const TOP_N = 5;

/**
 * The per-link detail back out of the JSON column.
 *
 * Clamped again on the way out rather than trusted because it was clamped on
 * the way in: the rows outlive the code that wrote them, and a shape this
 * version never wrote is exactly what an older one might have.
 */
function readLinks(value: unknown): CallLinkReport[] {
  return clampReportedLinks(value);
}

function emptyTotals(): CallUsageTotals {
  return { calls: 0, seconds: 0, bytesSent: 0, bytesReceived: 0 };
}

function add(totals: CallUsageTotals, seconds: number, sent: number, received: number): void {
  totals.calls += 1;
  totals.seconds += seconds;
  totals.bytesSent += sent;
  totals.bytesReceived += received;
}

/** Local date, because a day is what somebody reading a chart means by one. */
function dayKey(at: Date): string {
  const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function startOfDay(at: Date): Date {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day;
}
