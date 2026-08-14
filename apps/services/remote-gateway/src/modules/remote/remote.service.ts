/**
 * Everything a remote session needs before pixels move: enrolment, grants,
 * session lifecycle and the audit trail.
 *
 * The service decides *who may do what to which machine*. It never sees a
 * frame: the screen goes directly from the agent to the controller over a peer
 * connection, exactly the way a call does, and the gateway's part is relaying
 * the offer and answer that set it up.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { iceServers } from '@nexora/config';
import {
  asRemotePermissions,
  prisma,
  recordRemoteAudit,
  resolveRemoteAccess,
  type RemoteAccess,
} from '@nexora/database';
import { PERMISSIONS, type RemotePermission } from '@nexora/permissions';
import type {
  EnrolMachineResponse,
  IceServer,
  RemoteAuditEntry,
  RemoteGrantSummary,
  RemoteMachineSummary,
  RemoteSessionResponse,
} from '@nexora/shared-types';

/** An agent that has not been heard from for this long is treated as offline. */
export const AGENT_STALE_MS = 90_000;

/** Reported by the ws gateway, which is the only thing that knows who is dialled in. */
export interface AgentPresence {
  isOnline(machineId: string): boolean;
}

@Injectable()
export class RemoteService {
  /**
   * Set by the WebSocket gateway at boot. Online-ness is a property of a live
   * socket, not of a column, so the HTTP side asks rather than storing it.
   */
  private presence: AgentPresence = { isOnline: () => false };

  setPresence(presence: AgentPresence): void {
    this.presence = presence;
  }

  // --- Enrolment ------------------------------------------------------------

  /**
   * Enrols this machine, or rotates the token of one already enrolled.
   *
   * The token is returned once and stored hashed, the way a password is. An
   * agent that loses it enrols again, which is also how a stolen token is
   * revoked: the old one stops matching.
   */
  async enrol(
    userId: string,
    body: { name: string; platform: string; machineId?: string },
  ): Promise<EnrolMachineResponse> {
    const agentToken = randomBytes(32).toString('base64url');
    const agentTokenHash = hashToken(agentToken);

    if (body.machineId) {
      const existing = await prisma.remoteMachine.findUnique({
        where: { id: body.machineId },
        select: { id: true, ownerId: true },
      });
      // Someone else's machine id must not be re-enrolled into this account:
      // that would be a takeover with no more than a guessed uuid.
      if (!existing || existing.ownerId !== userId) {
        throw new NotFoundException({ code: 'MACHINE_NOT_FOUND', message: 'Machine not found' });
      }
    }

    const machine = body.machineId
      ? await prisma.remoteMachine.update({
          where: { id: body.machineId },
          data: { name: body.name, platform: body.platform, agentTokenHash },
        })
      : await prisma.remoteMachine.create({
          data: { ownerId: userId, name: body.name, platform: body.platform, agentTokenHash },
        });

    await recordRemoteAudit({
      machineId: machine.id,
      actorId: userId,
      action: body.machineId ? 'machine.reenrolled' : 'machine.enrolled',
      detail: { name: machine.name, platform: machine.platform },
    });

    return {
      machine: await this.summarise(machine.id, userId),
      agentToken,
    };
  }

