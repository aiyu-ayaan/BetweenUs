/**
 * `/ws/call`: the switchboard two clients use to find each other.
 *
 * This gateway introduces peers and then gets out of the way. It knows who is
 * in which channel's call, it forwards an offer, an answer or an ICE candidate
 * from one peer to another, and that is the whole of it. It never sees a frame
 * of media, cannot decode one, and is not in the path where one travels - the
 * peer connections it helps set up run directly between the two machines.
 *
 * That is also why this works through a Cloudflare Tunnel when an SFU did not.
 * Everything crossing this gateway is small, text and reliable, which is what a
 * tunnel carries; the large, continuous, loss-tolerant half never goes near it.
 *
 * Two things it deliberately does not do:
 *
 * - It does not read a signal. `data` is forwarded verbatim, so the SDP a peer
 *   receives is the SDP the other peer wrote. Anything else would put this
 *   service in a position to rewrite a DTLS fingerprint, which is exactly what
 *   the fingerprint signature exists to make useless.
 * - It does not trust `from`. The sender's peer id comes from the socket the
 *   message arrived on, never from the message, so a client cannot sign its
 *   traffic as somebody else.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { resolveChannelAccess } from '@nexora/database';
import { Logger } from '@nexora/logger';
import { PERMISSIONS } from '@nexora/permissions';
import { authenticateHandshake } from '@nexora/websocket';
import type {
  CallPeer,
  ClientCallEvent,
  ServerCallEvent,
} from '@nexora/shared-types';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * The ceiling the mesh imposes, enforced where it can be said clearly rather
 * than discovered as a call that degrades for everyone at once. Each
 * participant uploads one copy of its media per other participant, so the cost
 * of the tenth joiner is paid by the nine already talking.
 *
 * ponytail: a flat number for every channel. Per-channel limits are the fix if
 * a deployment ever wants voice-only rooms to go higher than video ones.
 */
const MAX_PEERS_PER_CALL = 8;

interface SocketState extends CallPeer {
  channelId: string | null;
  alive: boolean;
}

@Injectable()
export class CallGateway implements OnModuleDestroy {
  private server: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly state = new WeakMap<WebSocket, SocketState>();
  /**
   * channelId -> the sockets in that call.
   *
   * ponytail: in process, so this holds for a single call-service replica -
   * which is what the compose deployment runs. Two replicas would each see half
   * a call and peers would never be introduced across them. The upgrade path is
   * the one presence-service already uses: Redis Pub/Sub, with the roster in
   * Redis and signals published to a channel keyed by peer id.
   */
  private readonly calls = new Map<string, Set<WebSocket>>();

  constructor(private readonly logger: Logger) {}

