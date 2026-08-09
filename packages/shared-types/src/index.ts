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
  /** Storage URL of an uploaded picture; null clears it back to the initial. */
  avatarUrl?: string | null;
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

/**
 * Adds someone to a server directly, by the username they can be told. The
 * alternative - handing out the slug and waiting - cannot be done from the
 * members screen, which is where an administrator is already standing.
 */
export interface AddServerMemberRequest {
  username: string;
}

/** Every field is optional; only what is sent is changed. */
export interface UpdateServerMemberRequest {
  role?: ServerRole;
  grantedPermissions?: string[];
  deniedPermissions?: string[];
}

// --- Channels ---

export type ChannelType = 'TEXT' | 'VOICE' | 'DM';

export interface Channel {
  id: string;
  /** Null for a direct message, which belongs to its two participants. */
  serverId: string | null;
  name: string;
  type: ChannelType;
  topic: string | null;
  /** Visible only to the users on its allowlist - see `ChannelMember`. */
  isPrivate: boolean;
  createdAt: string;
}

export interface CreateChannelRequest {
  serverId: string;
  name: string;
  type?: ChannelType;
  isPrivate?: boolean;
  /**
   * Who may see a private channel. The creator is always added, so an empty
   * list makes a channel only its creator can open.
   */
  memberIds?: string[];
}

export interface UpdateChannelRequest {
  name?: string;
  topic?: string | null;
}

/** One user allowed into a private channel. */
export interface ChannelMember {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  addedAt: string;
}

/**
 * Replaces the allowlist wholesale. The caller is always kept on it, because
 * removing yourself from a private channel you are editing locks you out of the
 * screen you are standing on.
 */
export interface SetChannelMembersRequest {
  userIds: string[];
}

// --- Friends and direct messages ---

/** The public face of an account: what a search result or a DM header shows. */
export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export type FriendshipStatus = 'PENDING' | 'ACCEPTED';

export interface Friend {
  user: UserSummary;
  status: FriendshipStatus;
  /**
   * Who asked, seen from the caller's side. Null once the friendship is
   * accepted - by then it does not matter, and the UI stops asking.
   */
  direction: 'incoming' | 'outgoing' | null;
  since: string;
}

export interface SendFriendRequestRequest {
  /** Username rather than id: it is what the person can actually be told. */
  username: string;
}

/** A direct message channel, named by the person on the other end of it. */
export interface DirectChannel {
  channelId: string;
  participant: UserSummary;
  createdAt: string;
}

