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

/**
 * One page of the directory, plus where the next one starts.
 *
 * A cursor rather than an offset: the list is ordered newest first and
 * registrations keep arriving, so paging by offset would show the same account
 * twice - once on page one, once again on page two after it was pushed down.
 */
export interface AdminUserPage {
  users: AdminUser[];
  /** Opaque; pass it back as `cursor`. Null when this was the last page. */
  nextCursor: string | null;
}

export interface AdminUserUpdate {
  role?: GlobalRole;
  disabled?: boolean;
}

/** One thing an administrator did. Append-only; nothing edits or deletes it. */
export interface AdminAuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  /** How the actor read at the time; null once their account is gone. */
  actorLabel: string | null;
  targetId: string | null;
  /** The subject as it read when it happened - it may not exist any more. */
  targetLabel: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminAuditPage {
  entries: AdminAuditEntry[];
  nextCursor: string | null;
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

/** An invite as whoever manages the server sees it. */
export interface ServerInvite {
  code: string;
  serverId: string;
  createdById: string | null;
  /** Null for an invite with no expiry - a choice, not the only option. */
  expiresAt: string | null;
  /** Null for unlimited. */
  maxUses: number | null;
  uses: number;
  revokedAt: string | null;
  createdAt: string;
  /**
   * Whether it would work right now. Derived, so a client never has to
   * re-implement "expired or revoked or spent" and get one of the three wrong.
   */
  active: boolean;
}

export interface CreateServerInviteRequest {
  /** Null or absent for an invite that never expires. */
  expiresInHours?: number | null;
  /** Null or absent for unlimited uses. */
  maxUses?: number | null;
}

export interface JoinServerRequest {
  /** An invite code. The server's slug is not one, and no longer opens a door. */
  code: string;
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
  /** Ids of the custom roles this member holds, highest rank first. */
  roleIds: string[];
  /** From the highest-ranked custom role that has one; null if none does. */
  colour: string | null;
  joinedAt: string;
}

/**
 * A role a server invented for itself.
 *
 * Additive on top of the five built-in `ServerRole` rungs rather than replacing
 * them: the built-ins are the hierarchy - who may edit whom, who may hand out
 * what - and a hierarchy anyone can extend is a hierarchy anyone can climb.
 */
export interface ServerCustomRole {
  id: string;
  serverId: string;
  name: string;
  /** `#rrggbb`, or null for the default colour. */
  colour: string | null;
  /** Higher is further up the list. Ordering only; it grants nothing. */
  rank: number;
  permissions: string[];
  /** How many members hold it. */
  memberCount: number;
}

export interface CreateServerRoleRequest {
  name: string;
  colour?: string | null;
  rank?: number;
  permissions?: string[];
}

/** Every field is optional; only what is sent is changed. */
export type UpdateServerRoleRequest = Partial<CreateServerRoleRequest>;

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
  /** Replaces the whole set of custom roles this member holds. */
  roleIds?: string[];
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
  /**
   * Set once the message is deleted. The row survives as a tombstone with an
   * empty body, so a conversation reads as "this was here and is gone" instead
   * of silently re-flowing around a hole.
   */
  deletedAt: string | null;
  /** Whoever deleted it, when that was not the author. */
  deletedBy: MessageAuthor | null;
  pinnedAt: string | null;
  /** One entry per distinct emoji. */
  reactions: MessageReactionSummary[];
}

/**
 * One emoji on one message, grouped across the people who chose it.
 *
 * It carries the user ids rather than a count and a "mine" flag, because the
 * same object is broadcast to everyone: a flag computed for whoever caused the
 * change would be wrong for every other recipient. The client counts the list
 * and looks for itself in it.
 */
export interface MessageReactionSummary {
  emoji: string;
  userIds: string[];
}

export interface CreateMessageRequest {
  channelId: string;
  content: string;
  /**
   * Storage keys of the blobs this message carries, so the server can tie them
   * to it and remove them when it is deleted. The manifest that names them is
   * inside `content` and unreadable to any service, so a client that wants its
   * files swept has to say which they are; the keys alone reveal nothing the
   * upload route did not already know.
   */
  attachmentKeys?: string[];
}

/** Replaces the body; the author only, and it stamps `editedAt`. */
export interface UpdateMessageRequest {
  content: string;
}

