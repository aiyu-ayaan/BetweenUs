/**
 * Event contracts plus a thin Redis Pub/Sub transport.
 *
 * Redis Pub/Sub is the stage-1 bus per the architecture doc; the publish/
 * subscribe surface here is deliberately transport-agnostic so swapping in NATS
 * later touches this file only.
 */
import Redis from 'ioredis';
import type { Message, PresenceState, VoiceState } from '@betweenus/shared-types';

export const EVENTS = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ONLINE: 'user.online',
  USER_OFFLINE: 'user.offline',
  SERVER_CREATED: 'server.created',
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
  MESSAGE_CREATED: 'message.created',
  MESSAGE_UPDATED: 'message.updated',
  MESSAGE_DELETED: 'message.deleted',
  FRIEND_CHANGED: 'friend.changed',
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
} as const;

export interface EventPayloads {
  [EVENTS.USER_CREATED]: { userId: string; username: string; email: string };
  [EVENTS.USER_UPDATED]: { userId: string };
  [EVENTS.USER_ONLINE]: { userId: string };
  [EVENTS.USER_OFFLINE]: { userId: string };
  [EVENTS.SERVER_CREATED]: { serverId: string; ownerId: string };
  [EVENTS.SERVER_MEMBER_ADDED]: { serverId: string; userId: string };
  [EVENTS.SERVER_MEMBER_REMOVED]: { serverId: string; userId: string };
  [EVENTS.SERVER_MEMBER_UPDATED]: { serverId: string; userId: string };
  [EVENTS.CHANNEL_CREATED]: { channelId: string; serverId: string };
  [EVENTS.CHANNEL_DELETED]: { channelId: string; serverId: string };
  [EVENTS.PRESENCE_CHANGED]: { user: PresenceState };
  [EVENTS.PRESENCE_TYPING]: { channelId: string; userId: string; username: string };
  [EVENTS.PRESENCE_VOICE]: { voice: VoiceState };
  [EVENTS.CALL_ROSTER]: { voice: VoiceState };
  [EVENTS.MESSAGE_CREATED]: { message: Message };
  [EVENTS.MESSAGE_UPDATED]: { message: Message };
  /** Carries the tombstone, because a deleted message still renders as one. */
  [EVENTS.MESSAGE_DELETED]: { messageId: string; channelId: string; message: Message };
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
