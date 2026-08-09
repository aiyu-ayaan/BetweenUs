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
 * ponytail: sessions are relayed in this process's memory, so agent and
 * controller must land on the same instance - true for the single replica the
 * compose file runs. Redis Pub/Sub keyed by session id is the upgrade, the same
 * way chat- and presence-service fan out.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { prisma, recordRemoteAudit } from '@nexora/database';
import { Logger } from '@nexora/logger';
import { PERMISSIONS, type RemotePermission } from '@nexora/permissions';
import { authenticateHandshake } from '@nexora/websocket';
import type {
  AgentRemoteEvent,
  ClientRemoteEvent,
  ServerRemoteEvent,
} from '@nexora/shared-types';
import { RemoteService } from './modules/remote/remote.service';

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
   * too, so the audit trail and a restart agree with what the relay enforces.
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
  /** machineId -> the agent's live socket. One agent per machine. */
  private readonly agents = new Map<string, WebSocket>();
  /** sessionId -> the controller's live socket. */
  private readonly controllers = new Map<string, WebSocket>();
  /** sessionId -> machineId, so a teardown knows which agent to tell. */
  private readonly sessionMachines = new Map<string, string>();

  constructor(
    private readonly remote: RemoteService,
    private readonly logger: Logger,
  ) {}

  attach(httpServer: HttpServer): void {
    this.remote.setPresence({ isOnline: (machineId) => this.agents.has(machineId) });
    this.remote.onGrantRevoked = (machineId, userId) => this.endSessionsFor(machineId, userId);
    this.remote.onSessionEnded = async (sessionId, reason) => {
      this.tearDown(sessionId, reason);
    };

    this.server = new WebSocketServer({ server: httpServer, path: '/ws/remote' });

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
        if (state.kind === 'agent') void this.remote.touchMachine(state.machineId);
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
    // back after a network drop, so the older socket is the stale one.
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

    this.send(socket, { type: 'ready', role: 'agent', machineId: machine.id });
    this.logger.info('Remote agent connected', { machineId: machine.id });

    socket.on('pong', () => this.markAlive(socket));
    socket.on('message', (raw) => void this.onAgentEvent(socket, raw.toString()));
    socket.on('close', () => {
      // Only if this socket is still the registered one: a reconnect replaces
      // the entry before the old socket's close event arrives.
      if (this.agents.get(machine.id) === socket) this.agents.delete(machine.id);
      this.state.delete(socket);
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
        const controller = this.controllers.get(event.sessionId);
        if (event.type === 'session.accepted') {
          if (controller) {
            this.send(controller, {
              type: 'agent.state',
              sessionId: event.sessionId,
              state: 'accepted',
            });
          }
          return;
        }

        if (controller) {
          this.send(controller, {
            type: 'agent.state',
            sessionId: event.sessionId,
            state: 'refused',
            reason: event.reason,
          });
        }
        // The person sitting at the machine said no. That is a refusal worth
        // keeping: it is the record that consent was asked for and withheld.
        await recordRemoteAudit({
          machineId: state.machineId,
          sessionId: event.sessionId,
          action: 'session.refused',
          detail: { reason: event.reason, by: 'agent' },
        });
        await this.remote.endSession(event.sessionId, 'refused');
        this.tearDown(event.sessionId, 'refused');
        return;
      }

      case 'session.ended':
        await this.remote.endSession(event.sessionId, 'agent');
        this.tearDown(event.sessionId, 'agent');
        return;

      case 'control.granted':
      case 'control.denied': {
        const controller = this.controllers.get(event.sessionId);
        const controllerState = controller ? this.state.get(controller) : undefined;
        if (!controller || controllerState?.kind !== 'controller') return;

        const granted = event.type === 'control.granted';
        const refusal = event.type === 'control.denied' ? (event.reason ?? 'declined') : null;
        if (granted && !controllerState.permissions.includes(PERMISSIONS.REMOTE_CONTROL)) {
          // Somebody at the machine said yes. That is a higher authority than a
          // stored grant, so it stands - but only for this session: it is
          // written to the session row, never to the grant.
          controllerState.permissions = [
            ...controllerState.permissions,
            PERMISSIONS.REMOTE_CONTROL,
          ];
          await prisma.remoteSession
            .update({
              where: { id: event.sessionId },
              data: { permissions: controllerState.permissions },
            })
            .catch(() => undefined);
        }

        await recordRemoteAudit({
          machineId: state.machineId,
          sessionId: event.sessionId,
          actorId: controllerState.userId,
          action: granted ? 'control.granted' : 'control.denied',
          detail: granted ? {} : { reason: refusal },
        });

        this.send(controller, {
          type: 'control.changed',
          sessionId: event.sessionId,
          permissions: controllerState.permissions,
          granted,
          ...(granted ? {} : { reason: refusal ?? 'The machine refused' }),
        });
        return;
      }

      // Which displays the machine has. No permission of its own: a session
      // that may see the screen may know how many there are.
      case 'screens': {
        const controller = this.controllers.get(event.sessionId);
        if (controller) {
          this.send(controller, {
            type: 'screens',
            screens: event.screens,
            activeId: event.activeId,
          });
        }
        return;
      }

      case 'clipboard.text': {
        // The machine's clipboard travelling to the controller needs the same
        // permission as the other direction.
        const controller = this.controllers.get(event.sessionId);
        const controllerState = controller ? this.state.get(controller) : undefined;
        if (
          controller &&
          controllerState?.kind === 'controller' &&
          controllerState.permissions.includes(PERMISSIONS.REMOTE_CLIPBOARD)
        ) {
          this.send(controller, { type: 'clipboard.set', text: event.text });
        }
        return;
      }

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

    const agent = this.agents.get(session.machineId);
    if (!agent) {
      socket.close(4404, 'Agent offline');
      await this.remote.endSession(sessionId, 'agent-offline');
      return;
    }

    const permissions = session.permissions.filter((value): value is RemotePermission =>
      Object.prototype.hasOwnProperty.call(PERMISSIONS, value),
    );

    this.controllers.set(sessionId, socket);
    this.sessionMachines.set(sessionId, session.machineId);
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
    // and to start publishing, with its own credentials for the same room.
    const media = await this.remote.agentSessionToken(sessionId, session.machineId);
    this.send(agent, {
      type: 'session.start',
      sessionId,
      controllerId: user.id,
      controllerName: user.username,
      permissions,
      ...media,
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
      const machineAgent = this.agents.get(session.machineId);
      if (machineAgent) {
        this.send(machineAgent, { type: 'session.ended', sessionId, reason: 'controller' });
      }
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
      this.tearDown(state.sessionId, 'controller');
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

      const agent = this.agents.get(state.machineId);
      if (!agent) {
        this.send(socket, { type: 'error', code: 'AGENT_OFFLINE', message: 'The machine is gone' });
        return;
      }

      await recordRemoteAudit({
        machineId: state.machineId,
        sessionId: state.sessionId,
        actorId: state.userId,
        action: 'control.requested',
      });
      this.send(agent, {
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
      const agent = this.agents.get(state.machineId);
      if (agent) {
        this.send(agent, {
          type: 'control.changed',
          sessionId: state.sessionId,
          permissions: state.permissions,
          granted: false,
        });
      }
      return;
    }

    // Choosing a monitor is a view decision, not a control one: a view-only
    // session is entitled to look at the other screen. The agent answers with a
    // fresh `screens`, so the controller never has to assume it worked.
    if (event.type === 'screen.select') {
      const agent = this.agents.get(state.machineId);
      if (!agent) {
        this.send(socket, { type: 'error', code: 'AGENT_OFFLINE', message: 'The machine is gone' });
        return;
      }
      this.send(agent, {
        type: 'screen.select',
        sessionId: state.sessionId,
        screenId: event.screenId,
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

    const agent = this.agents.get(state.machineId);
    if (!agent) {
      this.send(socket, { type: 'error', code: 'AGENT_OFFLINE', message: 'The machine is gone' });
      return;
    }

    this.send(agent, event as ServerRemoteEvent);
  }

  // --- Teardown -------------------------------------------------------------

  /** Closes both ends of a session that is over, whoever ended it. */
  private tearDown(sessionId: string, reason: string): void {
    const controller = this.controllers.get(sessionId);
    if (controller) {
      this.send(controller, { type: 'session.ended', sessionId, reason });
      controller.close(4000, reason);
      this.controllers.delete(sessionId);
    }

    const machineId = this.sessionMachines.get(sessionId);
    const agent = machineId ? this.agents.get(machineId) : undefined;
    // The agent has to stop capturing whether or not the controller is still
    // there to be told - a session nobody is watching must not stay open.
    if (agent) this.send(agent, { type: 'session.ended', sessionId, reason });
    this.sessionMachines.delete(sessionId);
  }

  /** Every live session on a machine, for when its agent disappears. */
  private async endSessionsForMachine(machineId: string, reason: string): Promise<void> {
    const open = await prisma.remoteSession.findMany({
      where: { machineId, endedAt: null },
      select: { id: true },
    });
    for (const session of open) {
      await this.remote.endSession(session.id, reason);
      this.tearDown(session.id, reason);
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
      this.tearDown(session.id, 'revoked');
    }
  }

  private markAlive(socket: WebSocket): void {
    const state = this.state.get(socket);
    if (state) state.alive = true;
  }

  private send(socket: WebSocket, event: ServerRemoteEvent): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.server?.close();
  }
}
