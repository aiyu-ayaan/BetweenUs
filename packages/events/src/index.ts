/**
 * Event contracts plus a thin Redis Pub/Sub transport.
 *
 * Redis Pub/Sub is the stage-1 bus per the architecture doc; the publish/
 * subscribe surface here is deliberately transport-agnostic so swapping in NATS
 * later touches this file only.
 */
import Redis from 'ioredis';
import type { Message, PresenceState, UserSummary, VoiceState } from '@betweenus/shared-types';

export const EVENTS = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ONLINE: 'user.online',
  USER_OFFLINE: 'user.offline',
  SERVER_CREATED: 'server.created',
  /**
   * A server's own details changed - its name, or its picture.
   *
   * Separate from `server.member.updated`, which is about one person's standing
   * in it: this is the thing every member has on screen at once, in a sidebar
   * they are not looking at, and it has to change under them without a reload.
   */
  SERVER_UPDATED: 'server.updated',
  SERVER_MEMBER_ADDED: 'server.member.added',
  SERVER_MEMBER_REMOVED: 'server.member.removed',
  /** A role or a permission override changed on an existing member. */
  SERVER_MEMBER_UPDATED: 'server.member.updated',
  CHANNEL_CREATED: 'channel.created',
  CHANNEL_DELETED: 'channel.deleted',
  PRESENCE_CHANGED: 'presence.changed',
  PRESENCE_TYPING: 'presence.typing',
  PRESENCE_VOICE: 'presence.voice',
  /**
   * The roster of a call, as `call-service` knows it - which is the only place
   * that knows it. Published on every join and every departure, including the
   * ones nobody announced: a dropped socket, a crashed window, a device whose
   * call moved elsewhere.
   */
  CALL_ROSTER: 'call.roster',
  /**
   * One person ringing another into a call.
   *
   * Deliberately not part of `call.roster`: a roster is a fact about a channel
   * and is broadcast to everybody who can hear it, where this is aimed at one
   * account by somebody who chose to aim it. That difference is the whole
   * reason it may ring a locked phone.
   *
   * One event per person rung, so the two subscribers - the push fan-out and
   * the presence gateway - never have to agree about how to split a list.
   */
  CALL_RING: 'call.ring',
  /**
   * Somebody said no to a ring, on one of their devices.
   *
   * The counterpart to `call.ring` and aimed the same way, except that it is
   * aimed *back* at the account that declined rather than at anybody else. It
   * exists because declining leaves no other trace: answering shows up in
   * `call.roster` - the account appears in it - and a decline shows up
   * nowhere, so the phone in the other pocket had nothing to go on and rang
   * until it timed out.
   *
   * It is deliberately not sent to whoever rang. A ring is not a handshake and
   * it rings out for the caller either way; telling them would be a new
   * feature, not this one.
   */
  CALL_DECLINED: 'call.declined',
  MESSAGE_CREATED: 'message.created',
  MESSAGE_UPDATED: 'message.updated',
  MESSAGE_DELETED: 'message.deleted',
  FRIEND_CHANGED: 'friend.changed',
  /**
   * Somebody posted, deleted, or aged out of a status.
   *
   * The audience is computed where it is published rather than where it is
   * consumed: the gateway holds sockets, not friendships, and the service that
   * wrote the row already had the friend list in hand to authorise the write.
   */
  STATUS_CHANGED: 'status.changed',
  /**
   * Somebody read a channel, on one of their devices.
   *
   * Published so their *other* devices can take down a notification for it.
   * A phone that buzzed while its owner was walking to their desk should not
   * still be showing that notification once they have read the message on the
   * laptop - which is the behaviour every messenger has and the one thing a
   * read marker was never used for here.
   */
  CHANNEL_READ: 'channel.read',
  /**
   * Somebody cleared their own history, on one of their devices.
   *
   * Published so their *other* devices drop the copies they are holding. It
   * reaches nobody else: the rows are untouched and every other participant's
   * view of the conversation is exactly what it was.
   */
  CHATS_CLEARED: 'chats.cleared',
  /**
   * Somebody started or ended a remote session on a machine.
   *
   * One event with a state rather than the `remote.session.started` and
   * `remote.session.ended` pair the architecture doc names, for the same
   * reason `call.roster` is one event: what hangs off it is a single
   * notification that appears and then has to be taken away again, and two
   * events would be two subscriptions that must never disagree about which
   * notification they are talking about.
   *
   * It carries everything a notification needs, so the subscriber makes no
   * database call of its own - and in particular does not read remote-desktop
   * tables that belong to another service.
   */
  REMOTE_SESSION: 'remote.session',
  /**
   * An account's authority has been withdrawn, and every socket already holding
   * it has to go.
   *
   * The gap this closes: disabling an account stops new sessions and stops a
   * refresh being spent, so a stolen access token is useless within fifteen
   * minutes - but a chat, presence, call or remote socket that was *already
   * open* is authenticated once at the handshake and never again. It kept
   * delivering until it happened to disconnect, which for a call socket is
   * "until the call ends".
   *
   * Expiring sockets at the access token's expiry was the obvious fix and is
   * the wrong one: a call socket closing is a call ending, and doing that to
   * everybody every fifteen minutes is worse than the gap. This is the other
   * shape - nothing happens on a healthy deployment, and the sockets go the
   * moment somebody says they should.
   */
  SESSION_REVOKED: 'session.revoked',
} as const;

