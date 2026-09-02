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
import {
  SIGNAL_MAX_PAYLOAD,
  authenticateHandshake,
  dropRevokedSockets,
} from '@betweenus/websocket';
import type {
  CallPeer,
  ClientCallEvent,
  GameSession,
  ListenSession,
  ServerCallEvent,
} from '@betweenus/shared-types';
import { apply as applyGame, type GameAction } from './game-session';
import { apply as applyListen, type ListenAction } from './listen-session';
import { otherDevicesInCall } from './devices';
import { deviceOf, peerIdFor } from './peer-identity';
import { CallsService, type ReportedUsage } from './modules/calls/calls.service';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * How long a peer's seat is held after its socket closes, before the others are
 * told it has gone.
 *
 * A phone loses its signalling socket constantly - a lift, a train, a screen
 * that went off, a doze the system decided on - and it comes back within a
 * second or two. Announcing `peer.left` the instant the socket drops made every
 * one of those a full mesh teardown: everybody closed their peer connection to
 * it, it rejoined, and everybody built a new one and renegotiated from nothing.
 * That is the call that connects, drops and connects again in a loop, and none
 * of it was ever about the media path.
 *
 * Inside this window a peer that comes back with the same id is not announced
 * as leaving or as arriving. Nobody's connection is touched, and ICE - which
 * has its own restart and its own deadline in every client - is left to do the
 * one job that is actually its own: find the media a path again.
 *
 * Shorter than the heartbeat, so a seat cannot outlive the roster that would
 * have corrected it, and much shorter than any client's signalling deadline.
 */
const REJOIN_GRACE_MS = 15_000;

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

/**
 * How many numbers a move may carry beyond its index. A carrom shot needs
 * three; nothing needs more, and an array a client chose the length of is an
 * array a client chose the length of.
 */
const MAX_MOVE_PARAMS = 4;

/**
 * The numbers that complete a move, trimmed to something the rules can be
 * handed safely.
 *
 * This is the one field a client fills in with real numbers rather than an
 * index, and it goes straight into a physics simulation - so a NaN, an infinity
 * or an array of ten thousand entries would each be a shot that never comes to
 * rest, in a loop this process is running. Anything unusable becomes
 * `undefined`, which every rules module reads as "no aim given" and refuses.
 */
function sanitiseParams(params: unknown): number[] | undefined {
  if (!Array.isArray(params)) return undefined;
  if (params.length === 0 || params.length > MAX_MOVE_PARAMS) return undefined;
  const numbers = params.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (numbers.length !== params.length) return undefined;
  return numbers;
}

interface SocketState extends CallPeer {
  channelId: string | null;
  alive: boolean;
  /** `iat` of the token that opened this socket. See `dropRevokedSockets`. */
  issuedAt: number;
  /** The open row in this person's call log, while they are in a call. */
  sessionId: string | null;
  /** Everybody else who has been in the call since this socket joined it. */
  metUserIds: Set<string>;
  /** What the client says it moved, reported on the way out. See `leave`. */
  usage: ReportedUsage;
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

  /**
   * channelId -> the Listen Together session in that call, if there is one.
   *
   * Beside the roster for the same reason `sharing` is: two people pressing
   * pause at the same moment need one answer, and a mesh has no ordering to
   * produce one. This gateway holds the sockets, so it is the only thing that
   * can say which press happened second.
   *
   * The music itself is nowhere near here. Each client plays the track from the
   * provider over its own connection; what crosses this gateway is a queue and
   * a position - signalling, exactly like an SDP, and for exactly the same
   * reason it works through a tunnel. Sharing a browser tab with the sound on
   * would have made it media, one upload per listener, re-encoded through a
   * codec meant for speech.
   */
  private readonly listening = new Map<string, ListenSession>();

