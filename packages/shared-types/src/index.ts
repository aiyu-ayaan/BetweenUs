/**
 * API and realtime contracts shared by every service and client.
 * No service-specific business rules.
 *
 * Almost no runtime logic either, and the exceptions are all one kind of thing:
 * a rule both ends have to apply *identically* or the contract means nothing.
 * `listenPositionAt` is where a shared track has got to; `games/` is what a
 * board becomes when somebody plays a move. A server that computed either
 * differently from the clients reading it would be a session where nobody is
 * wrong and nobody agrees, so there is one implementation, in the package both
 * sides import.
 */

import type { GameId, GameSession } from './games';

// Named one by one rather than `export *`, and that is not a style choice: the
// package builds to CommonJS for the Node services, and the ESM clients import
// it through Node's interop, which finds named exports by *reading* the emitted
// file. A star re-export compiles to a runtime loop it cannot see through, so
// `GAMES` would exist at runtime and be missing at import - which is a check
// that fails and a renderer that does not.
export {
  GAMES,
  GAME_LIBRARY,
  gameRules,
  // Carrom: the board, the physics, and the shot both ends replay
  BASELINE,
  BASELINE_HALF_WIDTH,
  BLACK,
  BOARD,
  COIN_RADIUS,
  DT,
  PIECES,
  POCKETS,
  POCKET_INSET,
  POCKET_RADIUS,
  QUEEN,
  QUEEN_VALUE,
  STEPS_PER_FRAME,
  STRIKER,
  STRIKER_RADIUS,
  WHITE,
  aimOf,
  baselineY,
  carromPieces,
  carromShot,
  coin,
  coinsOf,
  lastShot,
  placeStriker,
  queenOwner,
  queenPending,
  simulate,
  // Ludo
  HOME,
  LAST_TRACK_STEP,
  ROLL,
  SAFE,
  START,
  TOKENS,
  TRACK,
  YARD,
  dieOf,
  lastCapture,
  lastRoll,
  lastTokenMoved,
  progressOf,
  tokenIndex,
  tokenMoves,
  trackSquare,
  gameReady,
  gameScore,
  isTurnOf,
  seatOf,
  // Connect Four
  COLUMNS,
  ROWS,
  connectFourAt,
  landing,
  winningRun,
  // Dots and Boxes
  CELLS,
  DOTS,
  LINES,
  boxLines,
  horizontal,
  vertical,
  // Reversi
  REVERSI_SIZE,
  reversiAt,
  flips,
  movesFor,
  // Tic-tac-toe
  lineWinner,
  winningLine,
} from './games';
export type {
  GameDefinition,
  GameId,
  GameRules,
  GameSeat,
  GameSession,
  GameState,
  Piece,
  RandomSource,
  ShotResult,
} from './games';

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

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
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

// --- Forgotten passwords ---

export interface ForgotPasswordRequest {
  /** Email or username, the same field the login screen takes. */
  identifier: string;
}

/**
 * What the client should put on screen next, and nothing about whether the
 * account exists.
 *
 * `emailed` and `unknown` are deliberately indistinguishable in everything but
 * the word: both mean "we are not going to tell you whether that was a real
 * account", and both render the same sentence. The two that differ are the two
 * that have to: `reset` is an administrator having already authorised this one,
 * and `unavailable` is a deployment with no mail server, which is a fact about
 * the deployment rather than about the account.
 */
export type ForgotPasswordOutcome = 'emailed' | 'reset' | 'unavailable';