/** Emoji as a literal character (or a short sequence), never a shortcode. */
export interface ReactToMessageRequest {
  emoji: string;
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
 * What a message is a reply to.
 *
 * The author and a snippet are copied in rather than looked up, and that is
 * deliberate on two counts. The quoted message may be a thousand messages back
 * and not on this device at all - a reply has to render without fetching
 * anything. And it lives inside the encrypted body, so the server learns
 * nothing about who is answering whom: a reply is an ordinary message to it.
 *
 * The consequence is that a quote is a snapshot. Editing the quoted message
 * does not rewrite the quotes of it, which is the same thing every chat app
 * does and is honest about what was being answered at the time.
 */
export interface MessageReply {
  /** The message being replied to, for the jump-to-it click. */
  id: string;
  /** Who wrote it, as they were named when the reply was sent. */
  author: string;
  /** The first line or so of it. Empty for a message that was only files. */
  preview: string;
}

/**
 * The plaintext inside `Message.content` once a message carries more than
 * text. A message that is only text is still encoded as bare text, so
 * everything written before this existed keeps rendering.
 */
export interface MessageBody {
  text: string;
  attachments: MessageAttachment[];
  replyTo?: MessageReply;
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
/**
 * One machine's public identity key.
 *
 * A list per user rather than one key per account. The single key was copied to
 * every machine the account signed in on, which made "revoke this laptop" mean
 * "rotate the identity every other machine is also using" - so nobody could,
 * and a key that cannot be revoked is a key that is trusted forever.
 */
export interface DeviceKey {
  userId: string;
  /** Client-minted and stable for an installation. */
  deviceId: string;
  publicKey: string;
  /** What to call it in a list. Client-supplied, and not to be trusted as identity. */
  label: string | null;
  /** Set once the owner revoked it. Nothing is ever wrapped for a revoked device. */
  revokedAt: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export interface RegisterDeviceKeyRequest {
  deviceId: string;
  publicKey: string;
  label?: string;
}

/** One channel key sealed for one device. */
export interface ChannelKeyEntry {
  recipientUserId: string;
  /** Which of that user's devices this copy is for. */
  recipientDeviceId: string;
  senderUserId: string;
  senderDeviceId: string;
  /** Sender's ECDH public key (JWK) - the recipient needs it to derive the secret. */
  senderPublicKey: string;
  wrappedKey: string;
  iv: string;
}

export interface PublishChannelKeysRequest {
  channelId: string;
  epoch: number;
  /** Which device did the sealing. Every entry in the bundle came from it. */
  senderDeviceId: string;
  entries: Array<Omit<ChannelKeyEntry, 'senderUserId' | 'senderDeviceId'>>;
}

export interface ChannelKeysResponse {
  channelId: string;
  /** Highest epoch that exists for this channel, 0 when the channel has no key yet. */
  epoch: number;
  /** Entries addressed to the caller, oldest epoch first. */
  keys: Array<ChannelKeyEntry & { epoch: number }>;
  /**
   * Devices with a published key and no entry at `epoch` - each needs a
   * re-wrap. One entry per device, not per person: somebody who signed in on a
   * second machine yesterday is missing exactly one of their two.
   */
  missingRecipients: DeviceKey[];
  /**
   * True when somebody who is no longer a member holds the current epoch's key.
   *
   * Removing somebody from a private channel's allowlist takes away the listing
   * and the history endpoint, and takes away nothing at all from the key they
   * already have: every future message would still be sealed with a key sitting
   * on their machine. Whoever holds the key rotates it when they see this, which
   * is the only place it can happen - the server cannot mint a key it must not
   * be able to read.
   *
   * It says nothing about *who*: a client re-wraps for the current membership,
   * which it has to fetch anyway.
   */
  rekeyNeeded: boolean;
}

/**
 * What secret opens an identity backup.
 *
 * `password` is the account password, so signing in on a new device restores
 * the identity with no extra step. `passphrase` is a separate secret the user
 * set themselves - the only option for an account that signs in with a
 * provider and has no password to derive from.
 */
export type BackupSecretKind = 'password' | 'passphrase';

/**
 * The device identity key, sealed with a key derived from a secret the server
 * never receives. Restoring it on a second machine is what makes the account
 * (and its history) portable instead of tied to one installation.
 */
export interface IdentityBackup {
  /** Format version of the sealed blob. */
  v: 1;
  kind: BackupSecretKind;
  /** Only `PBKDF2-SHA256` today; named so a stronger KDF can be added later. */
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** Base64 KDF salt (16 bytes). */
  salt: string;
  /** Base64 AES-GCM nonce (12 bytes). */
  iv: string;
  /** Base64 AES-GCM ciphertext of the identity key pair, with tag. */
  ct: string;
  /**
   * The identity's public half, in the clear. It is public by definition, and
   * having it lets a client tell "this backup is for the key the directory
   * already knows" from "this backup is stale" before asking for a secret.
   */
  publicKey: string;
  updatedAt?: string;
}

export type PutIdentityBackupRequest = Omit<IdentityBackup, 'updatedAt'>;

export interface IdentityBackupResponse {
  /** `null` when this account has never uploaded one. */
  backup: IdentityBackup | null;
}

// --- Calls ---

export interface CallIceRequest {
  channelId: string;
}

/**
 * How to find a path to the other peer. Deliberately not "where the media
 * server is": there is no media server, and no client is ever told to dial one.
 */
export interface CallIceResponse {
  /**
   * STUN first, then TURN when the deployment configures one.
   *
   * STUN is address discovery, not a relay: a peer asks what its own public
   * address looks like and offers that to the other side. TURN *is* a relay,
   * for the pairs of networks - symmetric NAT, carrier-grade NAT - that cannot
   * form a direct path at all; a deployment with none configured gets STUN
   * alone and those calls fail rather than being quietly relayed.
   */
  iceServers: IceServer[];
}

/** One entry of a WebRTC `RTCConfiguration.iceServers`. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * Somebody else in the call.
 *
 * Keyed by `peerId`, not `userId`: one account can have two windows open, and
 * each is a separate end of a separate peer connection.
 */
export interface CallPeer {
  peerId: string;
  userId: string;
  username: string;
}

/** A plain `RTCIceCandidateInit`, spelled out so Node can name the type too. */
export interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/**
 * What one peer sends another. `call-service` relays these without reading
 * them - it stamps who they came from and forwards the rest verbatim.
 *
 * `fingerprintProof` is `HMAC-SHA256(channel key, the DTLS fingerprint in this
 * SDP)`, base64. It is what stops the relay from substituting a fingerprint of
 * its own and sitting in the middle of a connection both ends believe is
 * direct: the server has never held a channel key, so it cannot produce one.
 */
export type CallSignal =
  | { kind: 'offer'; sdp: string; fingerprintProof: string }
  | { kind: 'answer'; sdp: string; fingerprintProof: string }
  | { kind: 'ice'; candidate: IceCandidatePayload };

export type ClientCallEvent =
  | { type: 'join'; channelId: string }
  | { type: 'leave' }
  | { type: 'signal'; to: string; data: CallSignal }
  | { type: 'ping' };

export type ServerCallEvent =
  | { type: 'ready'; peerId: string }
  | { type: 'joined'; channelId: string; peers: CallPeer[] }
  | { type: 'peer.joined'; peer: CallPeer }
  | { type: 'peer.left'; peerId: string }
  | { type: 'signal'; from: string; data: CallSignal }
  /**
   * This account joined a call from somewhere else, so this connection is no
   * longer the one carrying it. One call per account across every device, which
   * is what stops a phone and a desktop from both being in a room, and what
   * makes joining on a second device feel like moving rather than duplicating.
   */
  | { type: 'superseded'; channelId: string }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string };

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
  /**
   * Channels that raise a notification only when this account is mentioned.
   *
   * The client decides what counts as a mention, because the server cannot: a
   * message body is sealed with the channel key. A channel in both lists is
   * silent - the stronger setting wins.
   */
  mentionOnlyChannelIds: string[];
}

/** What a channel's bell is set to. Three states, in order of loudness. */
export type ChannelNotificationLevel = 'all' | 'mentions' | 'none';

export interface UpdateNotificationPreferencesRequest {
  enabled?: boolean;
  quietStartMinute?: number | null;
  quietEndMinute?: number | null;
  /** Replaces the whole list; send the list you want, not a delta. */
  mutedChannelIds?: string[];
  mentionOnlyChannelIds?: string[];
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
  /**
   * An edit, a deletion, a pin and a reaction are all "this message is not what
   * you last saw", so they share one event carrying the whole message. A
   * deletion is not a separate event any more: the tombstone arrives here with
   * `deletedAt` set, which is exactly what the client has to render.
   */
  | { type: 'message.updated'; message: Message }
  /** Sent to both sides of a request, an acceptance or a removal. */
  | { type: 'friends.changed' }
  /** Sent to everyone watching the server, and to whoever joined or left it. */
  | { type: 'server.members.changed'; serverId: string }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string };

// --- Remote desktop (phase 17) ---
//
// A remote session is deliberately its own vocabulary: nothing here is reused
// from chat or calls, so a change to one cannot quietly widen the other.

export type RemotePermission =
  | 'REMOTE_VIEW'
  | 'REMOTE_CONTROL'
  | 'REMOTE_FILE_TRANSFER'
  | 'REMOTE_CLIPBOARD'
  | 'REMOTE_AUDIO'
  | 'REMOTE_ADMIN';

/** A machine as the person looking at the list sees it. */
export interface RemoteMachineSummary {
  id: string;
  name: string;
  platform: string;
  ownerId: string;
  ownerUsername: string;
  /** True when the agent currently holds a socket to the gateway. */
  online: boolean;
  lastSeenAt: string | null;
  /** What the caller may do here, expiry already applied. */
  permissions: RemotePermission[];
  /** When the caller's access lapses. Null for the owner and for open-ended. */
  expiresAt: string | null;
  createdAt: string;
}

/** Enrolment. The token comes back once and is never returned again. */
export interface EnrolMachineRequest {
  name: string;
  platform: string;
  /** Re-enrolling an existing machine rotates its token instead of adding one. */
  machineId?: string;
}

export interface EnrolMachineResponse {
  machine: RemoteMachineSummary;
  agentToken: string;
}

export interface RemoteGrantSummary {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  permissions: RemotePermission[];
  expiresAt: string | null;
}

export interface SetRemoteGrantRequest {
  userId: string;
  /** An empty list revokes: there is no separate delete. */
  permissions: RemotePermission[];
  /** ISO date; omitted or null is open-ended. */
  expiresAt?: string | null;
}

export interface StartRemoteSessionRequest {
  machineId: string;
}

/**
 * The screen goes directly from the agent to the controller over WebRTC, the
 * same way a call does. `remote-gateway` relays the offer, the answer and the
 * ICE candidates that set that up, along with input and the audit trail; it
 * never carries a pixel, and neither does the tunnel in front of it.
 */
export interface RemoteSessionResponse {
  sessionId: string;
  machineId: string;
  machineName: string;
  /** Frozen when the session started; the gateway enforces these, not the UI. */
  permissions: RemotePermission[];
  /** STUN, and TURN when the deployment configures one. See `CallIceResponse`. */
  iceServers: IceServer[];
}

/**
 * One end of a remote session describing itself to the other.
 *
 * Deliberately without the `fingerprintProof` a call's signal carries: the two
 * machines in a remote session share no secret the gateway has never seen, so
 * there is nothing to sign it with. The screen is still end-to-end encrypted -
 * DTLS-SRTP directly between them, with no server holding a decodable frame -
 * but an actively malicious gateway could substitute a fingerprint, which a
 * call's channel key makes impossible. See "Known limits" in E2EE.md.
 */
export type RemoteSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: IceCandidatePayload };