  /**
   * channelId -> the game being played in that call, if there is one.
   *
   * Here for the third time and for the same reason as `sharing` and
   * `listening`: two people clicking the same square at the same moment need
   * one answer, and a mesh has no ordering to produce one. This gateway holds
   * the sockets, so it is the only thing that can say which click was second -
   * and it is also the referee, because a board a client could set is a board a
   * client could set to won.
   *
   * Nothing here is persisted. The game lives beside the roster and dies with
   * the call, which is what it is: three rounds of Connect Four while two
   * people waited for a build has no meaning tomorrow.
   */
  private readonly playing = new Map<string, GameSession>();

  /**
   * `channelId\u0000peerId` -> the "they have gone" nobody has been told yet.
   *
   * A closed socket takes its seat off the roster straight away - a ghost in
   * the peer list is somebody a new joiner tries to call and never reaches -
   * but the *announcement* waits out [REJOIN_GRACE_MS]. A peer that comes back
   * with the same id cancels it, and the rest of the call never learns anything
   * happened.
   */
  private readonly departing = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly logger: Logger,
    private readonly events: EventBus,
    /** Where a call's log entry is opened and closed - `this.calls` is the roster. */
    private readonly history: CallsService,
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

  /**
   * Every socket this instance holds for one account.
   *
   * Scanned rather than looked up in a room: the four gateways keep different
   * bookkeeping and `clients` is the one thing all of them have. A revocation is
   * rare, and a scan of one instance's sockets is nothing.
   */
  private socketsOf(userId: string): WebSocket[] {
    return [...(this.server?.clients ?? [])].filter(
      (socket) => this.state.get(socket)?.userId === userId,
    );
  }

  attach(httpServer: HttpServer): void {
    // The socket this matters most for, and the reason the fix is a revocation
    // event and not a shorter socket lifetime: closing a call socket ends a
    // call, so it must happen when somebody says so and never on a timer.
    // `close` runs the same teardown a dropped connection does - the roster is
    // re-announced and the call log row is closed - so the other people in the
    // call see them leave rather than freeze.
    void dropRevokedSockets(
      this.events,
      (userId) => this.socketsOf(userId),
      (socket) => this.state.get(socket)?.issuedAt,
      (socket, code, reason) => socket.close(code, reason),
      (userId, count, reason) => this.logger.info('Sockets revoked', { userId, count, reason }),
    );

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

      // A peer id per device, not per socket and not per user. Two windows on
      // one account are still two peers - that is what stops the second one
      // disconnecting the first - but a reconnect from the same window is the
      // same peer, which is what stops a tunnel from rebuilding the mesh. See
      // `peerIdFor`.
      const state: SocketState = {
        peerId: peerIdFor(user.id, deviceOf(request.url)),
        userId: user.id,
        username: user.username,
        channelId: null,
        alive: true,
        issuedAt: user.issuedAt,
        sessionId: null,
        metUserIds: new Set<string>(),
        usage: noUsage(),
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

      // A socket that simply closed is a network, not a decision - and on a
      // phone it is a network that comes back in a second. The seat is held.
      socket.on('close', () => this.depart(socket, { hold: true }));

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
        // The only number in the log the server cannot take for itself: media
        // is peer to peer, so the client's own counters are the only counters.
        // It is clamped where it is written - see `usage.ts`.
        state.usage = {
          bytes: typeof event.bytes === 'number' ? event.bytes : 0,
          bytesSent: typeof event.bytesSent === 'number' ? event.bytesSent : 0,
          bytesReceived: typeof event.bytesReceived === 'number' ? event.bytesReceived : 0,
          links: event.links,
        };
        // Somebody pressed the button. No grace: they are not coming back, and
        // holding their seat is fifteen seconds of a frozen tile for everybody.
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
        // The gateway's clock rides along, because a shared position is
        // meaningless without one: two machines disagree about what time it is
        // by whatever their clocks last drifted to, and this is the reference
        // every client measures its own offset against.
        this.send(socket, { type: 'pong', serverMs: Date.now() });
        return;

      case 'listen.add':
        this.listen(state, {
          kind: 'add',
          playNow: event.playNow === true,
          track: {
            // Minted here, not by the client: it is the identity two clients
            // agree a queue entry has, and a client that chose its own could
            // collide with one already in the queue - which is a `remove` that
            // takes away somebody else's track.
            id: randomUUID(),
            provider: event.provider,
            ref: event.ref,
            title: typeof event.title === 'string' ? event.title : '',
            durationMs: 0,
            addedByUserId: state.userId,
            addedByUsername: state.username,
          },
        });
        return;

      case 'listen.remove':
        this.listen(state, { kind: 'remove', trackId: event.trackId });
        return;

      case 'listen.play':
        this.listen(state, { kind: 'play', index: event.index });
        return;

      case 'listen.pause':
        this.listen(state, { kind: 'pause', positionMs: event.positionMs });
        return;

      case 'listen.seek':
        this.listen(state, { kind: 'seek', positionMs: event.positionMs });
        return;

      case 'listen.skip':
        this.listen(state, { kind: 'skip', delta: event.delta });
        return;

      case 'listen.stop':
        this.listen(state, { kind: 'stop' });
        return;

      case 'listen.ended':
        this.listen(state, { kind: 'ended', trackId: event.trackId });
        return;

      case 'listen.meta':
        this.listen(state, {
          kind: 'meta',
          trackId: event.trackId,
          title: event.title,
          durationMs: event.durationMs,
        });
        return;

      case 'game.open':
        this.game(state, { kind: 'open', gameId: event.gameId });
        return;

      case 'game.sit':
        this.game(state, { kind: 'sit', seat: event.seat });
        return;

      case 'game.move':
        this.game(state, {
          kind: 'move',
          move: event.move,
          // Bounded and cleaned here rather than trusted: this is the one field
          // a client fills in with real numbers, and it goes straight into a
          // physics simulation. A NaN, an array of ten thousand, or an infinity
          // would each be a shot that never comes to rest.
          params: sanitiseParams(event.params),
        });
        return;

      case 'game.rematch':
        this.game(state, { kind: 'rematch' });
        return;

      case 'game.close':
        this.game(state, { kind: 'close' });
        return;

      default:
        this.send(socket, { type: 'error', code: 'UNKNOWN_EVENT', message: 'Unsupported event' });
    }
  }

