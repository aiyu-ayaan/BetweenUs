/**
 * Transport-neutral WebSocket helpers shared by realtime gateways.
 * No channel/presence business logic lives here.
 */
import type { IncomingMessage } from 'node:http';
import { bearerToken, verifyAccessToken } from '@nexora/auth';
import type { AuthenticatedUser } from '@nexora/auth';

/**
 * Authenticates a WebSocket handshake.
 *
 * Accepts the token from `Authorization: Bearer`, the `token` query parameter,
 * or the `Sec-WebSocket-Protocol` header - browsers cannot set custom headers
 * on a WebSocket handshake, so a query parameter is the practical fallback.
 * Returns null when the handshake is not authenticated; callers must close the
 * socket rather than downgrade to anonymous.
 */
export function authenticateHandshake(request: IncomingMessage): AuthenticatedUser | null {
  const token = extractHandshakeToken(request);
  if (!token) return null;

  try {
    const payload = verifyAccessToken(token);
    return { id: payload.sub, email: payload.email, username: payload.username };
  } catch {
    return null;
  }
}

export function extractHandshakeToken(request: IncomingMessage): string | null {
  const header = bearerToken(request.headers.authorization);
  if (header) return header;

  const protocol = request.headers['sec-websocket-protocol'];
  if (typeof protocol === 'string') {
    const parts = protocol.split(',').map((part) => part.trim());
    const index = parts.indexOf('bearer');
    const candidate = index >= 0 ? parts[index + 1] : undefined;
    if (candidate) return candidate;
  }

  const url = new URL(request.url ?? '/', 'http://localhost');
  return url.searchParams.get('token');
}

/** Rooms are just string keys (`channel:<id>`); membership lives in memory per instance. */
export class RoomRegistry<TSocket> {
  private readonly rooms = new Map<string, Set<TSocket>>();
  private readonly socketRooms = new Map<TSocket, Set<string>>();

  join(room: string, socket: TSocket): void {
    let members = this.rooms.get(room);
    if (!members) {
      members = new Set();
      this.rooms.set(room, members);
    }
    members.add(socket);

    let joined = this.socketRooms.get(socket);
    if (!joined) {
      joined = new Set();
      this.socketRooms.set(socket, joined);
    }
    joined.add(room);
  }

  leave(room: string, socket: TSocket): void {
    const members = this.rooms.get(room);
    if (members) {
      members.delete(socket);
      if (members.size === 0) this.rooms.delete(room);
    }
    this.socketRooms.get(socket)?.delete(room);
  }

  /** Removes a socket from every room it joined. Call on disconnect. */
  leaveAll(socket: TSocket): void {
    const joined = this.socketRooms.get(socket);
    if (!joined) return;
    for (const room of joined) {
      const members = this.rooms.get(room);
      if (!members) continue;
      members.delete(socket);
      if (members.size === 0) this.rooms.delete(room);
    }
    this.socketRooms.delete(socket);
  }

  members(room: string): TSocket[] {
    return [...(this.rooms.get(room) ?? [])];
  }

  roomsOf(socket: TSocket): string[] {
    return [...(this.socketRooms.get(socket) ?? [])];
  }

  get size(): number {
    return this.rooms.size;
  }
}

export const channelRoom = (channelId: string): string => `channel:${channelId}`;
export const userRoom = (userId: string): string => `user:${userId}`;
