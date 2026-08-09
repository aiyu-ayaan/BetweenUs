/**
 * Event contracts plus a thin Redis Pub/Sub transport.
 *
 * Redis Pub/Sub is the stage-1 bus per the architecture doc; the publish/
 * subscribe surface here is deliberately transport-agnostic so swapping in NATS
 * later touches this file only.
 */
import Redis from 'ioredis';
import type { Message, PresenceState, VoiceState } from '@nexora/shared-types';

export const EVENTS = {
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ONLINE: 'user.online',
  USER_OFFLINE: 'user.offline',
  SERVER_CREATED: 'server.created',
  SERVER_MEMBER_ADDED: 'server.member.added',
  SERVER_MEMBER_REMOVED: 'server.member.removed',
  CHANNEL_CREATED: 'channel.created',
  CHANNEL_DELETED: 'channel.deleted',
  PRESENCE_CHANGED: 'presence.changed',
  PRESENCE_TYPING: 'presence.typing',
  PRESENCE_VOICE: 'presence.voice',
  MESSAGE_CREATED: 'message.created',
  MESSAGE_UPDATED: 'message.updated',
  MESSAGE_DELETED: 'message.deleted',
  FRIEND_CHANGED: 'friend.changed',
} as const;

export interface EventPayloads {
  [EVENTS.USER_CREATED]: { userId: string; username: string; email: string };
  [EVENTS.USER_UPDATED]: { userId: string };
  [EVENTS.USER_ONLINE]: { userId: string };
  [EVENTS.USER_OFFLINE]: { userId: string };
  [EVENTS.SERVER_CREATED]: { serverId: string; ownerId: string };
  [EVENTS.SERVER_MEMBER_ADDED]: { serverId: string; userId: string };
  [EVENTS.SERVER_MEMBER_REMOVED]: { serverId: string; userId: string };
  [EVENTS.CHANNEL_CREATED]: { channelId: string; serverId: string };
  [EVENTS.CHANNEL_DELETED]: { channelId: string; serverId: string };
  [EVENTS.PRESENCE_CHANGED]: { user: PresenceState };
  [EVENTS.PRESENCE_TYPING]: { channelId: string; userId: string; username: string };
  [EVENTS.PRESENCE_VOICE]: { voice: VoiceState };
  [EVENTS.MESSAGE_CREATED]: { message: Message };
  [EVENTS.MESSAGE_UPDATED]: { message: Message };
  /** Carries the tombstone, because a deleted message still renders as one. */
  [EVENTS.MESSAGE_DELETED]: { messageId: string; channelId: string; message: Message };
  /**
   * Both sides of the friendship, because either of them may be connected to a
   * different instance and both screens have to change.
   */
  [EVENTS.FRIEND_CHANGED]: { userIds: string[] };
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
