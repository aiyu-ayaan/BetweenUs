/**
 * `/ws/chat` realtime gateway.
 *
 * Sockets subscribe to channels they may read; delivery is driven by the Redis
 * `message.created` event, so every chat-service instance broadcasts to its own
 * sockets and horizontal scaling needs no sticky sessions.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { prisma } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { PERMISSIONS } from '@betweenus/permissions';
import {
  CONTROL_MAX_PAYLOAD,
  RoomRegistry,
  authenticateHandshake,
  channelRoom,
  serverRoom,
  userRoom,
} from '@betweenus/websocket';
import { Logger } from '@betweenus/logger';
import type { ClientChatEvent, ServerChatEvent, UserSummary } from '@betweenus/shared-types';
import { MessagesService } from '../modules/messages/messages.service';

const HEARTBEAT_INTERVAL_MS = 30_000;

interface SocketState {
  userId: string;
  username: string;
  alive: boolean;
}

@Injectable()
export class ChatGateway implements OnModuleDestroy {
  private server: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly rooms = new RoomRegistry<WebSocket>();
  private readonly state = new WeakMap<WebSocket, SocketState>();

  constructor(
    private readonly messages: MessagesService,
    private readonly events: EventBus,
    private readonly logger: Logger,
  ) {}

  /** Called from main.ts once Nest owns a listening HTTP server. */
  async attach(httpServer: HttpServer): Promise<void> {
    this.server = new WebSocketServer({
      server: httpServer,
      path: '/ws/chat',
      maxPayload: CONTROL_MAX_PAYLOAD,
    });

    this.server.on('connection', (socket, request) => {
      const user = authenticateHandshake(request);
      if (!user) {
        // Never downgrade to anonymous: close with a policy-violation code.
        socket.close(4401, 'Unauthorized');
        return;
      }

      this.state.set(socket, { userId: user.id, username: user.username, alive: true });
      // Everything addressed at a person rather than a place - a friend
      // request, an acceptance, being added to a server - is delivered here.
      this.rooms.join(userRoom(user.id), socket);
      this.send(socket, { type: 'ready', userId: user.id });
      this.logger.info('WebSocket connected', { userId: user.id });

      socket.on('pong', () => {
        const state = this.state.get(socket);
        if (state) state.alive = true;
      });

      socket.on('message', (raw) => {
        void this.handleClientEvent(socket, raw.toString());
      });

      socket.on('close', () => {
        this.rooms.leaveAll(socket);
        this.state.delete(socket);
        this.logger.info('WebSocket disconnected', { userId: user.id });
      });

      socket.on('error', (error) => {
        this.logger.warn('WebSocket error', { userId: user.id, reason: String(error) });
      });
    });

    // Drop sockets that stopped answering pings instead of leaking them.
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
      }
    }, HEARTBEAT_INTERVAL_MS);

    await this.events.subscribe(EVENTS.MESSAGE_CREATED, (envelope) => {
      const { message } = envelope.payload;
      this.broadcast(channelRoom(message.channelId), { type: 'message.created', message });
    });

    // An edit, a pin, a reaction and a deletion all reach the client as the
    // same event carrying the whole message - a deleted one is a tombstone with
    // `deletedAt` set, which is what the client has to draw.
    for (const event of [EVENTS.MESSAGE_UPDATED, EVENTS.MESSAGE_DELETED] as const) {
      await this.events.subscribe(event, (envelope) => {
        const { message } = envelope.payload;
        this.broadcast(channelRoom(message.channelId), { type: 'message.updated', message });
      });
    }

    // A read marker moved. Everyone subscribed to the channel is told, because
    // a read receipt is only useful to the person whose message was read - and
    // the marker is what every client derives "who has seen this" from.
    await this.events.subscribe(EVENTS.CHANNEL_READ, (envelope) => {
      const { channelId, userId, at } = envelope.payload;
      this.broadcast(channelRoom(channelId), { type: 'channel.read', channelId, userId, at });
    });

    // Somebody cleared their own history. It goes to that account's room and
    // nowhere else: every other participant's copy is exactly what it was, and
    // the only sockets that have anything to do are the ones holding this
    // account's own decrypted cache.
    await this.events.subscribe(EVENTS.CHATS_CLEARED, (envelope) => {
      const { userId, clearedAt, channelId } = envelope.payload;
      this.broadcast(userRoom(userId), { type: 'chats.cleared', clearedAt, channelId });
    });

    await this.events.subscribe(EVENTS.FRIEND_CHANGED, (envelope) => {
      for (const userId of envelope.payload.userIds) {
        this.broadcast(userRoom(userId), { type: 'friends.changed' });
      }
    });

    // Every membership change reaches the same client event: the server's
    // watchers refresh their member list, and the person who joined, was
    // removed or had their permissions changed refreshes their own list of
    // servers - which is where the permissions their UI reads come from.
    for (const event of [
      EVENTS.SERVER_MEMBER_ADDED,
      EVENTS.SERVER_MEMBER_REMOVED,
      EVENTS.SERVER_MEMBER_UPDATED,
    ] as const) {
      await this.events.subscribe(event, (envelope) => {
        const { serverId, userId } = envelope.payload;
        this.deliver([serverRoom(serverId), userRoom(userId)], {
          type: 'server.members.changed',
          serverId,
        });
      });
    }

    // A renamed server, or one with a new picture. Everyone watching it is
    // holding the old one in a sidebar.
    await this.events.subscribe(EVENTS.SERVER_UPDATED, (envelope) => {
      const { serverId, name, iconUrl } = envelope.payload;
      this.broadcast(serverRoom(serverId), { type: 'server.updated', serverId, name, iconUrl });
    });

    // A changed profile has to reach everyone who draws it, which is a wider
    // set than any one room: the members of every server this account is in,
    // everyone it is friends with, and its own other devices.
    await this.events.subscribe(EVENTS.USER_UPDATED, (envelope) => {
      void this.broadcastProfile(envelope.payload.user);
    });

    this.logger.info('Chat WebSocket gateway ready', { path: '/ws/chat' });
  }

  private async handleClientEvent(socket: WebSocket, raw: string): Promise<void> {
    const state = this.state.get(socket);
    if (!state) return;

    let event: ClientChatEvent;
    try {
      event = JSON.parse(raw) as ClientChatEvent;
    } catch {
      this.send(socket, { type: 'error', code: 'BAD_PAYLOAD', message: 'Malformed JSON' });
      return;
    }

    switch (event.type) {
      case 'ping':
        this.send(socket, { type: 'pong' });
        return;

      case 'channel.subscribe':
        try {
          // Re-check on every subscribe: permissions can change mid-session.
          await this.messages.requireChannelAccess(
            state.userId,
            event.channelId,
            PERMISSIONS.VIEW_CHANNEL,
          );
        } catch {
          this.send(socket, {
            type: 'error',
            code: 'CHANNEL_FORBIDDEN',
            message: 'Cannot subscribe to this channel',
          });
          return;
        }
        this.rooms.join(channelRoom(event.channelId), socket);
        return;

      case 'channel.unsubscribe':
        this.rooms.leave(channelRoom(event.channelId), socket);
        return;

      case 'server.subscribe': {
        // Membership, not permission: anyone in the server may know when its
        // member list changes, which is what the client re-reads.
        const membership = await prisma.serverMember.findUnique({
          where: { serverId_userId: { serverId: event.serverId, userId: state.userId } },
          select: { id: true },
        });
        if (!membership) {
          this.send(socket, {
            type: 'error',
            code: 'SERVER_FORBIDDEN',
            message: 'Cannot subscribe to this server',
          });
          return;
        }
        this.rooms.join(serverRoom(event.serverId), socket);
        return;
      }

      case 'server.unsubscribe':
        this.rooms.leave(serverRoom(event.serverId), socket);
        return;

      default:
        this.send(socket, { type: 'error', code: 'UNKNOWN_EVENT', message: 'Unsupported event' });
    }
  }

  /**
   * Who can see a profile: every server they share, plus every friendship.
   *
   * Friendships rather than DM channels because a direct message already
   * requires an accepted friendship - so the friend list is the same set, and
   * it is one query rather than two.
   */
  private async broadcastProfile(user: UserSummary): Promise<void> {
    const [memberships, friendships] = await Promise.all([
      prisma.serverMember.findMany({ where: { userId: user.id }, select: { serverId: true } }),
      prisma.friendship.findMany({
        where: { status: 'ACCEPTED', OR: [{ userAId: user.id }, { userBId: user.id }] },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const rooms = [
      userRoom(user.id),
      ...memberships.map((row) => serverRoom(row.serverId)),
      ...friendships.map((row) => userRoom(row.userAId === user.id ? row.userBId : row.userAId)),
    ];
    this.deliver(rooms, { type: 'user.updated', user });
  }

  private broadcast(room: string, event: ServerChatEvent): void {
    for (const socket of this.rooms.members(room)) this.send(socket, event);
  }

  /** Several rooms, one delivery each - a socket in two of them is told once. */
  private deliver(rooms: string[], event: ServerChatEvent): void {
    const seen = new Set<WebSocket>();
    for (const room of rooms) {
      for (const socket of this.rooms.members(room)) seen.add(socket);
    }
    for (const socket of seen) this.send(socket, event);
  }

  private send(socket: WebSocket, event: ServerChatEvent): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.close();
  }
}
