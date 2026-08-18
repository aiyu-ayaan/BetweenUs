/**
 * `/ws/remote`: the relay between a controller and an agent.
 *
 * Two kinds of socket connect here and they authenticate differently. An agent
 * presents the token it was given at enrolment (`?agent=`); a controller
 * presents the usual access token and the session it was issued (`?sessionId=`).
 * Neither ever learns the other's address - the agent dialled out, the
 * controller dialled in, and this process is the only thing that sees both.
 *
 * Every input event is checked against the permissions frozen on the session
 * row, here, on the server. The desktop client hides what it cannot do, but
 * hiding is not enforcement.
 *
 * The two halves of a session need not be on the same instance: the agent
 * dialled out hours ago and the controller dialled in just now, through a load
 * balancer with no idea they belong together. So every message goes through
 * `toAgent` / `toController`, which deliver to a local socket when this instance
 * holds it and publish through `RemoteRelay` when it does not. Nothing in this
 * file may reach into `agents` or `controllers` directly to send.
 *
 * The one consequence worth naming: a controller's live permissions cannot be
 * read from memory when the controller is somebody else's socket. They are read
 * from the session row instead, which is the authoritative copy anyway - the
 * in-memory list is a cache of it, kept in step by `control.changed`.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { envOr } from '@nexora/config';
import { asRemotePermissions, prisma, recordRemoteAudit } from '@nexora/database';
import { Logger } from '@nexora/logger';
import { PERMISSIONS, type RemotePermission } from '@nexora/permissions';
import { SIGNAL_MAX_PAYLOAD, authenticateHandshake } from '@nexora/websocket';
import type {
  AgentRemoteEvent,
  ClientRemoteEvent,
  ServerRemoteEvent,
} from '@nexora/shared-types';
import { RemoteService } from './modules/remote/remote.service';
import { RemoteRelay, type RelayTarget } from './remote.relay';

const HEARTBEAT_INTERVAL_MS = 30_000;

/** What a controller's event needs before it is relayed to the machine. */
const REQUIRED_PERMISSION: Record<string, RemotePermission> = {
  'input.mouse': PERMISSIONS.REMOTE_CONTROL,
  'input.key': PERMISSIONS.REMOTE_CONTROL,
  'clipboard.set': PERMISSIONS.REMOTE_CLIPBOARD,
};

interface AgentSocket {
  kind: 'agent';
  machineId: string;
  ownerId: string;
  alive: boolean;
}

interface ControllerSocket {
  kind: 'controller';
  sessionId: string;
  machineId: string;
  userId: string;
  username: string;
  /**
   * Mutable, unlike the row it started from: the machine can lend control
   * mid-session and take it back. Every change is written to the session row
   * too, so the audit trail and a restart agree with what the relay enforces -
   * and so an instance that does not hold this socket can still read what this
   * session may do.
   */
  permissions: RemotePermission[];
  alive: boolean;
}

type SocketState = AgentSocket | ControllerSocket;

@Injectable()
export class RemoteGateway implements OnModuleDestroy {
  private server: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly state = new WeakMap<WebSocket, SocketState>();
  /** machineId -> the agent's live socket *on this instance*. */
  private readonly agents = new Map<string, WebSocket>();
  /** sessionId -> the controller's live socket *on this instance*. */
  private readonly controllers = new Map<string, WebSocket>();
  private readonly relay = new RemoteRelay(
    envOr('REDIS_URL', 'redis://localhost:6379'),
    randomUUID(),
  );

  constructor(
    private readonly remote: RemoteService,
    private readonly logger: Logger,
  ) {}