/**
 * One of the machine's displays, as the controller picks between them.
 *
 * A machine with two monitors has to be asked which one, and the answer has to
 * travel with its size: the controller maps a click to a fraction of the screen
 * it is looking at, and only the agent knows what that screen measures.
 */
export interface RemoteScreen {
  /** The platform's display id, stable for as long as the display is attached. */
  id: string;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

export interface RemoteAuditEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorUsername: string | null;
  sessionId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** Sent by a controller's socket. Input is refused unless the session allows it. */
export type ClientRemoteEvent =
  | { type: 'input.mouse'; action: 'move' | 'down' | 'up' | 'wheel'; x: number; y: number; button?: 'left' | 'right' | 'middle'; deltaY?: number }
  | { type: 'input.key'; action: 'down' | 'up'; key: string; code: string; modifiers: string[] }
  | { type: 'clipboard.set'; text: string }
  /**
   * Asks the machine for the mouse and keyboard, the way RDP does. Answered
   * immediately when the session was already granted control; otherwise it is
   * put to whoever is sitting at the machine, who is the one authority higher
   * than a stored grant.
   */
  | { type: 'control.request' }
  /** Hands control back without ending the session. */
  | { type: 'control.release' }
  /** Switches which of the machine's displays is being shared. */
  | { type: 'screen.select'; screenId: string }
  /** Relayed straight to the agent; the gateway does not read it. */
  | { type: 'rtc.signal'; data: RemoteSignal }
  | { type: 'session.end' }
  | { type: 'ping' };

/** Sent by an agent's socket. */
export type AgentRemoteEvent =
  | { type: 'agent.ready'; screens: number }
  | { type: 'session.accepted'; sessionId: string }
  | { type: 'session.refused'; sessionId: string; reason: string }
  | { type: 'session.ended'; sessionId: string }
  | { type: 'clipboard.text'; sessionId: string; text: string }
  /** What this machine has to offer, and which one is on the wire right now. */
  | { type: 'screens'; sessionId: string; screens: RemoteScreen[]; activeId: string }
  | { type: 'control.granted'; sessionId: string }
  | { type: 'control.denied'; sessionId: string; reason?: string }
  /** Relayed straight to that session's controller; the gateway does not read it. */
  | { type: 'rtc.signal'; sessionId: string; data: RemoteSignal }
  | { type: 'pong' };

/** Sent by the gateway to either kind of socket. */
export type ServerRemoteEvent =
  | { type: 'ready'; role: 'agent' | 'controller'; machineId?: string; sessionId?: string }
  | {
      type: 'session.start';
      sessionId: string;
      /** For the agent: who is asking, and what they were granted. */
      controllerId: string;
      controllerName: string;
      permissions: RemotePermission[];
      /**
       * How to reach the controller. The agent is the one with a screen to
       * send, so it is the one that offers.
       */
      iceServers: IceServer[];
    }
  | { type: 'session.ended'; sessionId: string; reason: string }
  | { type: 'agent.state'; sessionId: string; state: 'accepted' | 'refused'; reason?: string }
  | { type: 'input.mouse'; action: 'move' | 'down' | 'up' | 'wheel'; x: number; y: number; button?: 'left' | 'right' | 'middle'; deltaY?: number }
  | { type: 'input.key'; action: 'down' | 'up'; key: string; code: string; modifiers: string[] }
  | { type: 'clipboard.set'; text: string }
  /** To the controller: the machine's displays, and which one it is sending. */
  | { type: 'screens'; screens: RemoteScreen[]; activeId: string }
  /** To the agent: send that display instead. */
  | { type: 'screen.select'; sessionId: string; screenId: string }
  /** To the agent: somebody is asking for control and the machine must answer. */
  | { type: 'control.requested'; sessionId: string; controllerName: string }
  /**
   * Relayed between the two ends of one session, in both directions. The
   * gateway stamps nothing and reads nothing; `sessionId` is present on the way
   * to an agent, which may hold several sessions at once, and absent on the way
   * to a controller, which has exactly one.
   */
  | { type: 'rtc.signal'; sessionId?: string; data: RemoteSignal }
  /**
   * To the controller: what this session may do now. Sent whenever control is
   * taken, granted, refused or released - the client renders from this rather
   * than from what it asked for.
   */
  | {
      type: 'control.changed';
      sessionId: string;
      permissions: RemotePermission[];
      granted: boolean;
      reason?: string;
    }
  | { type: 'pong' }
  | { type: 'error'; code: string; message: string };

// --- Health ---

/**
 * The client/server contract, bumped when a change lands that an older client
 * cannot survive - a route that moved, an envelope shape that changed, a
 * permission that means something new.
 *
 * Not the product version, and deliberately not derived from `package.json`:
 * most releases change nothing a client can notice, and a number that moves
 * every release trains people to ignore the warning it raises.
 *
 * 1: the contract as of the first deployment anyone runs.
 * 2: the key directory is per device rather than per account, and channel keys
 *    are wrapped per device. A client from before this cannot read the
 *    directory it is handed, and a server from before it cannot store what a
 *    new client sends.
 */
export const API_CONTRACT_VERSION = 2;

/** What `GET /api/v1/auth/version` answers. Public: it is asked before sign-in. */
export interface ServerVersion {
  /** The deployment's `API_CONTRACT_VERSION`. */
  contract: number;
  /** Human-readable, for a support conversation. Never parsed by a client. */
  release: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  uptime: number;
}