export interface ForgotPasswordResponse {
  outcome: ForgotPasswordOutcome;
  /**
   * Present only for `reset`: the single-use token that lets this client set a
   * new password now. It exists because an administrator put the account into
   * reset mode, which is the deployment's way back in when nothing can be
   * mailed. Expires, and is spent the first time it is used.
   */
  resetToken?: string;
  /** Present only for `unavailable`: what the operator wants people to be told. */
  message?: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

// --- Username availability ---

export interface UsernameAvailability {
  username: string;
  available: boolean;
  /** Why not, when it is not: `taken` or `invalid`. */
  reason?: 'taken' | 'invalid';
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
  /** One-time code handed to the redirect after the provider callback. */
  code: string;
  /**
   * The secret behind the challenge this sign-in was started with, when it was
   * started with one. Required for a flow that came back over a private-scheme
   * redirect, because that redirect is not exclusively ours - see
   * `APP_SCHEME` in the auth service.
   */
  verifier?: string;
}

/**
 * The scheme the mobile client's redirect uses.
 *
 * A phone has no loopback server to come back to, so the finished sign-in comes
 * back through a URL only the app is registered for. Android does not guarantee
 * that registration is exclusive - another app can claim the same scheme - so
 * this flow is bound to a secret the app keeps: see `OAuthExchangeRequest`.
 */
export const APP_REDIRECT_SCHEME = 'betweenus:';

// --- Admin panel ---

export interface AdminStatus {
  /** False until `pnpm admin:create` has been run; the panel explains that. */
  hasAdmin: boolean;
}

export interface AdminUser extends PublicUser {
  disabledAt: string | null;
  /** While this is in the future the account is in password-reset mode. */
  passwordResetUntil: string | null;
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
  /**
   * True puts the account into reset mode: the next time somebody names it on
   * the forgot-password screen they are handed a single-use token and the
   * change-password form, without a mail server being involved. False cancels
   * a window that has not been used yet.
   */
  passwordReset?: boolean;
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

/**
 * The deployment's outgoing mail server, as the panel sees it. Never carries
 * the password - only whether one is stored, exactly like the OAuth secret.
 */
export interface AdminSmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  /** Implicit TLS on connect (465); false starts plain and upgrades (587). */
  secure: boolean;
  username: string;
  hasPassword: boolean;
  fromAddress: string;
  fromName: string;
}

export interface AdminSmtpUpdate {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  /** Omitted means "keep the stored password"; a value replaces it. */
  password?: string;
  fromAddress: string;
  fromName: string;
}

/** What a test send did, so the panel can show the server's own refusal. */
export interface AdminSmtpTestResult {
  ok: boolean;
  /** The transport's message when it failed; absent when it did not. */
  error?: string;
}

export interface AdminSmtpTestRequest {
  /** Where to send it. Defaults to the administrator's own address. */
  to?: string;
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

/**
 * What an invite is worth accepting, before it is accepted.
 *
 * A link used to join the moment it was opened, which is the one thing an
 * invite should never do: the person following it has no idea whose server it
 * is until they are already in it. So a code is looked up first and answered
 * with enough to decide - whose server, how big it is, and how much of it is
 * awake.
 *
 * It is deliberately thin. Anyone holding a code can ask for this, so it says
 * what the invite itself already promises and nothing more: no member list, no
 * channels, no ids belonging to anyone.
 */
export interface InvitePreview {
  code: string;
  serverId: string;
  name: string;
  iconUrl: string | null;
  memberCount: number;
  /**
   * How many of those members are online, or null when presence could not be
   * reached. Null rather than 0: "nobody is here" and "nobody could be asked"
   * are different things, and a card that shows the second as the first is
   * lying about an empty server.
   */
  onlineCount: number | null;
  /** Already in. The link then opens the server rather than joining it. */
  member: boolean;
}

export interface JoinServerRequest {
  /** An invite code. The server's slug is not one, and no longer opens a door. */
  code: string;
}

/**
 * One of a server's own emoji.
 *
 * The name is what people type between colons and the URL is an ordinary
 * picture upload - public, like every avatar, because an `<img>` cannot carry
 * an Authorization header and an emoji is drawn a hundred times a screen.
 */
export interface ServerEmoji {
  id: string;
  serverId: string;
  /** Lowercase letters, digits and underscores. `:name:` is how it is written. */
  name: string;
  url: string;
  /** A GIF or an animated WebP. Recorded rather than sniffed by every client. */
  animated: boolean;
  createdById: string | null;
  createdAt: string;
}

/** What the name and picture rules are, so a client can say no before the server does. */
export const EMOJI_NAME_PATTERN = /^[a-z0-9_]{2,32}$/;

/**
 * How many a server may hold.
 *
 * Not a licensing tier - a picker is a grid somebody has to look through, and
 * past a couple of hundred it stops being one. Raise it here if a deployment
 * disagrees; nothing else depends on the number.
 */
export const MAX_SERVER_EMOJI = 200;

export interface CreateServerEmojiRequest {
  name: string;
  /** Storage URL of a picture already uploaded through `/api/v1/uploads/picture`. */
  url: string;
  animated?: boolean;
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

/**
 * What to clear. One conversation, or - with no `channelId` - every one of
 * them.
 *
 * The same endpoint for both, because they are the same act at two scopes and
 * a client should not have to know which of two routes it wants. The scope is
 * the argument, which is also what makes the answer able to say which happened.
 */
export interface ClearChatsRequest {
  /** Omitted or null clears every conversation this account can see. */
  channelId?: string | null;
}

/**
 * What `POST /api/v1/messages/clear` answers with: the instant everything at or
 * before it stopped being visible to this account, and where.
 */
export interface ClearChatsResponse {
  clearedAt: string;
  /** The conversation that was cleared, or null when all of them were. */
  channelId: string | null;
}

// --- Blocking ---

/** Somebody this account has blocked, as the block list shows them. */
export interface BlockedUser {
  user: UserSummary;
  blockedAt: string;
}

export interface BlockUserRequest {
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
/**
 * A custom emoji carried inside a message.
 *
 * The text keeps the literal `:name:`, and this says what to draw for it. Both,
 * on purpose:
 *
 * - The picture travels with the message, so a reader who is not in the server
 *   that owns the emoji still sees it - a shortcode forwarded into a direct
 *   message would otherwise render as a word.
 * - The text stays readable. A client that has never heard of custom emoji
 *   shows `:party_parrot:`, which is what it meant, rather than a marker.
 *
 * Nothing is leaked by carrying it: the URL is public and the server already
 * holds the row. What the server still cannot see is which message used it.
 */
export interface MessageCustomEmoji {
  name: string;
  url: string;
  animated: boolean;
}

export interface MessageBody {
  text: string;
  attachments: MessageAttachment[];
  replyTo?: MessageReply;
  /** Custom emoji appearing in `text`, by the name written between colons. */
  emoji?: MessageCustomEmoji[];
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
  /**
   * Machines missing an epoch *their owner already holds somewhere else*, over
   * every epoch the channel has had, newest first. This is what lets a second
   * machine read history rather than only what is written after it arrives.
   *
   * `missingRecipients` covers the current epoch only, which is enough to keep
   * the next message readable and nothing else. A machine that signs in today
   * is missing every epoch before today: it cannot re-wrap them for itself
   * (it holds none of them), and nothing else was looking, so it mints a fresh
   * epoch and everything written before it stays a padlock for good.
   *
   * "Their owner already holds it" is the boundary, and it is load-bearing:
   * without it this would hand the whole history to somebody who joined
   * yesterday, which is the opposite of the rule everything else here keeps. It
   * repairs one person's access on their own second machine and nothing else.
   *
   * A client that holds an epoch fills these gaps. The server already lets a
   * holder add to an existing epoch, so this needs no new permission - only
   * somebody to notice, which is what this field is.
   *
   * Empty for a channel with no key yet.
   */
  gaps: Array<{ epoch: number; devices: DeviceKey[] }>;
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

/**
 * "Come into this call" - a ring aimed at one person.
 *
 * The roster announcement (`CallPushData`) is the ambient half: it says a call
 * is happening in a channel somebody can hear, and it deliberately does not
 * ring a phone for a server's voice channel, because a phone that rings every
 * time anybody joins any channel is a phone somebody turns notifications off
 * on.
 *
 * This is the other half, and the difference is that a person chose to send it.
 * It rings - a full-screen incoming call on a locked phone, a modal on the
 * desktop - because it was aimed rather than broadcast.
 */
export interface CallRingRequest {
  channelId: string;
  /** Who to ring. Must be able to see the channel; the server checks. */
  userId: string;
}

/**
 * One call somebody was in, as their own log reads it back.
 *
 * Written from the gateway's own knowledge of when the socket joined and left,
 * so it is not a client's account of its own call. The one number that is the
 * client's is `bytes`: nothing on the server is in the media path to measure.
 */
export interface CallHistoryEntry {
  id: string;
  channelId: string;
  channelName: string;
  /** Null for a direct message, which belongs to no server. */
  serverId: string | null;
  serverName: string | null;
  joinedAt: string;
  /** Null for a call that never got an ending written - the process died. */
  endedAt: string | null;
  /** Whole seconds, or null when there is no ending to measure to. */
  durationSeconds: number | null;
  /** Everybody else who was in it while this person was, as they are named now. */
  peers: Array<{ id: string; username: string; displayName: string }>;
  /** Sent plus received, as this person's client counted it. */
  bytes: number;
  /** The same total split by direction. Both zero when nothing was reported. */
  bytesSent: number;
  bytesReceived: number;
  /**
   * One entry per peer connection this client held during the call, empty for a
   * call whose client never reported - an older build, or one that was killed.
   */
  links: CallLinkReport[];
}

/**
 * What one peer connection did, as the client at this end measured it.
 *
 * The unit of a mesh call is the link, not the call: two people in the same
 * call can have completely different answers about whether it went direct, and
 * "why was that one call bad" is a question only a per-link reading answers.
 * Nothing on the server can check any of it, so it is clamped rather than
 * trusted - see `usage.ts` in call-service.
 */
export interface CallLinkReport {
  /** Who the connection was with. Resolved to a current name when read back. */
  userId: string;
  /** How they were named at the time, so a deleted account still reads. */
  username: string;
  bytesSent: number;
  bytesReceived: number;
  /** Round trip on the pair that carried the call, when it was ever known. */
  roundTripMs: number | null;
  packetsLost: number;
  packetsReceived: number;
  /**
   * `direct` when the media went straight between the two machines, `relay`
   * when it went through TURN, null when the client never worked it out. It is
   * the difference between a call that cost the network nothing and one that
   * cost an operator's relay bandwidth, and it is invisible without this.
   */
  transport: CallTransport | null;
}

export type CallTransport = 'direct' | 'relay';

/**
 * The account's own calls, added up: what a month of them cost.
 *
 * Read from the same rows the log is, so the two can never disagree. Bucketed
 * by local date on the server's clock - a day boundary an hour out is not worth
 * a timezone round trip on a page about roughly how much data a week used.
 */
export interface CallAnalytics {
  /** How far back this covers, in days, ending today. */
  days: number;
  totals: CallUsageTotals;
  /** Oldest first, one entry per day in the window - including empty ones, so a
   * chart drawn straight from this has no gaps to invent. */
  daily: Array<{ date: string } & CallUsageTotals>;
  /** Where the time went, busiest first. */
  channels: Array<{
    channelId: string;
    channelName: string;
    serverName: string | null;
  } & CallUsageTotals>;
  /** Who it was spent with, most first. */
  peers: Array<{
    id: string;
    username: string;
    displayName: string;
    calls: number;
    seconds: number;
  }>;
  /** How the media got there, across every link reported in the window. */
  transport: { direct: number; relay: number; unknown: number };
}

export interface CallUsageTotals {
  calls: number;
  seconds: number;
  bytesSent: number;
  bytesReceived: number;
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

/**
 * --- Listen Together ---
 *
 * A shared listening session inside a voice call: everybody hears the same
 * track at the same moment, and anybody in the call can change what it is.
 *
 * The thing to understand before reading the rest: **no audio crosses the
 * wire.** Each client plays the track itself, from the provider, over its own
 * connection. What the gateway relays is a few dozen bytes of transport state -
 * which track, playing or paused, where in it, and when that was true. That is
 * why this belongs on `/ws/call` beside the SDP and not anywhere near the mesh:
 * it is signalling, it is small, it is text, and it is exactly what a
 * Cloudflare Tunnel carries.
 *
 * It is also why this is not a screen share with the sound on. A share costs
 * the sharer one upload per other participant, re-encodes the music through a
 * codec tuned for speech, and gives everyone else whatever survived the trip.
 * Here every client streams the original at full quality, the uplink cost is
 * zero, and the only thing that has to stay in step is a number.
 */
export type ListenProvider = 'youtube';

/** One entry in the shared queue. */
export interface ListenTrack {
  /** Queue-entry id, minted by whoever added it. The same video can be queued twice. */
  id: string;
  provider: ListenProvider;
  /** The provider's own id - for YouTube, the eleven-character video id. */
  ref: string;
  /**
   * What to call it on screen.
   *
   * Filled in by the first client whose player learns it, because nothing on
   * the server may talk to YouTube: an outbound call from a backend service to
   * fetch a title would be a service that needs an API key, an egress rule and
   * an opinion about who is listening to what. The clients already have the
   * player open, and it tells them.
   */
  title: string;
  /** Milliseconds; 0 until a player reports it. */
  durationMs: number;
  addedByUserId: string;
  addedByUsername: string;
}

/**
 * The whole of a listening session, as the gateway holds it.
 *
 * `positionMs` is where the track was at `atServerMs`, not where it is now.
 * Sending "now" would be a lie by the time it arrived: a client reads its
 * position as `positionMs + (serverNow - atServerMs)` while playing, which
 * makes one message good for as long as nothing changes. See
 * `services/listen-sync.ts` for the arithmetic and the drift correction.
 */
export interface ListenSession {
  /**
   * Bumped by the gateway on every change.
   *
   * The gateway is the only thing that can order two people pressing pause at
   * the same moment, for the same reason it arbitrates the screen share: a mesh
   * has no ordering of its own. A client drops any state with a `rev` it has
   * already seen, so its own echo cannot undo somebody else's later change.
   */
  rev: number;
  queue: ListenTrack[];
  /** Index into `queue`. A session always has at least one track. */
  index: number;
  paused: boolean;
  positionMs: number;
  /** The gateway's clock when this state was made. */
  atServerMs: number;
  /** Who last touched it, for the line that says who skipped. */
  byUserId: string | null;
}

/**
 * Where the needle is at `nowMs`, on a clock shared with the gateway.
 *
 * Part of the contract rather than of either side, because it is the whole
 * meaning of `positionMs` and `atServerMs`: a server that advanced the position
 * differently from the clients reading it would be a session where nobody is
 * wrong and nobody agrees. One formula, in the package both sides import.
 *
 * Clamped to the track's length once one is known, so a session left playing
 * while everybody was away does not report a position in the next hour.
 */
export function listenPositionAt(session: ListenSession, nowMs: number): number {
  const elapsed = session.paused ? 0 : Math.max(0, nowMs - session.atServerMs);
  const raw = session.positionMs + elapsed;
  const duration = session.queue[session.index]?.durationMs ?? 0;
  return duration > 0 ? Math.min(raw, duration) : Math.max(0, raw);
}

export type ClientCallEvent =
  | { type: 'join'; channelId: string }
  /**
   * `bytes` is what this client's peer connections moved over the whole call,
   * sent plus received. Only the client can know it - the gateway is not in the
   * media path and has nothing to count - so it is reported on the way out and
   * clamped by the server, which treats it as the cosmetic number it is.
   */
  | { type: 'leave'; bytes?: number; bytesSent?: number; bytesReceived?: number; links?: CallLinkReport[] }
  | { type: 'signal'; to: string; data: CallSignal }
  /**
   * "I am about to share my screen" / "I have stopped".
   *
   * One share at a time in a call, and the claim is what decides whose. It is
   * arbitrated here rather than between clients because two people pressing the
   * button at the same moment need a single answer, and a mesh has no ordering
   * to give one - the gateway holds the sockets, so it is the thing that can
   * say "this one, and the other one stops".
   */
  | { type: 'screen.claim' }
  | { type: 'screen.release' }
  /**
   * Listen Together. Anybody in the call may send any of these - there is no
   * host, because a host is a person who has to leave eventually and take the
   * music with them. The gateway sequences them and tells everybody the result.
   */
  /**
   * Queue a track. `playNow` also jumps to it, which is what pressing a video
   * means: somebody who clicked a song wants to hear that song, not to hear it
   * after the four already in the queue.
   */
  | {
      type: 'listen.add';
      provider: ListenProvider;
      ref: string;
      title?: string;
      playNow?: boolean;
    }
  | { type: 'listen.remove'; trackId: string }
  /** Resume, or jump to `index` in the queue. */
  | { type: 'listen.play'; index?: number }
  | { type: 'listen.pause'; positionMs: number }
  | { type: 'listen.seek'; positionMs: number }
  | { type: 'listen.skip'; delta: number }
  /** Close the session for everybody. */
  | { type: 'listen.stop' }
  /**
   * "My player reached the end of this track."
   *
   * Every client sends it, and the gateway advances once: the track id is
   * checked against the one playing, so the second and third arrivals are about
   * a track that is no longer current and do nothing. Idempotent by
   * construction rather than by election - electing a reporter means the queue
   * stops when that person's window closes.
   */
  | { type: 'listen.ended'; trackId: string }
  /**
   * "My player has learned what this track is called and how long it is."
   *
   * The title cannot be known when a track is added, because at that point it
   * is a link somebody pasted - only a player that has loaded it knows. And
   * nothing on the server may go and ask: an outbound call from a backend
   * service to fetch a title is a service that needs an API key, an egress rule
   * and an opinion about who is listening to what. So the clients, which have
   * the player open anyway, fill it in. First one to know, wins; the rest are
   * about a field that is already set and change nothing.
   */
  | { type: 'listen.meta'; trackId: string; title?: string; durationMs?: number }
  /**
   * Play Together. Anybody in the call may open a game or take an empty chair;
   * only the person sitting in a seat may move it, and only on their turn.
   *
   * A move is a number - a square, a column, a line - and the gateway is the
   * referee: it applies the rules from `games/` and broadcasts the board that
   * came out. Nothing here is trusted from the client except which move was
   * asked for, because a client that could send a board could send any board.
   */
  | { type: 'game.open'; gameId: GameId }
  /** Take an empty chair, or move to one. Standing up is `seat: -1`. */
  | { type: 'game.sit'; seat: number }
  /**
   * A move, and - for a game where a move is not an index - the numbers that
   * complete it. A carrom shot is where the striker sits, which way it points
   * and how hard it is hit; packing three numbers into one would be an encoding
   * the two ends could disagree about.
   *
   * The gateway checks them and runs the physics itself. What is never sent is
   * a board: a client that could send twenty coin positions could send twenty
   * coins in the pockets.
   */
  | { type: 'game.move'; move: number; params?: number[] }
  /** Deal again with the same people in the same chairs. */
  | { type: 'game.rematch' }
  /** Close the game for everybody. */
  | { type: 'game.close' }
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
  /**
   * Who is sharing their screen in this call, or null when nobody is.
   *
   * Sent to everybody on every change, including to the peer that just took it.
   * A client that sees somebody else here while it is sharing stops: taking
   * over is what the button does, the way Teams does it, rather than two
   * screens on one stage and no way to tell which is which.
   */
  | { type: 'screen.holder'; peerId: string | null; userId: string | null }
  /**
   * The listening session in this call, or null when there is not one.
   *
   * Always the whole session rather than a delta: it is a few hundred bytes,
   * it changes when a person presses a button rather than continuously, and a
   * client that missed one message would otherwise hold a queue nobody else
   * has. Sent to everybody on every change, the joiner included.
   */
  | { type: 'listen.state'; session: ListenSession | null }
  /**
   * The game being played in this call, or null when there is not one.
   *
   * Whole board rather than a move, for the same reason `listen.state` is whole:
   * a client that missed one message would otherwise hold a position nobody
   * else has, and two people playing different boards is a failure neither of
   * them can see. It is a few hundred bytes and it is sent when somebody moves.
   */
  | { type: 'game.state'; session: GameSession | null }
  /**
   * `serverMs` is the gateway's clock, which is what makes the shared position
   * mean anything: two machines disagree about what time it is by whatever
   * their NTP daemons last decided, and a listening session that trusted local
   * clocks would be as far out of step as they are. The client subtracts half
   * the round trip and keeps the offset. See `services/listen-sync.ts`.
   */
  | { type: 'pong'; serverMs?: number }
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
  /**
   * "This channel is on screen in front of me, in a focused window."
   *
   * Sent when a channel is opened in a focused window and again on a heartbeat
   * while it stays that way; `channel.blur` is sent when the window loses
   * focus or the channel is left. It is what stops a push waking a phone for a
   * conversation its owner is already reading somewhere else - see
   * `push-suppression.md`.
   */
  | { type: 'channel.focus'; channelId: string }
  | { type: 'channel.blur'; channelId: string }
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
  /**
   * Somebody is ringing this account into a call, right now.
   *
   * The same thing `CallRingPushData` carries, delivered to the clients that
   * are already running. A push exists for the ones that are not; a client
   * that is up would otherwise find out about a ring only if it happened to be
   * a phone, which is the wrong way round for the client somebody is sitting
   * in front of.
   */
  | {
      type: 'call.ring';
      channelId: string;
      channelName: string;
      callerId: string;
      callerName: string;
      callerAvatarUrl?: string;
    }
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
  /**
   * People this account never wants raised, wherever they write.
   *
   * A channel mute is the wrong tool for one loud person in five channels, and
   * leaving is the wrong tool for a colleague. Applied on the client for the
   * same reason mentions are: the author is on the envelope, but nothing else
   * about the message is legible to a service.
   */
  mutedUserIds: string[];
}

/** What a channel's bell is set to. Three states, in order of loudness. */
export type ChannelNotificationLevel = 'all' | 'mentions' | 'none';

export interface UpdateNotificationPreferencesRequest {
  enabled?: boolean;
  mutedUserIds?: string[];
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

/**
 * Somebody else's read marker in a channel: who has read it, and up to when.
 *
 * Read receipts are derived from these rather than stored per message. A
 * marker is one row per person per channel and it only moves forwards, so
 * "who has seen this message" is "whose marker is at or past its timestamp" -
 * which needs no new table and cannot fall out of step with the unread count,
 * because it is the same row the unread count is derived from.
 */
export interface ChannelReadReceipt {
  user: MessageAuthor;
  readAt: string;
}

// --- Push devices (phase 27) ---

/** The transports a push token can belong to. One per client family. */
export type DevicePlatform = 'android' | 'ios' | 'web';

/**
 * One installation's push token.
 *
 * Keyed on (user, device) rather than on the token: a token rotates - FCM mints
 * a new one after a restore, a clear-data or its own schedule - and a registry
 * keyed on it would grow a row per rotation and push to every dead one. The
 * device id is the client-minted installation id that already identifies this
 * machine to the key directory, so one phone is one row for as long as the app
 * is installed.
 */
export interface RegisterDeviceRequest {
  /**
   * How to reach this installation. Never logged.
   *
   * For `android` and `ios` it is the FCM registration token. For `web` it is
   * a Web Push subscription, serialised - see `WebPushSubscription`, which
   * says why one column carries both.
   */
  token: string;
  platform: DevicePlatform;
  /** Client-minted, stable per installation - the same id `DeviceKey` uses. */
  deviceId: string;
  /** What to call it in a list: "Pixel 8". Untrusted, display only. */
  label?: string;
  /** The client build, so a push that a version cannot render can be skipped. */
  appVersion?: string;
}

/**
 * A browser's push subscription: where to send, and the keys to seal it with.
 *
 * This is what `PushManager.subscribe` hands back, and it is what stands in for
 * an FCM token on the web. There is no Firebase in this path at all: a
 * deployment with VAPID keys and no Firebase project can push to browsers and
 * not to phones, and one with Firebase and no VAPID keys does the opposite.
 * Neither is a broken deployment.
 *
 * **It is stored in the same column an FCM token is.** That column means "how
 * to reach this installation", and for a browser the answer happens to be four
 * fields rather than one, so it travels as JSON. The alternative was two more
 * nullable columns and a migration that only ever applies to one platform.
 *
 * ponytail: a serialised object in a string column. If a third transport ever
 * needs its own shape, that is the moment to give the registry a typed address
 * rather than a string.
 */
export interface WebPushSubscription {
  /** The push service's URL for this browser. Unique, so it keys the row. */
  endpoint: string;
  keys: {
    /** The subscription's public key, base64url. */
    p256dh: string;
    /** The auth secret, base64url. */
    auth: string;
  };
}

/**
 * The application server key a browser needs before it can subscribe.
 *
 * Null when the deployment has configured no VAPID keys, which is the same
 * answer as "this deployment does not do web push" - the client asks once and
 * stops rather than failing at `subscribe`.
 */
export interface PushKeyResponse {
  vapidPublicKey: string | null;
}

/** What the registry answers with. Deliberately never the token itself. */
export interface RegisteredDevice {
  deviceId: string;
  platform: DevicePlatform;
  label: string | null;
  lastSeenAt: string;
}

/**
 * The data-only push a client is woken with.
 *
 * Data-only, and never `notification`: the body is sealed with the channel key,
 * so the only side that can write a notification worth reading is the client -
 * which is also the only side that knows whether that channel is already on
 * screen. Every field here is either on the message envelope already or is a
 * preference the recipient set themselves.
 *
 * All values are strings: FCM's data map has no other type.
 */
export interface MessagePushData {
  type: 'message.created';
  messageId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl?: string;
  /** The sealed envelope, so a client that holds the key can show the words. */
  content: string;
  createdAt: string;
  /** "1" when this channel is mentions-only for this recipient. */
  mentionsOnly?: string;
}

/**
 * A message was deleted, and a notification drawn for it is now a lie.
 *
 * The only push that exists to take something *off* a screen. It carries no
 * words because it needs none - the id is enough to find the line and drop it,
 * and the notification is rebuilt without it or cancelled if it was the only
 * one left.
 */
export interface MessageDeletedPushData {
  type: 'message.deleted';
  messageId: string;
  channelId: string;
}

/**
 * This account read a channel somewhere else.
 *
 * The mirror image of a message push: it exists to take a notification *off* a
 * screen rather than to put one on it. A phone that buzzed on the way to a desk
 * should not still be showing the notification once the message has been read
 * on the laptop.
 *
 * It carries no words and no message id - "everything in this channel up to
 * now" is the whole of what a read marker means, and the notification for that
 * channel is what gets cancelled. Sent to every device of the account,
 * including the one that did the reading, which has already cleared its own and
 * has nothing to do.
 */
export interface ChannelReadPushData {
  type: 'channel.read';
  channelId: string;
  /** ISO 8601, so a client can ignore one that arrives out of order. */
  at: string;
}

/**
 * Somebody asked to be friends, or said yes.
 *
 * Nothing here is sealed: a friend request has no body, and the name and
 * picture are already public. The client still writes the notification, for the
 * same reason every other one does - it is the only side that knows whether the
 * friends screen is already open.
 */
export interface FriendPushData {
  type: 'friend.request' | 'friend.accepted';
  actorId: string;
  actorName: string;
  actorAvatarUrl?: string;
}

/** Added to a server by somebody who was allowed to. */
export interface ServerMemberPushData {
  type: 'server.member.added';
  serverId: string;
  serverName: string;
  serverIconUrl?: string;
}

/**
 * Who is in a call, sent to the people who can hear it and are not.
 *
 * The whole roster rather than the one who joined, because it is one
 * notification per channel that is rewritten as people come and go - and
 * because the roster is the only thing that can also say a call has *ended*.
 * `count` of `"0"` is exactly that, and is what cancels the notification.
 */
export interface CallPushData {
  type: 'call.roster';
  channelId: string;
  channelName: string;
  /** Already joined for reading: "Ayaan and Bob". Empty when the call ended. */
  participants: string;
  /** FCM data values are strings, so a number has to travel as one. */
  count: string;
}

/**
 * Somebody is ringing this account into a call.
 *
 * Directed, unlike `CallPushData`: one person pressed a button with this
 * account's name under it, which is what earns the full-screen ringer, the
 * ringtone and the Doze exemption that `call.roster` deliberately does not get
 * for a server's voice channel.
 *
 * It carries no words to seal - a name, a channel and who is calling - so
 * every client, including a service worker holding no keys, can draw it in
 * full.
 */
export interface CallRingPushData {
  type: 'call.ring';
  channelId: string;
  channelName: string;
  callerId: string;
  callerName: string;
  callerAvatarUrl?: string;
}

/**
 * Somebody is on one of this account's machines.
 *
 * Sent to the machine's owner and to nobody else - the person driving it
 * already knows, and nobody else is entitled to know. This is the one
 * notification in the app that exists because of what it would mean if it
 * arrived unexpectedly: remote access is exactly the capability whose misuse
 * is invisible to the person it happens to, since they are by definition not
 * sitting at the machine.
 *
 * `state` carries the ending as well as the start, for the same reason
 * `CallPushData` carries a roster of nobody: it is the only thing that can take
 * the notification away again.
 */
export interface RemoteSessionPushData {
  type: 'remote.session';
  sessionId: string;
  machineId: string;
  machineName: string;
  actorId: string;
  actorName: string;
  state: 'started' | 'ended';
}

/** Everything that can arrive as a data-only push. */
export type PushData =
  | MessagePushData
  | MessageDeletedPushData
  | ChannelReadPushData
  | FriendPushData
  | ServerMemberPushData
  | CallPushData
  | CallRingPushData
  | RemoteSessionPushData;

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
  /**
   * Somebody changed their picture or their name.
   *
   * The exception to "announce, do not carry": a profile is drawn in every
   * message that account ever sent, in the member list, in the friend list and
   * in a DM header, so announcing it would be one refetch per list on every
   * client that shares a room with them. Four fields are cheaper than any of
   * that, and every one of those lists holds exactly those four.
   *
   * Reaches everyone who can see them: the members of every server they are in,
   * everyone they are friends with, and their own other devices.
   */
  | { type: 'user.updated'; user: UserSummary }
  /**
   * A server was renamed or given a new picture. Carried for the same reason,
   * and sent to everyone watching that server.
   */
  | { type: 'server.updated'; serverId: string; name: string; iconUrl: string | null }
  /**
   * Somebody read a channel this socket is subscribed to. It carries the
   * marker rather than the receipts, because every client can already derive
   * "who has seen this message" from a marker and a timestamp - and a payload
   * per reader would be the same fact said once per person.
   */
  | { type: 'channel.read'; channelId: string; userId: string; at: string }
  /**
   * This account cleared its own history. Sent only to its own sockets - it is
   * a fact about one person's view and nobody else's copy moved.
   *
   * Carried rather than announced because the client cannot refetch its way to
   * the answer: every device holds a local cache of decrypted messages, and
   * what they each have to do is drop everything at or before `clearedAt`.
   *
   * `channelId` is the conversation it applies to, or null for all of them.
   */
  | { type: 'chats.cleared'; clearedAt: string; channelId: string | null }
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

/**
 * A file on its way to the machine being controlled.
 *
 * The offer, the answer and the cancel travel over the gateway's socket, and
 * the bytes do not: they go down the session's data channel, directly between
 * the two machines, the same way the screen does. That split is not an
 * optimisation - it is what keeps `REMOTE_FILE_TRANSFER` enforceable. A
 * permission the gateway never sees a message for is a permission that does not
 * exist, so the thing it can check is the thing that asks, and the bulk that
 * follows is meaningless without it.
 *
 * One transfer at a time per session, which is what lets the data channel carry
 * nothing but bytes: the receiver knows how many to expect from the offer it
 * accepted, and counts. A second file waits for the first.
 */
export interface RemoteTransferOffer {
  transferId: string;
  name: string;
  /** Bytes. The receiver counts up to exactly this and then closes the file. */
  size: number;
}

/**
 * The ceiling on one transfer. Generous rather than principled: the receiving
 * side streams to disk and never holds the file, so this is a guard against a
 * mistake and a hostile controller rather than a memory limit.
 */
export const REMOTE_TRANSFER_MAX_BYTES = 4 * 1024 * 1024 * 1024;

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
  /**
   * Asks to send a file. Checked against `REMOTE_FILE_TRANSFER` and audited
   * before it reaches the machine; the bytes follow on the data channel only
   * once the machine has answered.
   */
  | ({ type: 'file.offer' } & RemoteTransferOffer)
  /** Gives up on a transfer, from either end. Also sent when the file is short. */
  | { type: 'file.cancel'; transferId: string; reason?: string }
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
  /** The machine's answer to a `file.offer`. Bytes may start after this. */
  | { type: 'file.accepted'; sessionId: string; transferId: string }
  | { type: 'file.refused'; sessionId: string; transferId: string; reason: string }
  /** Every byte arrived and the file is closed. `path` is where it landed. */
  | { type: 'file.done'; sessionId: string; transferId: string; path: string }
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
   * File transfer, relayed between the two ends. The shapes going to the agent
   * are the controller's own, forwarded once the permission has been checked;
   * the ones coming back are the machine's answer, with the `sessionId` the
   * agent stamped stripped on the way to a controller that holds only one.
   */
  | ({ type: 'file.offer' } & RemoteTransferOffer)
  | { type: 'file.cancel'; transferId: string; reason?: string }
  | { type: 'file.accepted'; transferId: string }
  | { type: 'file.refused'; transferId: string; reason: string }
  | { type: 'file.done'; transferId: string; path: string }
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