  attach(httpServer: HttpServer): void {
    this.remote.setPresence({
      isOnline: (machineId) => this.relay.isAgentOnline(machineId),
      onlineAmong: (machineIds) => this.relay.onlineAgents(machineIds),
    });
    this.remote.onGrantRevoked = (machineId, userId) => this.endSessionsFor(machineId, userId);
    this.remote.onSessionEnded = async (sessionId, machineId, reason) => {
      this.tearDown(sessionId, machineId, reason);
    };

    void this.relay.start((message) => this.deliverLocal(message.target, message.event, message.close));

    this.server = new WebSocketServer({
      server: httpServer,
      path: '/ws/remote',
      maxPayload: SIGNAL_MAX_PAYLOAD,
    });

    this.server.on('connection', (socket, request) => {
      void this.onConnection(socket, request);
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
        if (state.kind === 'agent') {
          void this.remote.touchMachine(state.machineId);
          // Renews the registry entry. It outlives two missed beats and no more,
          // so an instance that dies stops claiming its agents by itself.
          void this.relay.announceAgent(state.machineId);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.logger.info('Remote WebSocket gateway ready', { path: '/ws/remote' });
  }

  private async onConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const agentToken = url.searchParams.get('agent');

    if (agentToken) {
      await this.acceptAgent(socket, agentToken);
      return;
    }
    await this.acceptController(socket, request, url.searchParams.get('sessionId'));
  }

  // --- Agents ---------------------------------------------------------------

  private async acceptAgent(socket: WebSocket, token: string): Promise<void> {
    const machine = await this.remote.machineForAgentToken(token);
    if (!machine) {
      socket.close(4401, 'Unauthorized');
      return;
    }

    // One agent per machine. A second connection is the same machine coming
    // back after a network drop, so the older socket is the stale one - and it
    // may be a socket on another instance, which is why the close is relayed
    // rather than only applied here.
    const previous = this.agents.get(machine.id);
    if (previous && previous !== socket) previous.close(4409, 'Replaced');

    this.agents.set(machine.id, socket);
    this.state.set(socket, {
      kind: 'agent',
      machineId: machine.id,
      ownerId: machine.ownerId,
      alive: true,
    });
    await this.remote.touchMachine(machine.id);
    // Claimed before the older socket elsewhere is told to go: the registry
    // should never have a window where the machine reads offline.
    await this.relay.announceAgent(machine.id);
    await this.relay.forward({ kind: 'agent', machineId: machine.id }, null, {
      code: 4409,
      reason: 'Replaced',
    });

    this.send(socket, { type: 'ready', role: 'agent', machineId: machine.id });
    this.logger.info('Remote agent connected', { machineId: machine.id });

    socket.on('pong', () => this.markAlive(socket));
    socket.on('message', (raw) => void this.onAgentEvent(socket, raw.toString()));
    socket.on('close', () => {
      // Only if this socket is still the registered one: a reconnect replaces
      // the entry before the old socket's close event arrives.
      if (this.agents.get(machine.id) !== socket) {
        this.state.delete(socket);
        return;
      }
      this.agents.delete(machine.id);
      this.state.delete(socket);
      void this.relay.forgetAgent(machine.id);
      // Every session on a machine that just went away is over; nothing is
      // going to answer for it.
      void this.endSessionsForMachine(machine.id, 'agent-offline');
      this.logger.info('Remote agent disconnected', { machineId: machine.id });
    });
    socket.on('error', (error) => {
      this.logger.warn('Remote agent socket error', {
        machineId: machine.id,
        reason: String(error),
      });
    });
  }

  private async onAgentEvent(socket: WebSocket, raw: string): Promise<void> {
    const state = this.state.get(socket);
    if (state?.kind !== 'agent') return;

    let event: AgentRemoteEvent;
    try {
      event = JSON.parse(raw) as AgentRemoteEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case 'agent.ready':
        await this.remote.touchMachine(state.machineId);
        return;

      case 'session.accepted':
      case 'session.refused': {
        if (event.type === 'session.accepted') {
          this.toController(event.sessionId, {
            type: 'agent.state',
            sessionId: event.sessionId,
            state: 'accepted',
          });
          return;
        }

        this.toController(event.sessionId, {
          type: 'agent.state',
          sessionId: event.sessionId,
          state: 'refused',
          reason: event.reason,
        });
        // The person sitting at the machine said no. That is a refusal worth
        // keeping: it is the record that consent was asked for and withheld.
        await recordRemoteAudit({
          machineId: state.machineId,
          sessionId: event.sessionId,
          action: 'session.refused',
          detail: { reason: event.reason, by: 'agent' },
        });
        await this.remote.endSession(event.sessionId, 'refused');
        this.tearDown(event.sessionId, state.machineId, 'refused');
        return;
      }

      case 'session.ended':
        await this.remote.endSession(event.sessionId, 'agent');
        this.tearDown(event.sessionId, state.machineId, 'agent');
        return;

      case 'control.granted':
      case 'control.denied': {
        // Read from the session row rather than from a controller socket this
        // instance may not hold. The row is what the relay enforces against, so
        // it is also the right thing to change.
        const session = await this.liveSession(event.sessionId);
        if (!session) return;

        const granted = event.type === 'control.granted';
        const refusal = event.type === 'control.denied' ? (event.reason ?? 'declined') : null;
        let permissions = session.permissions;

        if (granted && !permissions.includes(PERMISSIONS.REMOTE_CONTROL)) {
          // Somebody at the machine said yes. That is a higher authority than a
          // stored grant, so it stands - but only for this session: it is
          // written to the session row, never to the grant.
          permissions = [...permissions, PERMISSIONS.REMOTE_CONTROL];
          await prisma.remoteSession
            .update({ where: { id: event.sessionId }, data: { permissions } })
            .catch(() => undefined);
        }

        await recordRemoteAudit({
          machineId: state.machineId,
          sessionId: event.sessionId,
          actorId: session.userId,
          action: granted ? 'control.granted' : 'control.denied',
          detail: granted ? {} : { reason: refusal },
        });

        this.toController(event.sessionId, {
          type: 'control.changed',
          sessionId: event.sessionId,
          permissions,
          granted,
          ...(granted ? {} : { reason: refusal ?? 'The machine refused' }),
        });
        return;
      }

      // Which displays the machine has. No permission of its own: a session
      // that may see the screen may know how many there are.
      case 'screens':
        this.toController(event.sessionId, {
          type: 'screens',
          screens: event.screens,
          activeId: event.activeId,
        });
        return;

      case 'clipboard.text': {
        // The machine's clipboard travelling to the controller needs the same
        // permission as the other direction.
        const session = await this.liveSession(event.sessionId);
        if (session?.permissions.includes(PERMISSIONS.REMOTE_CLIPBOARD)) {
          this.toController(event.sessionId, { type: 'clipboard.set', text: event.text });
        }
        return;
      }

      // The agent's half of setting up the peer connection, on its way to that
      // session's controller. Forwarded without being read: an SDP this gateway
      // rewrote would be an SDP it could put itself in the middle of.
      case 'rtc.signal':
        this.toController(event.sessionId, { type: 'rtc.signal', data: event.data });
        return;

      case 'pong':
        return;

      default:
        return;
    }
  }

  // --- Controllers ----------------------------------------------------------

  private async acceptController(
    socket: WebSocket,
    request: IncomingMessage,
    sessionId: string | null,
  ): Promise<void> {
    const user = authenticateHandshake(request);
    if (!user || !sessionId) {
      socket.close(4401, 'Unauthorized');
      return;
    }

    const session = await prisma.remoteSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        machineId: true,
        userId: true,
        permissions: true,
        endedAt: true,
        machine: { select: { name: true } },
      },
    });