export interface EventPayloads {
  [EVENTS.USER_CREATED]: { userId: string; username: string; email: string };
  /**
   * Carries the profile rather than the id, because the picture and the name
   * are painted in a dozen places at once - every message that account ever
   * sent, the member list, the friend list, a DM header - and an id would make
   * each of those a refetch. The four public fields are all any of them draw.
   */
  [EVENTS.USER_UPDATED]: { user: UserSummary };
  [EVENTS.USER_ONLINE]: { userId: string };
  [EVENTS.USER_OFFLINE]: { userId: string };
  [EVENTS.SERVER_CREATED]: { serverId: string; ownerId: string };
  /** Same reasoning as `user.updated`: what changed, not a hint to go and ask. */
  [EVENTS.SERVER_UPDATED]: { serverId: string; name: string; iconUrl: string | null };
  [EVENTS.SERVER_MEMBER_ADDED]: { serverId: string; userId: string };
  [EVENTS.SERVER_MEMBER_REMOVED]: { serverId: string; userId: string };
  [EVENTS.SERVER_MEMBER_UPDATED]: { serverId: string; userId: string };
  [EVENTS.CHANNEL_CREATED]: { channelId: string; serverId: string };
  [EVENTS.CHANNEL_DELETED]: { channelId: string; serverId: string };
  [EVENTS.PRESENCE_CHANGED]: { user: PresenceState };
  [EVENTS.PRESENCE_TYPING]: { channelId: string; userId: string; username: string };
  [EVENTS.PRESENCE_VOICE]: { voice: VoiceState };
  [EVENTS.CALL_ROSTER]: { voice: VoiceState };
  /**
   * Everything a ring needs, so neither subscriber reads a table of its own -
   * `call-service` has already resolved the channel and the caller, and has
   * already decided that both ends are allowed to be in this conversation.
   */
  [EVENTS.CALL_RING]: {
    channelId: string;
    channelName: string;
    callerId: string;
    callerName: string;
    callerAvatarUrl?: string;
    /** Who is being rung. */
    targetId: string;
  };
  /** Who said no, and to what. Both subscribers deliver only to that account. */
  [EVENTS.CALL_DECLINED]: { channelId: string; userId: string };
  [EVENTS.MESSAGE_CREATED]: { message: Message };
  [EVENTS.MESSAGE_UPDATED]: { message: Message };
  /** Carries the tombstone, because a deleted message still renders as one. */
  /**
   * A message is gone. `message` is the tombstone every client renders in its
   * place - or null when there is no tombstone to render, because the row was
   * destroyed rather than emptied.
   *
   * Two shapes because there are two kinds of gone. An ordinary delete leaves
   * "this message was deleted" in the conversation, which is honest and is
   * what everybody expects. A one-time message that was opened, and a message
   * whose disappearing window closed, leave nothing: a permanent marker
   * reading "something was here" tells exactly the story those two features
   * were chosen to avoid telling.
   */
  [EVENTS.MESSAGE_DELETED]: {
    messageId: string;
    channelId: string;
    message: Message | null;
  };
  /**
   * Both sides of the friendship, because either of them may be connected to a
   * different instance and both screens have to change.
   *
   * `actorId` and `kind` are for the half that is not a screen refresh: a
   * notification has to say who did what, and "reload your friend list" cannot.
   * Both are optional so a producer that only wants the refresh still type
   * checks - a subscriber with neither simply sends nothing.
   */
  [EVENTS.CHANNEL_READ]: { userId: string; channelId: string; at: string };
  [EVENTS.CHATS_CLEARED]: {
    userId: string;
    clearedAt: string;
    /** The conversation cleared, or null when every one of them was. */
    channelId: string | null;
  };
  [EVENTS.REMOTE_SESSION]: {
    sessionId: string;
    machineId: string;
    machineName: string;
    /** Who owns the machine. The person a session on it is news for. */
    ownerId: string;
    /** Who is driving it. Told nothing: they are the one who started it. */
    actorId: string;
    actorName: string;
    state: 'started' | 'ended';
  };
  [EVENTS.FRIEND_CHANGED]: {
    userIds: string[];
    actorId?: string;
    kind?: 'requested' | 'accepted' | 'removed';
  };
  [EVENTS.STATUS_CHANGED]: {
    /** Everyone who should re-read their tray: the author's friends, and the author. */
    userIds: string[];
    authorId: string;
  };
  [EVENTS.SESSION_REVOKED]: {
    userId: string;
    /**
     * Seconds since the epoch. A socket goes if the access token that opened it
     * was issued strictly before this, and stays if it was issued at or after
     * it.
     *
     * A timestamp rather than a flag, because "sign every session out" and
     * "sign every *other* session out" are the same event with a different line
     * drawn through it. Changing a password revokes every refresh token but
     * mints a new pair for the person doing it, so their own token is newer
     * than the line and their call survives while whoever else was holding the
     * account is dropped mid-sentence. Disabling an account sets the line at
     * `now` and nothing survives it.
     *
     * Seconds, not milliseconds, because that is the unit a JWT's `iat` is in
     * and comparing the two in different units is a bug that only shows up as
     * "revocation does nothing".
     */
    notBefore: number;
    /** For the log line. Never sent to a client. */
    reason: 'disabled' | 'deleted' | 'password-changed' | 'token-reuse' | 'signed-out';
  };
}

