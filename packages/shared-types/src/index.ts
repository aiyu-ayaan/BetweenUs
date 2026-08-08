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

export type GlobalRole = 'USER' | 'ADMIN';

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** Platform role, not server membership. ADMIN unlocks the admin panel. */
  role: GlobalRole;
  /** True for an account issued a generated password; it can do nothing else. */
  mustChangePassword: boolean;
  createdAt: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateAccountRequest {
  username?: string;
  displayName?: string;
}

// --- OAuth login ---

/** Providers the operator has switched on, as the login screen sees them. */
export interface OAuthProviderSummary {
  provider: 'google' | 'github';
  label: string;
}

export interface OAuthExchangeRequest {
  /** One-time code handed to the loopback redirect after the provider callback. */
  code: string;
}

// --- Admin panel ---

export interface AdminStatus {
  /** False until `pnpm admin:create` has been run; the panel explains that. */
  hasAdmin: boolean;
}

export interface AdminUser extends PublicUser {
  disabledAt: string | null;
  /** Providers this account can also sign in with. */
  identities: string[];
  serverCount: number;
  lastSeenAt: string | null;
}

export interface AdminUserUpdate {
  role?: GlobalRole;
  disabled?: boolean;
}

/** Never carries the secret itself - only whether one is stored. */
export interface AdminOAuthProvider {
  provider: 'google' | 'github';
  label: string;
  enabled: boolean;
  clientId: string;
  hasSecret: boolean;
  /** What to paste into the provider's console as the authorised callback. */
  callbackUrl: string;
}

export interface AdminOAuthProviderUpdate {
  enabled: boolean;
  clientId: string;
  /** Omitted means "keep the stored secret"; a value replaces it. */
  clientSecret?: string;
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

// --- Servers ---

export type ServerRole = 'OWNER' | 'ADMIN' | 'MODERATOR' | 'MEMBER' | 'GUEST';

export interface Server {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: string;
}

export interface ServerWithRole extends Server {
  role: ServerRole;
  /** What the caller may do here, role defaults and overrides already applied. */
  permissions: string[];
}

export interface CreateServerRequest {
  name: string;
}

export interface UpdateServerRequest {
  name?: string;
  iconUrl?: string | null;
}

export interface ServerMember {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: ServerRole;
  /** Effective permissions: the role's defaults plus grants, minus denials. */
  permissions: string[];
  /** Held beyond the role. Shown as the toggles an administrator switched on. */
  grantedPermissions: string[];
  /** Withheld despite the role. Deny wins over grant. */
  deniedPermissions: string[];
  joinedAt: string;
}

/** Every field is optional; only what is sent is changed. */
export interface UpdateServerMemberRequest {
  role?: ServerRole;
  grantedPermissions?: string[];
  deniedPermissions?: string[];
}

// --- Channels ---

export type ChannelType = 'TEXT' | 'VOICE';

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  topic: string | null;
  createdAt: string;
}

export interface CreateChannelRequest {
  serverId: string;
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

// --- End-to-end encryption ---
//
// The server stores and routes only the ciphertext shapes below. Key material
// exists in plaintext exclusively inside a client. See development/E2EE.md.

/** What a client actually puts in `Message.content`. */
export interface EncryptedEnvelope {
  /** Envelope version, so a future format change stays readable. */
  v: 1;
  /** Which channel-key generation encrypted this. */
  epoch: number;
  /** Base64 AES-GCM nonce (12 bytes). */
  iv: string;
  /** Base64 AES-GCM ciphertext with appended tag. */
  ct: string;
}

/** A user's published ECDH P-256 public key, JWK-serialised. */
export interface DeviceKey {
  userId: string;
  publicKey: string;
}

export interface RegisterDeviceKeyRequest {
  publicKey: string;
}

/** One channel key sealed for one recipient. */
export interface ChannelKeyEntry {
  recipientUserId: string;
  senderUserId: string;
  /** Sender's ECDH public key (JWK) - the recipient needs it to derive the secret. */
  senderPublicKey: string;
  wrappedKey: string;
  iv: string;
}

export interface PublishChannelKeysRequest {
  channelId: string;
  epoch: number;
  entries: Array<Omit<ChannelKeyEntry, 'senderUserId'>>;
}

export interface ChannelKeysResponse {
  channelId: string;
  /** Highest epoch that exists for this channel, 0 when the channel has no key yet. */
  epoch: number;
  /** Entries addressed to the caller, oldest epoch first. */
  keys: Array<ChannelKeyEntry & { epoch: number }>;
  /** Channel members with a device key but no entry at `epoch` - they need a re-wrap. */
  missingRecipients: DeviceKey[];
}

// --- Calls ---

export interface CallTokenRequest {
  channelId: string;
}

export interface CallTokenResponse {
  /** LiveKit server URL the client dials directly - media never touches NestJS. */
  url: string;
  token: string;
  room: string;
  identity: string;
}

// --- Presence ---

export type PresenceStatus = 'online' | 'idle' | 'offline';

export interface PresenceState {
  userId: string;
  status: PresenceStatus;
}

/** Who is currently connected to a voice channel's room. */
export interface VoiceState {
  channelId: string;
  userIds: string[];
}

// --- Presence WebSocket protocol (/ws/presence) ---

export type ClientPresenceEvent =
  | { type: 'typing.start'; channelId: string }
  | { type: 'voice.join'; channelId: string }
  | { type: 'voice.leave'; channelId: string }
  | { type: 'ping' };

export type ServerPresenceEvent =
  | { type: 'ready'; userId: string }
  /** Full snapshot on connect, then deltas. */
  | { type: 'presence.sync'; users: PresenceState[]; voice: VoiceState[] }
  | { type: 'presence.changed'; user: PresenceState }
  | { type: 'typing'; channelId: string; userId: string; username: string }
  | { type: 'voice.changed'; voice: VoiceState }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string };

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
