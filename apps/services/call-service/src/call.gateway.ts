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
import { resolveChannelAccess } from '@betweenus/database';
import { EVENTS, EventBus } from '@betweenus/events';
import { Logger } from '@betweenus/logger';
import { PERMISSIONS } from '@betweenus/permissions';
import { SIGNAL_MAX_PAYLOAD, authenticateHandshake } from '@betweenus/websocket';
import type {
  CallPeer,
  ClientCallEvent,
  ServerCallEvent,
} from '@betweenus/shared-types';
import { otherDevicesInCall } from './devices';

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

  /**
   * channelId -> the socket currently sharing its screen, if any.
   *
   * One share per call. Two of them is a stage with two pictures on it and no
   * way to say which one anybody means; every product that has tried it ended
   * up here. Held beside the roster rather than derived from the peer data
   * channels, because arbitration needs one answer and the mesh has no ordering
   * to produce one - the last claim wins, and "last" is only a thing the
   * gateway can decide.
   */
  private readonly sharing = new Map<string, WebSocket>();

  constructor(
    private readonly logger: Logger,
    private readonly events: EventBus,
  ) {}

  /**
   * Says who is in a call, for anybody drawing it.
   *
   * The roster used to be whatever each client told presence-service it was
   * doing, which meant a client could put itself in a channel it had never
   * signalled into, and a client that crashed stayed in one until its presence
   * socket noticed. This gateway is the only thing that knows the truth - it
   * holds the sockets - so it is the thing that says it, on every change,
   * including the changes nobody announced.
   */
  private announceRoster(channelId: string): void {
    const userIds = [
      ...new Set(
        [...(this.calls.get(channelId) ?? [])].flatMap((member) => {
          const peer = this.state.get(member);
          return peer ? [peer.userId] : [];
        }),
      ),
    ];

    // One account with two windows is one person in the room, which is why this
    // is a set: the peer list is per socket and the roster is per person.
    void this.events
      .publish(EVENTS.CALL_ROSTER, { voice: { channelId, userIds } })
      .catch((error) => {
        this.logger.warn('Could not publish a call roster', {
          channelId,
          reason: String(error),
        });
      });
  }

  attach(httpServer: HttpServer): void {
    this.server = new WebSocketServer({
      server: httpServer,
      path: '/ws/call',
      maxPayload: SIGNAL_MAX_PAYLOAD,
    });

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

      // Said again, unchanged, on every beat.
      //
      // A roster is a replacement for one channel, so a channel that stops
      // being mentioned keeps whatever was last said about it - and if this
      // process restarted mid-call, what was last said about it was true of a
      // process that no longer exists. That is the ghost in a voice channel's
      // member list: somebody who left hours ago, listed forever, because the
      // only thing that could correct it never spoke about that channel again.
      //
      // Re-announcing turns the roster into something with a heartbeat, which
      // is what presence-service ages out. Nobody in this call means nothing is
      // published for it, which is exactly what "empty" has to look like.
      for (const channelId of this.calls.keys()) this.announceRoster(channelId);
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

      case 'screen.claim':
        this.claimScreen(socket, state);
        return;

      case 'screen.release':
        this.releaseScreen(socket, state);
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

    // One call per *account*, across every device it is signed in on. A peer id
    // is still per socket - two windows are still two ends of two connections -
    // but only one of them may be in a call at a time, so joining on the laptop
    // takes the call off the desktop rather than putting the same person in the
    // room twice, talking over themselves through two microphones.
    //
    // The old device is told why before it is dropped: `superseded` is what
    // lets it say "this call moved" instead of "the connection was lost". Its
    // socket stays open, so it can join again - which is what moving the call
    // back looks like from the other end.
    const otherDevices = otherDevicesInCall(
      this.calls.values(),
      (member) => this.state.get(member)?.userId,
      state.userId,
      socket,
    );
    for (const other of otherDevices) {
      this.send(other, { type: 'superseded', channelId });
      this.depart(other, true);
      this.logger.info('Call moved to another device', { userId: state.userId, channelId });
    }

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

    this.announceRoster(channelId);
    this.logger.info('Peer joined a call', {
      userId: state.userId,
      channelId,
      peers: members.size,
    });
  }

  /**
   * Hands the screen to whoever asked for it last.
   *
   * The previous holder is told the same thing everybody else is - who holds it
   * now - and stops on its own. It is not sent a private "stop": every client
   * needs the new holder anyway, and one message that says the whole truth
   * cannot be applied by half the room and missed by the rest.
   */
  private claimScreen(socket: WebSocket, state: SocketState): void {
    const channelId = state.channelId;
    if (!channelId) return;
    if (this.sharing.get(channelId) === socket) return;

    this.sharing.set(channelId, socket);
    this.announceScreen(channelId);
    this.logger.info('Screen share taken over', { userId: state.userId, channelId });
  }

  /** Gives it up, if this socket is the one holding it. */
  private releaseScreen(socket: WebSocket, state: SocketState): void {
    const channelId = state.channelId;
    if (!channelId) return;
    // Only the holder may release: a late "I stopped" from whoever was replaced
    // would otherwise take the screen away from the person who just took it.
    if (this.sharing.get(channelId) !== socket) return;

    this.sharing.delete(channelId);
    this.announceScreen(channelId);
  }

  private announceScreen(channelId: string): void {
    const holder = this.sharing.get(channelId);
    const peer = holder ? this.state.get(holder) : undefined;
    this.broadcast(channelId, {
      type: 'screen.holder',
      peerId: peer?.peerId ?? null,
      userId: peer?.userId ?? null,
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

    // Somebody who left is not still sharing. Without this the screen stays
    // claimed by a socket that has gone, and the next person to press the
    // button is the only one who ever finds out.
    if (this.sharing.get(channelId) === socket) {
      this.sharing.delete(channelId);
      this.announceScreen(channelId);
    }

    // Everyone still in the call has a peer connection to this peer that will
    // never produce another frame. Saying so is what closes it; waiting for ICE
    // to time out is thirty seconds of a frozen tile.
    this.broadcast(channelId, { type: 'peer.left', peerId: state.peerId });
    this.announceRoster(channelId);
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
