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
import { CONTROL_MAX_PAYLOAD, authenticateHandshake } from '@nexora/websocket';
import type { ClientPresenceEvent, ServerPresenceEvent } from '@nexora/shared-types';
import { PresenceStore, isActiveStatus } from './presence.store';
import { audienceOfChannel, audienceOfUser } from './audience';

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
    this.server = new WebSocketServer({
      server: httpServer,
      path: '/ws/presence',
      maxPayload: CONTROL_MAX_PAYLOAD,
    });

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

    // Every one of these is scoped. A status change reaches the people who
    // share a server or a friendship with whoever changed; anything about a
    // channel reaches the people who can see that channel. Nothing goes to
    // every connected socket any more.
    await this.events.subscribe(EVENTS.PRESENCE_CHANGED, (envelope) => {
      const { user } = envelope.payload;
      void this.broadcastTo(audienceOfUser(user.userId), { type: 'presence.changed', user });
    });
    await this.events.subscribe(EVENTS.PRESENCE_TYPING, (envelope) => {
      const { channelId, userId, username } = envelope.payload;
      void this.broadcastTo(
        audienceOfChannel(channelId),
        { type: 'typing', channelId, userId, username },
        userId,
      );
    });
    await this.events.subscribe(EVENTS.PRESENCE_VOICE, (envelope) => {
      const { voice } = envelope.payload;
      void this.broadcastTo(audienceOfChannel(voice.channelId), { type: 'voice.changed', voice });
    });

    // The roster as call-service holds it, which is the only place it is really
    // known: it owns the signalling sockets, so it sees a join, a departure and
    // a crash alike. Written through to Redis so a client connecting later gets
    // the same answer in its sync.
    await this.events.subscribe(EVENTS.CALL_ROSTER, (envelope) => {
      const { voice } = envelope.payload;
      void this.store
        .replaceVoice(voice.channelId, voice.userIds)
        .then(() =>
          this.broadcastTo(audienceOfChannel(voice.channelId), { type: 'voice.changed', voice }),
        )
        .catch((error) => {
          this.logger.warn('Could not apply a call roster', {
            channelId: voice.channelId,
            reason: String(error),
          });
        });
    });

    this.logger.info('Presence WebSocket gateway ready', { path: '/ws/presence' });
  }

  private async onConnect(socket: WebSocket, userId: string): Promise<void> {
    await this.store.touch(userId);

    // Nothing is cleared here any more. A client connecting used to drop itself
    // from every voice channel on the assumption that a leftover was a dead
    // session - which was a fair guess while the roster was client-written, and
    // is now wrong: the roster belongs to call-service, and this connection
    // says nothing about whether that one is still up.
    this.send(socket, { type: 'ready', userId });

    const [users, voice, own, audience] = await Promise.all([
      this.store.onlineUsers(),
      this.store.allVoiceStates(),
      // The chosen status survives a restart, so the picker has to be told what
      // it currently is rather than assuming "online".
      this.store.statusOf(userId),
      audienceOfUser(userId),
    ]);

    // The same scoping the live events get. Without it the first message on a
    // socket is the whole deployment's online list, and every later one is
    // filtered - which is the sort of half-done that looks like it works.
    const visibleUsers = users.filter((user) => audience.has(user.userId));
    const rooms = await Promise.all(
      voice.map(async (room) => ({
        room,
        allowed: (await audienceOfChannel(room.channelId)).has(userId),
      })),
    );
    const visibleVoice = rooms.filter((entry) => entry.allowed).map((entry) => entry.room);

    this.send(socket, { type: 'presence.sync', users: visibleUsers, voice: visibleVoice });
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
    // The call roster is not touched: a presence socket closing is not evidence
    // that a call ended, and call-service publishes the departure itself the
    // moment its own socket goes - including when it goes by being terminated
    // for missing a heartbeat.
    await this.events.publish(EVENTS.PRESENCE_CHANGED, {
      user: { userId, status: 'offline' },
    });
    this.logger.info('Presence disconnected', { userId });
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

      // Both of these used to write the roster, which meant the roster was
      // whatever a client claimed: anybody could appear in a channel they had
      // never signalled into, and anybody who crashed stayed in one. The roster
      // now comes from `call-service`, which holds the signalling sockets and
      // therefore knows. These are kept because the permission answer is still
      // worth giving - a client that may not join should hear so from the
      // service it asked, not by watching a roster it never appears in.
      case 'voice.join': {
        if (!(await this.canAccessChannel(state.userId, event.channelId))) {
          this.send(socket, {
            type: 'error',
            code: 'CHANNEL_FORBIDDEN',
            message: 'Cannot join this voice channel',
          });
        }
        return;
      }

      case 'voice.leave':
        return;

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

  /**
   * Sends to the sockets whose user is in `audience`, and to nobody else.
   *
   * The audience is worked out once per event rather than once per socket,
   * which is what the symmetry in `audience.ts` buys: the set of people allowed
   * to hear about a user is the set that user is allowed to hear about.
   *
   * `exceptUserId` keeps a typing indicator from echoing to its own author.
   */
  private async broadcastTo(
    audience: Promise<Set<string>>,
    event: ServerPresenceEvent,
    exceptUserId?: string,
  ): Promise<void> {
    let allowed: Set<string>;
    try {
      allowed = await audience;
    } catch (error) {
      // A database that cannot answer must not turn into a broadcast to
      // everybody. Dropping the event is the safe direction: a dot is stale,
      // rather than shown to somebody with no right to it.
      this.logger.warn('Could not scope a presence event', { reason: String(error) });
      return;
    }

    for (const socket of this.server?.clients ?? []) {
      const state = this.state.get(socket);
      if (!state) continue;
      if (exceptUserId && state.userId === exceptUserId) continue;
      if (!allowed.has(state.userId)) continue;
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