  /** Machines this user owns, plus the ones they hold a live grant on. */
  async machines(userId: string): Promise<RemoteMachineSummary[]> {
    const now = new Date();
    const rows = await prisma.remoteMachine.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            grants: {
              some: {
                userId,
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
            },
          },
        ],
      },
      include: {
        owner: { select: { username: true } },
        grants: { where: { userId }, select: { permissions: true, expiresAt: true } },
      },
      orderBy: { name: 'asc' },
    });

    return rows
      .map((row) => {
        const isOwner = row.ownerId === userId;
        const grant = row.grants[0];
        const permissions = isOwner
          ? [...REMOTE_ALL]
          : asRemotePermissions(grant?.permissions ?? []);
        return {
          id: row.id,
          name: row.name,
          platform: row.platform,
          ownerId: row.ownerId,
          ownerUsername: row.owner.username,
          online: this.presence.isOnline(row.id),
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          permissions,
          expiresAt: isOwner ? null : (grant?.expiresAt?.toISOString() ?? null),
          createdAt: row.createdAt.toISOString(),
        };
      })
      // A grant emptied rather than deleted leaves a row that grants nothing;
      // it should not put a machine in somebody's list.
      .filter((machine) => machine.permissions.length > 0);
  }

  async rename(userId: string, machineId: string, name: string): Promise<RemoteMachineSummary> {
    await this.requireAdmin(userId, machineId);
    await prisma.remoteMachine.update({ where: { id: machineId }, data: { name } });
    await recordRemoteAudit({ machineId, actorId: userId, action: 'machine.renamed', detail: { name } });
    return this.summarise(machineId, userId);
  }

  /** Owner only: unenrolling is not something a delegated administrator does. */
  async remove(userId: string, machineId: string): Promise<void> {
    const access = await this.requireAccess(userId, machineId);
    if (!access.isOwner) {
      throw new ForbiddenException({
        code: 'NOT_MACHINE_OWNER',
        message: 'Only the machine owner can remove it',
      });
    }
    await prisma.remoteMachine.delete({ where: { id: machineId } });
  }

  // --- Grants ---------------------------------------------------------------

  async grants(userId: string, machineId: string): Promise<RemoteGrantSummary[]> {
    await this.requireAdmin(userId, machineId);
    const rows = await prisma.remoteGrant.findMany({
      where: { machineId },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      userId: row.userId,
      username: row.user.username,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
      permissions: asRemotePermissions(row.permissions),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    }));
  }

  /**
   * Replaces one person's access wholesale. An empty permission list revokes,
   * which is why there is no separate delete: one call, one row, one meaning.
   *
   * A revocation ends whatever session that person currently holds - the
   * gateway is told through `onGrantRevoked`, wired in the module.
   */
  async setGrant(
    userId: string,
    machineId: string,
    body: { userId: string; permissions: string[]; expiresAt?: string | null },
  ): Promise<RemoteGrantSummary[]> {
    const access = await this.requireAdmin(userId, machineId);

    if (body.userId === access.ownerId) {
      throw new ConflictException({
        code: 'OWNER_GRANT',
        message: 'The owner already has every permission on this machine',
      });
    }

    const target = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No such user' });
    }

    const permissions = asRemotePermissions(body.permissions);
    // Unknown names are dropped rather than stored, so a client cannot invent a
    // permission and have it sit in the database looking official.
    if (permissions.length !== body.permissions.length && body.permissions.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_PERMISSION',
        message: 'That is not a remote permission',
      });
    }

    // Control without view is a session that can type into a screen nobody is
    // watching. Every other permission is additive on top of viewing.
    if (permissions.length > 0 && !permissions.includes(PERMISSIONS.REMOTE_VIEW)) {
      permissions.unshift(PERMISSIONS.REMOTE_VIEW);
    }

    const expiresAt = parseExpiry(body.expiresAt);

    await prisma.remoteGrant.upsert({
      where: { machineId_userId: { machineId, userId: body.userId } },
      create: {
        machineId,
        userId: body.userId,
        permissions,
        expiresAt,
        grantedById: userId,
      },
      update: { permissions, expiresAt, grantedById: userId },
    });

    await recordRemoteAudit({
      machineId,
      actorId: userId,
      action: 'permission.changed',
      detail: { userId: body.userId, permissions, expiresAt: expiresAt?.toISOString() ?? null },
    });

    if (permissions.length === 0) await this.onGrantRevoked(machineId, body.userId);

    return this.grants(userId, machineId);
  }

  /** Set by the module so a revoked grant can end a live session. */
  onGrantRevoked: (machineId: string, userId: string) => Promise<void> = async () => undefined;

  // --- Sessions -------------------------------------------------------------

  /**
   * Opens a session. The permissions are read once, here, and carried on the
   * session row: the relay enforces what was granted at the start, and a change
   * mid-session ends it rather than quietly widening or narrowing what the
   * other end is already doing.
   */
  async startSession(
    user: { id: string; username: string },
    machineId: string,
  ): Promise<RemoteSessionResponse> {
    const access = await this.requireAccess(user.id, machineId);
    if (!access.permissions.includes(PERMISSIONS.REMOTE_VIEW)) {
      await recordRemoteAudit({
        machineId,
        actorId: user.id,
        action: 'session.refused',
        detail: { reason: 'no-view-permission' },
      });
      throw new ForbiddenException({
        code: 'REMOTE_VIEW_REQUIRED',
        message: 'You cannot view this machine',
      });
    }

    if (!this.presence.isOnline(machineId)) {
      throw new ServiceUnavailableException({
        code: 'AGENT_OFFLINE',
        message: 'That machine is not connected',
      });
    }

    const machine = await prisma.remoteMachine.findUniqueOrThrow({
      where: { id: machineId },
      select: { name: true },
    });

    const session = await prisma.remoteSession.create({
      data: { machineId, userId: user.id, permissions: access.permissions },
    });

    await recordRemoteAudit({
      machineId,
      actorId: user.id,
      sessionId: session.id,
      action: 'session.started',
      detail: { permissions: access.permissions },
    });

    return {
      sessionId: session.id,
      machineId,
      machineName: machine.name,
      permissions: access.permissions,
      iceServers: await iceServers(),
    };
  }

  /**
   * How the agent should try to reach the controller.
   *
   * The same list the controller got, and for the same reason it is a list
   * rather than an address: neither end is told where the other is. They
   * exchange candidates and ICE settles it.
   */
  async agentIceServers(): Promise<IceServer[]> {
    return iceServers();
  }

  async endSession(sessionId: string, reason: string): Promise<void> {
    const session = await prisma.remoteSession.findUnique({
      where: { id: sessionId },
      select: { id: true, machineId: true, userId: true, endedAt: true },
    });
    if (!session || session.endedAt) return;

    await prisma.remoteSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date(), endedReason: reason },
    });
    await recordRemoteAudit({
      machineId: session.machineId,
      actorId: session.userId,
      sessionId,
      action: 'session.ended',
      detail: { reason },
    });
  }

  /**
   * Ends a session on somebody's behalf, checking they are entitled to: the
   * controller holding it, or whoever administers the machine. A stranger with
   * a session id gets the same 404 they would get for a machine id.
   */
  async endSessionFor(userId: string, sessionId: string, reason: string): Promise<void> {
    const session = await prisma.remoteSession.findUnique({
      where: { id: sessionId },
      select: { id: true, machineId: true, userId: true, endedAt: true },
    });
    if (!session) {
      throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Session not found' });
    }

    if (session.userId !== userId) {
      const access = await resolveRemoteAccess(userId, session.machineId);
      const mayAdminister =
        access !== null && (access.isOwner || access.permissions.includes(PERMISSIONS.REMOTE_ADMIN));
      if (!mayAdminister) {
        throw new NotFoundException({ code: 'SESSION_NOT_FOUND', message: 'Session not found' });
      }
    }

    if (session.endedAt) return;
    await this.endSession(sessionId, reason);
    await this.onSessionEnded(sessionId, reason);
  }

  /** Set by the module so ending over HTTP also drops the live sockets. */
  onSessionEnded: (sessionId: string, reason: string) => Promise<void> = async () => undefined;

  /** The machine's own history. Owner or a delegated administrator only. */
  async audit(userId: string, machineId: string, limit = 100): Promise<RemoteAuditEntry[]> {
    await this.requireAdmin(userId, machineId);
    const rows = await prisma.remoteAudit.findMany({
      where: { machineId },
      include: { actor: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      actorUsername: row.actor?.username ?? null,
      sessionId: row.sessionId,
      detail: (row.detail ?? null) as Record<string, unknown> | null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // --- Agent credentials ----------------------------------------------------

  /**
   * Resolves the token an agent presents on its socket. Compared in constant
   * time against every candidate hash: a token is a bearer credential, and how
   * long a comparison took should not narrow it down.
   */
  async machineForAgentToken(token: string): Promise<{ id: string; ownerId: string } | null> {
    if (!token) return null;
    const hash = hashToken(token);
    const candidates = await prisma.remoteMachine.findMany({
      select: { id: true, ownerId: true, agentTokenHash: true },
    });

    let found: { id: string; ownerId: string } | null = null;
    for (const candidate of candidates) {
      if (safeEqual(candidate.agentTokenHash, hash)) {
        found = { id: candidate.id, ownerId: candidate.ownerId };
      }
    }
    return found;
  }

  async touchMachine(machineId: string): Promise<void> {
    await prisma.remoteMachine
      .update({ where: { id: machineId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  // --- Shared -------------------------------------------------------------

  private async requireAccess(userId: string, machineId: string): Promise<RemoteAccess> {
    const access = await resolveRemoteAccess(userId, machineId);
    // 404 rather than 403: a stranger must not learn the machine exists.
    if (!access) {
      throw new NotFoundException({ code: 'MACHINE_NOT_FOUND', message: 'Machine not found' });
    }
    return access;
  }

  private async requireAdmin(userId: string, machineId: string): Promise<RemoteAccess> {
    const access = await this.requireAccess(userId, machineId);
    if (!access.isOwner && !access.permissions.includes(PERMISSIONS.REMOTE_ADMIN)) {
      throw new ForbiddenException({
        code: 'REMOTE_ADMIN_REQUIRED',
        message: 'You cannot administer this machine',
      });
    }
    return access;
  }

  private async summarise(machineId: string, userId: string): Promise<RemoteMachineSummary> {
    const list = await this.machines(userId);
    const found = list.find((machine) => machine.id === machineId);
    if (!found) {
      throw new NotFoundException({ code: 'MACHINE_NOT_FOUND', message: 'Machine not found' });
    }
    return found;
  }

}

const REMOTE_ALL: RemotePermission[] = [
  PERMISSIONS.REMOTE_VIEW,
  PERMISSIONS.REMOTE_CONTROL,
  PERMISSIONS.REMOTE_FILE_TRANSFER,
  PERMISSIONS.REMOTE_CLIPBOARD,
  PERMISSIONS.REMOTE_AUDIO,
  PERMISSIONS.REMOTE_ADMIN,
];

// There was a `roomName` and a `livekitUrl` here, and the second one threw
// `LIVEKIT_UNREACHABLE_URL` when a deployment advertised a media server address
// only the server itself could reach. Both are gone with the media server: no
// client is told where to connect any more, so there is no address that can be
// wrong for it.

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parseExpiry(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({ code: 'BAD_EXPIRY', message: 'That is not a date' });
  }
  if (date.getTime() <= Date.now()) {
    throw new BadRequestException({
      code: 'EXPIRY_IN_PAST',
      message: 'An expiry in the past would grant nothing',
    });
  }
  return date;
}
