/**
 * `/ws/presence` realtime gateway: online status, typing indicators and voice
 * channel membership.
 *
 * State lives in Redis and changes fan out over Redis Pub/Sub, so several
 * presence-service instances stay consistent without sticky sessions - the same
 * pattern the chat gateway uses.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { EVENTS, EventBus } from '@nexora/events';
import { resolveChannelAccess } from '@nexora/database';
import { PERMISSIONS } from '@nexora/permissions';
import { Logger } from '@nexora/logger';
import { authenticateHandshake } from '@nexora/websocket';
import type { ClientPresenceEvent, ServerPresenceEvent } from '@nexora/shared-types';
import { PresenceStore, isActiveStatus } from './presence.store';

const HEARTBEAT_INTERVAL_MS = 30_000;

interface SocketState {
  userId: string;
  username: string;
  alive: boolean;
}

@Injectable()
export class PresenceGateway implements OnModuleDestroy {
  private server: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly state = new WeakMap<WebSocket, SocketState>();

  constructor(
    private readonly store: PresenceStore,
    private readonly events: EventBus,
    private readonly logger: Logger,
  ) {}

  async attach(httpServer: HttpServer): Promise<void> {
    this.server = new WebSocketServer({ server: httpServer, path: '/ws/presence' });

    this.server.on('connection', (socket, request) => {
      const user = authenticateHandshake(request);
      if (!user) {
        socket.close(4401, 'Unauthorized');
        return;
      }

      this.state.set(socket, { userId: user.id, username: user.username, alive: true });
      void this.onConnect(socket, user.id);

      socket.on('pong', () => {
        const state = this.state.get(socket);
        if (state) state.alive = true;
      });

      socket.on('message', (raw) => {
        void this.handleClientEvent(socket, raw.toString());
      });

      socket.on('close', () => {
        void this.onDisconnect(socket, user.id);
      });

      socket.on('error', (error) => {
        this.logger.warn('Presence socket error', { userId: user.id, reason: String(error) });
      });
    });

    this.heartbeat = setInterval(() => {
      for (const socket of this.server?.clients ?? []) {
        const state = this.state.get(socket);
        if (!state) continue;
        if (!state.alive) {
          socket.terminate();
          continue;
        }
        state.alive = false;
        socket.ping();
        // A live socket is a live user; this is what keeps them out of the
        // stale window in Redis.
        void this.store.touch(state.userId);
      }
    }, HEARTBEAT_INTERVAL_MS);

    await this.events.subscribe(EVENTS.PRESENCE_CHANGED, (envelope) => {
      this.broadcast({ type: 'presence.changed', user: envelope.payload.user });
    });
    await this.events.subscribe(EVENTS.PRESENCE_TYPING, (envelope) => {
      const { channelId, userId, username } = envelope.payload;
      this.broadcast({ type: 'typing', channelId, userId, username }, userId);
    });
    await this.events.subscribe(EVENTS.PRESENCE_VOICE, (envelope) => {
      this.broadcast({ type: 'voice.changed', voice: envelope.payload.voice });
    });

    this.logger.info('Presence WebSocket gateway ready', { path: '/ws/presence' });
  }

  private async onConnect(socket: WebSocket, userId: string): Promise<void> {
    await this.store.touch(userId);

    // A client that just connected is in no voice channel. Anything left over
    // belongs to a session that died without saying goodbye - drop it, so a
    // crashed window does not haunt the roster.
    if (!this.hasOtherSocket(userId, socket)) await this.clearOtherVoiceChannels(userId, '');

    this.send(socket, { type: 'ready', userId });

    const [users, voice, own] = await Promise.all([
      this.store.onlineUsers(),
      this.store.allVoiceStates(),
      // The chosen status survives a restart, so the picker has to be told what
      // it currently is rather than assuming "online".
      this.store.statusOf(userId),
    ]);
    this.send(socket, { type: 'presence.sync', users, voice });
    this.send(socket, { type: 'status.self', status: own });

    await this.publishStatus(userId);
    this.logger.info('Presence connected', { userId });
  }

  /** Tells everyone else what this user looks like, invisible resolved away. */
  private async publishStatus(userId: string): Promise<void> {
    const status = await this.store.visibleStatusOf(userId);
    await this.events.publish(EVENTS.PRESENCE_CHANGED, { user: { userId, status } });
  }

  private async onDisconnect(socket: WebSocket, userId: string): Promise<void> {
    this.state.delete(socket);

    // Another window of the same user may still be connected to this instance.
    if (this.hasOtherSocket(userId, socket)) return;

    await this.store.goOffline(userId);
    for (const channelId of await this.store.voiceChannelsOf(userId)) {
      const voice = await this.store.leaveVoice(channelId, userId);
      await this.events.publish(EVENTS.PRESENCE_VOICE, { voice });
    }
    await this.events.publish(EVENTS.PRESENCE_CHANGED, {
      user: { userId, status: 'offline' },
    });
    this.logger.info('Presence disconnected', { userId });
  }

  private async clearOtherVoiceChannels(userId: string, keep: string): Promise<void> {
    for (const channelId of await this.store.voiceChannelsOf(userId)) {
      if (channelId === keep) continue;
      const voice = await this.store.leaveVoice(channelId, userId);
      await this.events.publish(EVENTS.PRESENCE_VOICE, { voice });
    }
  }

  /** Is this user connected through some socket other than `except`? */
  private hasOtherSocket(userId: string, except?: WebSocket): boolean {
    for (const socket of this.server?.clients ?? []) {
      if (socket === except) continue;
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (this.state.get(socket)?.userId === userId) return true;
    }
    return false;
  }

  private async handleClientEvent(socket: WebSocket, raw: string): Promise<void> {
    const state = this.state.get(socket);
    if (!state) return;

    let event: ClientPresenceEvent;
    try {
      event = JSON.parse(raw) as ClientPresenceEvent;
    } catch {
      this.send(socket, { type: 'error', code: 'BAD_PAYLOAD', message: 'Malformed JSON' });
      return;
    }

    switch (event.type) {
      case 'status.set': {
        if (!isActiveStatus(event.status)) {
          this.send(socket, {
            type: 'error',
            code: 'UNKNOWN_STATUS',
            message: 'Unsupported status',
          });
          return;
        }
        await this.store.setStatus(state.userId, event.status);
        // Every window of this user gets the real value; everyone else gets
        // what `publishStatus` resolves it to.
        this.sendToUser(state.userId, { type: 'status.self', status: event.status });
        await this.publishStatus(state.userId);
        return;
      }

      case 'ping':
        await this.store.touch(state.userId);
        this.send(socket, { type: 'pong' });
        return;

      case 'typing.start':
        if (!(await this.canAccessChannel(state.userId, event.channelId))) return;
        await this.events.publish(EVENTS.PRESENCE_TYPING, {
          channelId: event.channelId,
          userId: state.userId,
          username: state.username,
        });
        return;

      case 'voice.join': {
        if (!(await this.canAccessChannel(state.userId, event.channelId))) {
          this.send(socket, {
            type: 'error',
            code: 'CHANNEL_FORBIDDEN',
            message: 'Cannot join this voice channel',
          });
          return;
        }

        // A client is in at most one voice channel. Clearing the others here
        // keeps a roster honest even when a leave was lost - a kicked client,
        // a dropped socket, a crash.
        await this.clearOtherVoiceChannels(state.userId, event.channelId);

        const voice = await this.store.joinVoice(event.channelId, state.userId);
        await this.events.publish(EVENTS.PRESENCE_VOICE, { voice });
        return;
      }

      case 'voice.leave': {
        const voice = await this.store.leaveVoice(event.channelId, state.userId);
        await this.events.publish(EVENTS.PRESENCE_VOICE, { voice });
        return;
      }

      default:
        this.send(socket, { type: 'error', code: 'UNKNOWN_EVENT', message: 'Unsupported event' });
    }
  }

  /**
   * The same resolver chat- and call-service use. Typing and voice both need
   * only to see the channel, so `VIEW_CHANNEL` is the bar.
   */
  private async canAccessChannel(userId: string, channelId: string): Promise<boolean> {
    const access = await resolveChannelAccess(userId, channelId);
    return access !== null && access.permissions.includes(PERMISSIONS.VIEW_CHANNEL);
  }

  /** Every socket belonging to one user - a person may have several windows. */
  private sendToUser(userId: string, event: ServerPresenceEvent): void {
    for (const socket of this.server?.clients ?? []) {
      if (this.state.get(socket)?.userId === userId) this.send(socket, event);
    }
  }

  /** `exceptUserId` keeps a typing indicator from echoing to its own author. */
  private broadcast(event: ServerPresenceEvent, exceptUserId?: string): void {
    for (const socket of this.server?.clients ?? []) {
      if (exceptUserId && this.state.get(socket)?.userId === exceptUserId) continue;
      this.send(socket, event);
    }
  }

  private send(socket: WebSocket, event: ServerPresenceEvent): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.close();
  }
}