export interface OpenDirectChannelRequest {
  userId: string;
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

/**
 * What an avatar or a server icon URL is allowed to look like. It has to be an
 * object this deployment stored: a picture renders in every client that can see
 * the account or the server, so an arbitrary URL would be a beacon reporting
 * back who looked at it, and an http one would be a mixed-content warning too.
 *
 * Either a path served by a service (`/api/v1/uploads/pictures/...`) or an
 * https bucket URL - the operator chooses the host, so the check is on the
 * shape and on the `pictures/` prefix the upload route generates.
 */
export const UPLOADED_PICTURE_URL = /^(\/|https:\/\/)[^\s]*\/pictures\/[^\s]+$/;

// --- Attachments ---
//
// An attachment is a file encrypted under the channel key and uploaded on its
// own; what identifies it - the name, the real content type, the nonce that
// opens it - travels inside the encrypted message body, never as a column. The
// server therefore stores an opaque blob and a ciphertext, and knows neither
// what the file is called nor what it contains.

/** What the upload routes answer with, whatever driver stored the bytes. */
export interface UploadedObject {
  key: string;
  size: number;
  contentType: string;
  url: string;
}

/** Opened by `POST /uploads/multipart`; the ticket is the whole session. */
export interface StartMultipartResponse {
  ticket: string;
  /** Largest body one part may have, so the client can size its chunks. */
  maxPartBytes: number;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface MessageAttachment {
  /** Storage key of the ciphertext. */
  key: string;
  /** Where the ciphertext is fetched from. */
  url: string;
  /** The name the sender's file had. */
  name: string;
  /** The real content type, once decrypted. */
  contentType: string;
  /** Plaintext size in bytes, before encryption. */
  size: number;
  /** Base64 AES-GCM nonce for the file itself. */
  iv: string;
  /** Channel-key generation the file was sealed under. */
  epoch: number;
  /** Set when the plaintext was gzipped before it was encrypted. */
  gzip?: boolean;
  /** Pixel size of an image, so the layout can be reserved before it loads. */
  width?: number;
  height?: number;
  /** Set when the client turned an over-long message into this text file. */
  overflow?: boolean;
}

/**
 * The plaintext inside `Message.content` once a message carries files. A
 * message with no attachments is still encoded as bare text, so everything
 * written before attachments existed keeps rendering.
 */
export interface MessageBody {
  text: string;
  attachments: MessageAttachment[];
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

/**
 * What a user chose to appear as. `offline` is not choosable - it is what a
 * disconnected client, or an invisible one, looks like to everybody else.
 */
export type ActiveStatus = 'online' | 'idle' | 'dnd' | 'invisible';

export type PresenceStatus = ActiveStatus | 'offline';

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
  | { type: 'status.set'; status: ActiveStatus }
  | { type: 'typing.start'; channelId: string }
  | { type: 'voice.join'; channelId: string }
  | { type: 'voice.leave'; channelId: string }
  | { type: 'ping' };

export type ServerPresenceEvent =
  | { type: 'ready'; userId: string }
  /**
   * The caller's own status, as chosen - the only place `invisible` is ever
   * sent, because everyone else is told `offline` instead.
   */
  | { type: 'status.self'; status: ActiveStatus }
  /** Full snapshot on connect, then deltas. */
  | { type: 'presence.sync'; users: PresenceState[]; voice: VoiceState[] }
  | { type: 'presence.changed'; user: PresenceState }
  | { type: 'typing'; channelId: string; userId: string; username: string }
  | { type: 'voice.changed'; voice: VoiceState }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string };

// --- Notifications ---

/**
 * Notification preferences, owned by the account rather than the client, so a
 * mute set on one machine holds on the next one.
 */
export interface NotificationPreferences {
  enabled: boolean;
  /**
   * Quiet hours as minutes from midnight on the client's own clock (so the
   * server needs no timezone). Null on either end means no quiet hours; a
   * window may wrap midnight - start 1320, end 480 is 22:00 to 08:00.
   */
  quietStartMinute: number | null;
  quietEndMinute: number | null;
  mutedChannelIds: string[];
}

export interface UpdateNotificationPreferencesRequest {
  enabled?: boolean;
  quietStartMinute?: number | null;
  quietEndMinute?: number | null;
  /** Replaces the whole list; send the list you want, not a delta. */
  mutedChannelIds?: string[];
}

/** Messages a user has not read in one channel, derived from the read marker. */
export interface ChannelUnread {
  channelId: string;
  count: number;
  lastReadAt: string | null;
}

/** "I am looking at this channel now" - the marker is always the current time. */
export interface MarkChannelReadRequest {
  channelId: string;
}

// --- Chat WebSocket protocol (/ws/chat) ---

export type ClientChatEvent =
  | { type: 'channel.subscribe'; channelId: string }
  | { type: 'channel.unsubscribe'; channelId: string }
  /**
   * Membership changes are server-wide, not channel-wide, so a socket says
   * which servers it is watching. Membership is re-checked on every subscribe.
   */
  | { type: 'server.subscribe'; serverId: string }
  | { type: 'server.unsubscribe'; serverId: string }
  | { type: 'ping' };

/**
 * Two shapes of server event: one carries what changed, the other only says
 * that something did. A message is carried because the client has to render it
 * without a round trip; a friendship or a member list is announced, because the
 * list is small, the change is rare, and refetching it is one call rather than
 * a per-recipient payload the server would have to compose twice.
 */
export type ServerChatEvent =
  | { type: 'ready'; userId: string }
  | { type: 'message.created'; message: Message }
  | { type: 'message.deleted'; messageId: string; channelId: string }
  /** Sent to both sides of a request, an acceptance or a removal. */
  | { type: 'friends.changed' }
  /** Sent to everyone watching the server, and to whoever joined or left it. */
  | { type: 'server.members.changed'; serverId: string }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string };

// --- Health ---

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  uptime: number;
}
