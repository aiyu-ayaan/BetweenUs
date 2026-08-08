/**
 * API and realtime contracts shared by every service and client.
 * No runtime logic, no service-specific business rules.
 */

// --- Common ---

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export interface Paginated<T> {
  items: T[];
  /** Cursor to pass as `before` for the next (older) page. Null when exhausted. */
  nextCursor: string | null;
}

// --- Auth ---

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

/** Decoded access-token payload. Services trust this only after signature check. */
export interface JwtAccessPayload {
  sub: string;
  email: string;
  username: string;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  jti: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}

// --- Workspaces ---

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER' | 'GUEST';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: WorkspaceRole;
}

export interface CreateWorkspaceRequest {
  name: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  joinedAt: string;
}

// --- Channels ---

export type ChannelType = 'TEXT' | 'VOICE';

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  createdAt: string;
}

export interface CreateChannelRequest {
  workspaceId: string;
  name: string;
  type?: ChannelType;
}

// --- Messages ---

export interface MessageAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Message {
  id: string;
  channelId: string;
  content: string;
  author: MessageAuthor;
  createdAt: string;
  editedAt: string | null;
}

export interface CreateMessageRequest {
  channelId: string;
  content: string;
}

// --- Chat WebSocket protocol (/ws/chat) ---

export type ClientChatEvent =
  | { type: 'channel.subscribe'; channelId: string }
  | { type: 'channel.unsubscribe'; channelId: string }
  | { type: 'ping' };

export type ServerChatEvent =
  | { type: 'ready'; userId: string }
  | { type: 'message.created'; message: Message }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string };

// --- Health ---

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  uptime: number;
}