    // The session is the authorization. It was issued to one person over HTTP
    // after the grant was checked; presenting somebody else's is not a way in.
    if (!session || session.endedAt || session.userId !== user.id) {
      socket.close(4403, 'Forbidden');
      return;
    }

    // Connected to any instance, not only this one.
    if (!(await this.relay.isAgentOnline(session.machineId))) {
      socket.close(4404, 'Agent offline');
      await this.remote.endSession(sessionId, 'agent-offline');
      return;
    }

    const permissions = asRemotePermissions(session.permissions);

    this.controllers.set(sessionId, socket);
    this.state.set(socket, {
      kind: 'controller',
      sessionId,
      machineId: session.machineId,
      userId: user.id,
      username: user.username,
      permissions,
      alive: true,
    });

    this.send(socket, { type: 'ready', role: 'controller', sessionId });

    // Only now does the machine hear about it: the agent is asked to consent
    // and, if it does, to offer its screen to the controller directly. It is
    // given ICE servers rather than an address, because nothing here knows or
    // needs to know where either end is.
    this.toAgent(session.machineId, {
      type: 'session.start',
      sessionId,
      controllerId: user.id,
      controllerName: user.username,
      permissions,
      iceServers: await this.remote.agentIceServers(),
    });

    this.logger.info('Remote session opened', {
      sessionId,
      machineId: session.machineId,
      userId: user.id,
    });