  attach(httpServer: HttpServer): void {
    this.server = new WebSocketServer({ server: httpServer, path: '/ws/call' });

    this.server.on('connection', (socket, request) => {
      const user = authenticateHandshake(request);
      if (!user) {
        socket.close(4401, 'Unauthorized');
        return;
      }

      // A peer id per socket rather than per user: one account with two windows
      // open is two ends of two different peer connections, and collapsing them
      // onto one identity is what made the old design disconnect the first
      // window when the second joined.
      const state: SocketState = {
        peerId: randomUUID(),
        userId: user.id,
        username: user.username,
        channelId: null,
        alive: true,
      };
      this.state.set(socket, state);
      this.send(socket, { type: 'ready', peerId: state.peerId });

      socket.on('pong', () => {
        const current = this.state.get(socket);
        if (current) current.alive = true;
      });

      socket.on('message', (raw) => {
        void this.handle(socket, raw.toString());
      });

      socket.on('close', () => this.depart(socket));

      socket.on('error', (error) => {
        this.logger.warn('Call socket error', { userId: user.id, reason: String(error) });
      });
    });

    this.heartbeat = setInterval(() => {
      for (const socket of this.server?.clients ?? []) {
        const state = this.state.get(socket);
        if (!state) continue;
        if (!state.alive) {
          // Terminating fires 'close', which is what takes them off the roster
          // and tells the others to tear their peer connection down.
          socket.terminate();
          continue;
        }
        state.alive = false;
        socket.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.logger.info('Call signalling gateway ready', { path: '/ws/call' });
  }

  private async handle(socket: WebSocket, raw: string): Promise<void> {
    const state = this.state.get(socket);
    if (!state) return;

    let event: ClientCallEvent;
    try {
      event = JSON.parse(raw) as ClientCallEvent;
    } catch {
      this.send(socket, { type: 'error', code: 'BAD_PAYLOAD', message: 'Malformed JSON' });
      return;
    }

    switch (event.type) {
      case 'join':
        await this.join(socket, state, event.channelId);
        return;

      case 'leave':
        this.depart(socket);
        return;

      case 'signal':
        this.relay(state, event.to, event.data);
        return;

      case 'ping':
        this.send(socket, { type: 'pong' });
        return;

      default:
        this.send(socket, { type: 'error', code: 'UNKNOWN_EVENT', message: 'Unsupported event' });
    }
  }

  private async join(socket: WebSocket, state: SocketState, channelId: string): Promise<void> {
    const access = await resolveChannelAccess(state.userId, channelId);
    if (!access) {
      // 404-shaped, for the same reason the REST path is: a non-member must not
      // learn the channel exists.
      this.send(socket, { type: 'error', code: 'CHANNEL_NOT_FOUND', message: 'Channel not found' });
      return;
    }
    if (!access.permissions.includes(PERMISSIONS.START_CALL)) {
      this.send(socket, {
        type: 'error',
        code: 'MISSING_PERMISSION',
        message: `Missing permission ${PERMISSIONS.START_CALL}`,
      });
      return;
    }

    // One call per socket. Leaving the old one first keeps a roster honest when
    // a client switches channels without saying goodbye to the first.
    if (state.channelId && state.channelId !== channelId) this.depart(socket, true);

    const members = this.calls.get(channelId) ?? new Set<WebSocket>();
    if (!members.has(socket) && members.size >= MAX_PEERS_PER_CALL) {
      this.send(socket, {
        type: 'error',
        code: 'CALL_FULL',
        message:
          `This call already has ${MAX_PEERS_PER_CALL} people in it. Media goes directly between ` +
          'participants, so every extra person costs everyone already talking another upload.',
      });
      return;
    }

    // The roster is taken before this socket is added, so a joiner is not told
    // about itself and does not try to connect to its own peer id.
    const peers: CallPeer[] = [...members].flatMap((member) => {
      const peer = this.state.get(member);
      return peer ? [{ peerId: peer.peerId, userId: peer.userId, username: peer.username }] : [];
    });

    members.add(socket);
    this.calls.set(channelId, members);
    state.channelId = channelId;

    this.send(socket, { type: 'joined', channelId, peers });
    this.broadcast(
      channelId,
      {
        type: 'peer.joined',
        peer: { peerId: state.peerId, userId: state.userId, username: state.username },
      },
      socket,
    );

    this.logger.info('Peer joined a call', {
      userId: state.userId,
      channelId,
      peers: members.size,
    });
  }

  /**
   * Forwards one signal to one peer in the same call.
   *
   * Same-call is the check that matters: without it, a peer id learned anywhere
   * would let a client offer a connection into a channel it cannot see.
   */
  private relay(from: SocketState, to: string, data: unknown): void {
    if (!from.channelId) return;

    for (const member of this.calls.get(from.channelId) ?? []) {
      const peer = this.state.get(member);
      if (peer?.peerId !== to) continue;
      this.send(member, {
        type: 'signal',
        from: from.peerId,
        data: data as never,
      });
      return;
    }
  }

  /**
   * Takes a socket off its call and tells the others.
   *
   * `keepOpen` is the channel-switch case: the socket lives on, so its state is
   * kept and only its membership is dropped.
   */
  private depart(socket: WebSocket, keepOpen = false): void {
    const state = this.state.get(socket);
    if (!state) return;

    const { channelId } = state;
    state.channelId = null;
    if (!keepOpen) this.state.delete(socket);
    if (!channelId) return;

    const members = this.calls.get(channelId);
    if (!members) return;
    members.delete(socket);
    if (members.size === 0) this.calls.delete(channelId);

    // Everyone still in the call has a peer connection to this peer that will
    // never produce another frame. Saying so is what closes it; waiting for ICE
    // to time out is thirty seconds of a frozen tile.
    this.broadcast(channelId, { type: 'peer.left', peerId: state.peerId });
    this.logger.info('Peer left a call', {
      userId: state.userId,
      channelId,
      peers: members.size,
    });
  }

  private broadcast(channelId: string, event: ServerCallEvent, except?: WebSocket): void {
    for (const member of this.calls.get(channelId) ?? []) {
      if (member === except) continue;
      this.send(member, event);
    }
  }

  private send(socket: WebSocket, event: ServerCallEvent): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.close();
  }
}