export type EventName = keyof EventPayloads;

export interface EventEnvelope<K extends EventName = EventName> {
  event: K;
  payload: EventPayloads[K];
  emittedAt: string;
  /** Instance that emitted it, so subscribers can skip their own echo. */
  origin: string;
}

/**
 * One publisher connection plus one subscriber connection (Redis forbids
 * regular commands on a connection in subscriber mode).
 */
export class EventBus {
  private readonly publisher: Redis;
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, Set<(envelope: EventEnvelope) => void>>();

  constructor(
    private readonly redisUrl: string,
    private readonly origin: string,
  ) {
    this.publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async publish<K extends EventName>(event: K, payload: EventPayloads[K]): Promise<void> {
    const envelope: EventEnvelope<K> = {
      event,
      payload,
      emittedAt: new Date().toISOString(),
      origin: this.origin,
    };
    await this.publisher.publish(event, JSON.stringify(envelope));
  }

  async subscribe<K extends EventName>(
    event: K,
    handler: (envelope: EventEnvelope<K>) => void,
  ): Promise<void> {
    if (!this.subscriber) {
      this.subscriber = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
      this.subscriber.on('message', (channel: string, raw: string) => {
        const listeners = this.handlers.get(channel);
        if (!listeners) return;
        let envelope: EventEnvelope;
        try {
          envelope = JSON.parse(raw) as EventEnvelope;
        } catch {
          return; // Malformed payload from another producer - drop it.
        }
        for (const listener of listeners) listener(envelope);
      });
    }

    let listeners = this.handlers.get(event);
    if (!listeners) {
      listeners = new Set();
      this.handlers.set(event, listeners);
      await this.subscriber.subscribe(event);
    }
    listeners.add(handler as (envelope: EventEnvelope) => void);
  }

  /** True when the envelope came from this process (used to avoid double delivery). */
  isOwnEvent(envelope: EventEnvelope): boolean {
    return envelope.origin === this.origin;
  }

  async close(): Promise<void> {
    await this.publisher.quit();
    if (this.subscriber) await this.subscriber.quit();
  }
}