    socket.on('pong', () => this.markAlive(socket));
    socket.on('message', (raw) => void this.onControllerEvent(socket, raw.toString()));
    socket.on('close', () => {
      this.state.delete(socket);
      if (this.controllers.get(sessionId) === socket) this.controllers.delete(sessionId);
      void this.remote.endSession(sessionId, 'controller');
      this.toAgent(session.machineId, { type: 'session.ended', sessionId, reason: 'controller' });
    });
    socket.on('error', () => socket.close());
  }

  private async onControllerEvent(socket: WebSocket, raw: string): Promise<void> {
    const state = this.state.get(socket);
    if (state?.kind !== 'controller') return;

    let event: ClientRemoteEvent;
    try {
      event = JSON.parse(raw) as ClientRemoteEvent;
    } catch {
      return;
    }

    if (event.type === 'ping') {
      this.send(socket, { type: 'pong' });
      return;
    }

    if (event.type === 'session.end') {
      await this.remote.endSession(state.sessionId, 'controller');
      this.tearDown(state.sessionId, state.machineId, 'controller');
      return;
    }

    // Asking for control, RDP style. A session already granted it is answered
    // here and never bothers the machine; one that was not has to be let in by
    // whoever is sitting at it.
    if (event.type === 'control.request') {
      if (state.permissions.includes(PERMISSIONS.REMOTE_CONTROL)) {
        this.send(socket, {
          type: 'control.changed',
          sessionId: state.sessionId,
          permissions: state.permissions,
          granted: true,
        });
        return;
      }

      if (!(await this.requireAgent(socket, state.machineId))) return;

      await recordRemoteAudit({
        machineId: state.machineId,
        sessionId: state.sessionId,
        actorId: state.userId,
        action: 'control.requested',
      });
      this.toAgent(state.machineId, {
        type: 'control.requested',
        sessionId: state.sessionId,
        controllerName: state.username,
      });
      return;
    }

    // Handing control back mid-session. Only what the machine lent is taken
    // away - a session granted control up front keeps it.
    if (event.type === 'control.release') {
      state.permissions = state.permissions.filter(
        (permission) => permission !== PERMISSIONS.REMOTE_CONTROL,
      );
      await prisma.remoteSession
        .update({ where: { id: state.sessionId }, data: { permissions: state.permissions } })
        .catch(() => undefined);
      this.send(socket, {
        type: 'control.changed',
        sessionId: state.sessionId,
        permissions: state.permissions,
        granted: false,
      });
      this.toAgent(state.machineId, {
        type: 'control.changed',
        sessionId: state.sessionId,
        permissions: state.permissions,
        granted: false,
      });
      return;
    }

    // Choosing a monitor is a view decision, not a control one: a view-only
    // session is entitled to look at the other screen. The agent answers with a
    // fresh `screens`, so the controller never has to assume it worked.
    if (event.type === 'screen.select') {
      if (!(await this.requireAgent(socket, state.machineId))) return;
      this.toAgent(state.machineId, {
        type: 'screen.select',
        sessionId: state.sessionId,
        screenId: event.screenId,
      });
      return;
    }

    // The controller's half of setting up the peer connection, on its way to
    // the agent. No permission of its own: answering an offer is how a session
    // that may view the screen comes to see it, and REMOTE_VIEW was checked
    // before the session existed. Forwarded without being read, for the same
    // reason the other direction is.
    if (event.type === 'rtc.signal') {
      this.toAgent(state.machineId, {
        type: 'rtc.signal',
        sessionId: state.sessionId,
        data: event.data,
      });
      return;
    }

    const required = REQUIRED_PERMISSION[event.type];
    if (!required) {
      this.send(socket, { type: 'error', code: 'UNKNOWN_EVENT', message: 'Unsupported event' });
      return;
    }

    if (!state.permissions.includes(required)) {
      // Refusals are audited, not only rejected: a client that keeps asking for
      // something it was not granted is worth being able to see afterwards.
      this.send(socket, {
        type: 'error',
        code: `${required}_REQUIRED`,
        message: 'That is not permitted in this session',
      });
      await recordRemoteAudit({
        machineId: state.machineId,
        sessionId: state.sessionId,
        actorId: state.userId,
        action: 'input.refused',
        detail: { event: event.type, required },
      });
      return;
    }

    if (!(await this.requireAgent(socket, state.machineId))) return;
    this.toAgent(state.machineId, event as ServerRemoteEvent);
  }

  // --- Delivery -------------------------------------------------------------

  /** Local socket if this instance holds it, the relay otherwise. */
  private toAgent(
    machineId: string,
    event: ServerRemoteEvent,
    close?: { code: number; reason: string },
  ): void {
    const target: RelayTarget = { kind: 'agent', machineId };
    if (this.agents.has(machineId)) {
      this.deliverLocal(target, event, close);
      return;
    }
    void this.relay.forward(target, event, close);
  }

  private toController(
    sessionId: string,
    event: ServerRemoteEvent,
    close?: { code: number; reason: string },
  ): void {
    const target: RelayTarget = { kind: 'controller', sessionId };
    if (this.controllers.has(sessionId)) {
      this.deliverLocal(target, event, close);
      return;
    }
    void this.relay.forward(target, event, close);
  }

  /**
   * The one place a message reaches a socket, whether it came from this
   * instance or another one - which is what makes the cached copy of a
   * session's permissions impossible to get out of step: `control.changed` is
   * applied here, on the way past, wherever the controller happens to be.
   */
  private deliverLocal(
    target: RelayTarget,
    event: ServerRemoteEvent | null,
    close?: { code: number; reason: string },
  ): void {
    const socket =
      target.kind === 'agent'
        ? this.agents.get(target.machineId)
        : this.controllers.get(target.sessionId);
    if (!socket) return;

    if (target.kind === 'controller' && event?.type === 'control.changed') {
      const state = this.state.get(socket);
      if (state?.kind === 'controller') state.permissions = asRemotePermissions(event.permissions);
    }

    if (event) this.send(socket, event);
    if (close) socket.close(close.code, close.reason);
  }

  /** The session as the server holds it, or null if it is over. */
  private async liveSession(
    sessionId: string,
  ): Promise<{ userId: string; permissions: RemotePermission[] } | null> {
    const session = await prisma.remoteSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, permissions: true, endedAt: true },
    });
    if (!session || session.endedAt) return null;
    return { userId: session.userId, permissions: asRemotePermissions(session.permissions) };
  }

  /** Tells the controller when the machine is not there, and answers whether it is. */
  private async requireAgent(socket: WebSocket, machineId: string): Promise<boolean> {
    if (await this.relay.isAgentOnline(machineId)) return true;
    this.send(socket, { type: 'error', code: 'AGENT_OFFLINE', message: 'The machine is gone' });
    return false;
  }

  // --- Teardown -------------------------------------------------------------

  /** Closes both ends of a session that is over, whoever ended it. */
  private tearDown(sessionId: string, machineId: string, reason: string): void {
    this.toController(sessionId, { type: 'session.ended', sessionId, reason }, {
      code: 4000,
      reason,
    });
    // The agent has to stop capturing whether or not the controller is still
    // there to be told - a session nobody is watching must not stay open.
    this.toAgent(machineId, { type: 'session.ended', sessionId, reason });
  }

  /** Every live session on a machine, for when its agent disappears. */
  private async endSessionsForMachine(machineId: string, reason: string): Promise<void> {
    const open = await prisma.remoteSession.findMany({
      where: { machineId, endedAt: null },
      select: { id: true },
    });
    for (const session of open) {
      await this.remote.endSession(session.id, reason);
      this.tearDown(session.id, machineId, reason);
    }
  }

  /**
   * A revoked grant takes effect immediately, including on a session already
   * running. Permissions are frozen when a session starts precisely so that
   * this is a decision rather than a race.
   */
  private async endSessionsFor(machineId: string, userId: string): Promise<void> {
    const open = await prisma.remoteSession.findMany({
      where: { machineId, userId, endedAt: null },
      select: { id: true },
    });
    for (const session of open) {
      await this.remote.endSession(session.id, 'revoked');
      this.tearDown(session.id, machineId, 'revoked');
    }
  }

  private markAlive(socket: WebSocket): void {
    const state = this.state.get(socket);
    if (state) state.alive = true;
  }

  private send(socket: WebSocket, event: ServerRemoteEvent): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.close();
    await this.relay.close();
  }
}