  private holdKey(channelId: string, peerId: string): string {
    return `${channelId}\u0000${peerId}`;
  }

  /**
   * Whether this join is the same peer coming back inside its grace window.
   *
   * True means the others still hold a live peer connection to it and must not
   * be told about any of this: no `peer.left` (cancelled here) and no
   * `peer.joined` (suppressed by the caller).
   */
  private resumeHeldSeat(channelId: string, peerId: string): boolean {
    const key = this.holdKey(channelId, peerId);
    const timer = this.departing.get(key);
    if (!timer) return false;
    clearTimeout(timer);
    this.departing.delete(key);
    return true;
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
    if (state.channelId && state.channelId !== channelId) this.depart(socket, { keepOpen: true });

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
      // The same peer id is this device reconnecting, not another one: an old
      // socket the far end has not finished closing while its replacement is
      // already joining. It is not superseded, it is replaced - so it goes
      // quietly, holding its seat for the join happening two lines below. Told
      // otherwise, a phone with a slow-closing socket would announce its own
      // departure and arrival on every reconnect, which is the rebuild this
      // whole change exists to stop.
      const replaced = this.state.get(other)?.peerId === state.peerId;
      if (replaced) {
        this.depart(other, { keepOpen: true, hold: true });
        continue;
      }
      this.send(other, { type: 'superseded', channelId });
      this.depart(other, { keepOpen: true });
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

    // Who they are in the call with, recorded both ways: this join meets
    // everybody already here, and everybody already here has now met them. A
    // log entry is "who was in it while I was", so somebody who leaves before
    // the end still belongs in it.
    for (const member of members) {
      const peer = this.state.get(member);
      if (!peer || peer.userId === state.userId) continue;
      state.metUserIds.add(peer.userId);
      peer.metUserIds.add(state.userId);
    }

    // Before the seat is taken back, because taking it back is what decides
    // whether anybody else is told about it.
    const resumed = this.resumeHeldSeat(channelId, state.peerId);

    members.add(socket);
    this.calls.set(channelId, members);
    state.channelId = channelId;

    this.send(socket, { type: 'joined', channelId, peers });
    // A peer coming back inside its grace window never left as far as anybody
    // else is concerned. Announcing it would be an arrival for a connection
    // every one of them already holds - and the tear-down and rebuild that
    // follows is the whole of a call that connects and drops in a loop.
    if (!resumed) {
      this.broadcast(
        channelId,
        {
          type: 'peer.joined',
          peer: { peerId: state.peerId, userId: state.userId, username: state.username },
        },
        socket,
      );
    }

    this.announceRoster(channelId);

    // Whatever is already playing, to the newcomer only. They get the position
    // and the instant it was true, so their player opens partway through the
    // track everybody else is partway through rather than at the beginning.
    const listening = this.listening.get(channelId);
    if (listening) this.send(socket, { type: 'listen.state', session: listening });

    // And whatever is on the table, to the newcomer only. They arrive at the
    // board as it stands rather than at an empty one, which is the difference
    // between joining a game and being told there is one.
    const playing = this.playing.get(channelId);
    if (playing) this.send(socket, { type: 'game.state', session: playing });

    // The log row is opened here because here is where the join is known to
    // have been allowed. If they left while this was being written - a socket
    // that closes mid-await - it is closed straight away rather than left open
    // forever, which is what an unattended `endedAt` of null means.
    state.sessionId = await this.history.startSession(state.userId, channelId);
    if (state.sessionId && state.channelId !== channelId) {
      void this.history.endSession(state.sessionId, [...state.metUserIds], state.usage);
      state.sessionId = null;
    }

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

  /**
   * Runs one Listen Together action and tells the call what came of it.
   *
   * Membership is the only permission asked for, and deliberately: everybody in
   * the call can change what is playing. A host is a person who eventually
   * leaves and takes the music with them, and the point of listening together
   * is that two people are doing it, not that one is performing it.
   *
   * The whole session is broadcast rather than a delta. It is a few hundred
   * bytes, it changes when somebody presses a button rather than continuously,
   * and a client that missed one message would otherwise hold a queue nobody
   * else has - which is the failure that cannot be noticed from inside.
   */
  private listen(state: SocketState, action: ListenAction): void {
    const channelId = state.channelId;
    if (!channelId) return;

    const before = this.listening.get(channelId) ?? null;
    const after = applyListen(before, action, state.userId, Date.now());
    // Nothing happened: a `duration` for a track that already had one, or an
    // `ended` for a track that stopped being current before it arrived. Saying
    // so anyway would make every client re-seek for no reason.
    if (after === before) return;

    if (after) this.listening.set(channelId, after);
    else this.listening.delete(channelId);

    this.broadcast(channelId, { type: 'listen.state', session: after });
  }

  /**
   * Runs one Play Together action and tells the call what came of it.
   *
   * The gateway is the referee, and this is the only place a board is ever
   * made: a client sends "column four", never a board. The rules come from
   * `@betweenus/shared-types`, which is also where the clients read them, so
   * what everybody draws and what is agreed here cannot drift apart.
   *
   * Membership is the only permission asked for. Who may *move* is a question
   * about the seats rather than about the channel, and the reducer answers it.
   */
  private game(state: SocketState, action: GameAction): void {
    if (!state.channelId) return;
    this.runGame(state.channelId, { userId: state.userId, username: state.username }, action);
  }

  /**
   * The same thing, addressed by channel rather than by socket.
   *
   * `depart` needs this: it clears `state.channelId` before it does anything
   * else, so by the time a leaver's chair has to be freed the socket no longer
   * knows which call it was in.
   */
  private runGame(
    channelId: string,
    actor: { userId: string; username: string },
    action: GameAction,
  ): void {
    const before = this.playing.get(channelId) ?? null;
    const after = applyGame(before, action, actor);
    // Nothing happened: an illegal move, a chair that filled while the click
    // was in flight, a rematch from somebody watching. Broadcasting anyway
    // would make every client redraw a board it already has.
    if (after === before) return;

    if (after) this.playing.set(channelId, after);
    else this.playing.delete(channelId);

    this.broadcast(channelId, { type: 'game.state', session: after });
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
  private depart(socket: WebSocket, options: DepartOptions = {}): void {
    const { keepOpen = false, hold = false } = options;
    const state = this.state.get(socket);
    if (!state) return;

    const { channelId, sessionId } = state;
    state.channelId = null;

    // Closed before anything else can throw, and before the state is dropped:
    // this is the only moment the duration is knowable, and a row left open is
    // an entry that reads as a call that never ended.
    if (sessionId) {
      state.sessionId = null;
      void this.history.endSession(sessionId, [...state.metUserIds], state.usage);
    }
    // A socket that stays open to join elsewhere starts a fresh log entry, so
    // it starts with a fresh idea of who it has met and what it has moved.
    state.metUserIds = new Set<string>();
    state.usage = noUsage();

    if (!keepOpen) this.state.delete(socket);
    if (!channelId) return;

    const members = this.calls.get(channelId);
    if (!members) return;
    members.delete(socket);
    if (members.size === 0) {
      this.calls.delete(channelId);
      // Nobody is listening, so there is nothing to listen to. The queue was a
      // thing this call built and it goes when the call does - keeping it would
      // mean the next person to join a quiet channel is played whatever the
      // last people left half-finished.
      this.listening.delete(channelId);
      // Same for the board: nobody is at the table, so there is no game. A kept
      // one would be a half-finished Reversi position waiting for whoever walks
      // into a quiet channel next.
      this.playing.delete(channelId);
    }

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
    //
    // Unless nobody has said they are leaving. A socket that simply closed is a
    // network, not a decision, and on a phone it is a network that comes back
    // in a second - so the seat is held and the announcement waits. See
    // REJOIN_GRACE_MS.
    //
    // The chair at the game table is held on exactly the same terms, and it
    // has to be: freeing it the instant a socket blinks would let somebody else
    // sit down mid-game while the player it belongs to is still reconnecting.
    const actor = { userId: state.userId, username: state.username };
    if (!hold) {
      this.announceDeparture(channelId, state.peerId);
      this.runGame(channelId, actor, { kind: 'vacate', userId: state.userId });
    } else {
      const key = this.holdKey(channelId, state.peerId);
      const held = state.peerId;
      clearTimeout(this.departing.get(key));
      this.departing.set(
        key,
        setTimeout(() => {
          this.departing.delete(key);
          this.announceDeparture(channelId, held);
          this.runGame(channelId, actor, { kind: 'vacate', userId: actor.userId });
        }, REJOIN_GRACE_MS),
      );
    }

    this.logger.info('Peer left a call', {
      userId: state.userId,
      channelId,
      peers: members.size,
      held: hold,
    });
  }

  /** They are not coming back: tell the call, and correct the roster. */
  private announceDeparture(channelId: string, peerId: string): void {
    this.broadcast(channelId, { type: 'peer.left', peerId });
    this.announceRoster(channelId);
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
    for (const timer of this.departing.values()) clearTimeout(timer);
    this.departing.clear();
    this.server?.close();
  }
}

/**
 * How a socket is being taken off a call.
 *
 * `keepOpen` says the socket lives on - a channel switch, or a device being
 * replaced - so its state is kept and only its membership dropped. `hold` says
 * nobody has announced anything: the seat is kept for [REJOIN_GRACE_MS] and the
 * rest of the call is told only if it is not claimed back.
 */
interface DepartOptions {
  keepOpen?: boolean;
  hold?: boolean;
}

/** A stay nobody reported on: a window closed mid-call, or an older client. */
function noUsage(): ReportedUsage {
  return { bytes: 0, bytesSent: 0, bytesReceived: 0, links: [] };
}
