/**
 * Transport-neutral WebSocket helpers shared by realtime gateways.
 * No channel/presence business logic lives here.
 */
import type { IncomingMessage } from 'node:http';
import { bearerToken, verifyAccessToken } from '@betweenus/auth';
import type { AuthenticatedUser } from '@betweenus/auth';
import { EVENTS, type EventBus } from '@betweenus/events';

/**
 * The largest frame a gateway will read before closing the socket.
 *
 * `ws` defaults to 100 MB, and a signed-in client that sends 100 MB of nothing
 * has it buffered in the service's heap before a single line of gateway code
 * runs. Nothing here carries a payload anywhere near these numbers - the ones
 * that carry bulk carry it over a peer connection instead - so the cap is set
 * to what the traffic actually is.
 *
 * `SIGNAL_MAX_PAYLOAD` is the roomier of the two because an SDP grows with the
 * codecs and candidates a machine offers, and because a remote session's
 * clipboard is a person's selection rather than a protocol field.
 */
export const CONTROL_MAX_PAYLOAD = 64 * 1024;
export const SIGNAL_MAX_PAYLOAD = 256 * 1024;

/**
 * Who opened a socket, and when the token that opened it was minted.
 *
 * `issuedAt` is the JWT's own `iat`, in seconds, and it is here for one reason:
 * a socket is authenticated once at the handshake and then trusted for as long
 * as it stays open. `dropRevokedSockets` needs to know how old that trust is to
 * decide whether a revocation reaches it.
 *
 * Zero when the token carried no `iat`, which makes such a socket older than
 * every revocation line and therefore always droppable. That is the safe way
 * round: a token this cannot date is a token this cannot vouch for.
 */
export interface HandshakeIdentity extends AuthenticatedUser {
  issuedAt: number;
}

/**
 * Authenticates a WebSocket handshake.
 *
 * Accepts the token from `Authorization: Bearer`, the `token` query parameter,
 * or the `Sec-WebSocket-Protocol` header - browsers cannot set custom headers
 * on a WebSocket handshake, so a query parameter is the practical fallback.
 * Returns null when the handshake is not authenticated; callers must close the
 * socket rather than downgrade to anonymous.
 */
export function authenticateHandshake(request: IncomingMessage): HandshakeIdentity | null {
  const token = extractHandshakeToken(request);
  if (!token) return null;

  try {
    const payload = verifyAccessToken(token);
    return {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
      issuedAt: payload.iat ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * The close code a gateway uses when an account's authority was withdrawn under
 * a socket that was already open.
 *
 * In the application range, and distinct from 4401 (the handshake was never
 * authenticated) because the client does something different with each: 4401 is
 * "get a token", this is "your session is over, do not reconnect with what you
 * have". Reconnecting with the same access token would succeed - it is still
 * signed and still unexpired - which is exactly the hole this closes, so a
 * client that treats this as a transient disconnect and retries is a client
 * that undoes the revocation.
 */
export const SOCKET_REVOKED_CLOSE = 4403;

/**
 * Closes the sockets of an account whose authority has been withdrawn.
 *
 * Subscribes once, on behalf of one gateway. The gateway supplies the sockets
 * it holds for that account and how old each one's token is; everything else -
 * which line to draw, what to close with - is the same in all four and lives
 * here rather than four times over.
 *
 * `socketsFor` is called with the account id and returns that account's sockets
 * on this instance. Every instance receives the event and answers for its own,
 * which is what makes this work without sticky sessions.
 */
export async function dropRevokedSockets<TSocket>(
  events: EventBus,
  socketsFor: (userId: string) => Iterable<TSocket>,
  issuedAtOf: (socket: TSocket) => number | undefined,
  close: (socket: TSocket, code: number, reason: string) => void,
  onDropped?: (userId: string, count: number, reason: string) => void,
): Promise<void> {
  await events.subscribe(EVENTS.SESSION_REVOKED, (envelope) => {
    const { userId, notBefore, reason } = envelope.payload;
    let dropped = 0;
    for (const socket of socketsFor(userId)) {
      // Strictly before. A token minted in the same second as the revocation is
      // the replacement pair handed to whoever performed it - the person
      // changing their own password - and dropping it would mean the one action
      // that is supposed to keep you signed in signs you out.
      if ((issuedAtOf(socket) ?? 0) >= notBefore) continue;
      close(socket, SOCKET_REVOKED_CLOSE, 'Session revoked');
      dropped += 1;
    }
    if (dropped > 0) onDropped?.(userId, dropped, reason);
  });
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
export const serverRoom = (serverId: string): string => `server:${serverId}`;
