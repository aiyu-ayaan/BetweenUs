import { sampleServerClock } from './server-clock';
import { objectSlot, retryDelayMs, worthRetrying } from './object-fetch';
import type {
  BackupSecretKind,
  CreatePollSettings,
  VotePollRequest,
  FollowedThread,
  MarkThreadReadRequest,
  ThreadFollowState,
  CreateServerInviteRequest,
  ApiErrorBody,
  AuthResponse,
  AuthTokens,
  BlockedUser,
  ClearChatsResponse,
  ForgotPasswordResponse,
  UsernameAvailability,
  CallAnalytics,
  CallHistoryEntry,
  CallIceResponse,
  Channel,
  ChannelCategory,
  ChannelLayout,
  ChannelLayoutRequest,
  InvitePreview,
  ChannelKeysResponse,
  ChannelMember,
  ChannelReadReceipt,
  ChannelUnread,
  CreateChannelRequest,
  EnrolMachineResponse,
  DeviceKey,
  DirectChannel,
  Friend,
  AccountKeyRecipient,
  AccountVaultResponse,
  CreateVaultRequest,
  IdentityBackupResponse,
  KeyHealthResponse,
  PortableFactorKind,
  PutVaultFactorRequest,
  RotateVaultRequest,
  VaultEscrowResponse,
  VaultFactor,
  VaultGrantsResponse,
  LinkPreview,
  Message,
  MessageEditsResponse,
  NotificationPreferences,
  OAuthProviderSummary,
  Paginated,
  PublicUser,
  PushKeyResponse,
  RegisterDeviceRequest,
  RegisteredDevice,
  CreateServerEmojiRequest,
  PublishChannelKeysRequest,
  ServerEmoji,
  RegisterDeviceKeyRequest,
  PutIdentityBackupRequest,
  RemoteAuditEntry,
  RemoteGrantSummary,
  RemoteMachineSummary,
  RemotePermission,
  RemoteSessionResponse,
  RemoteSessionUsage,
  RemoteUsageReport,
  CreateServerRoleRequest,
  ServerCustomRole,
  CreateWebhookRequest,
  UpdateWebhookRequest,
  WebhookSummary,
  WebhookWithToken,
  ServerAuditEntry,
  ServerMember,
  ServerInvite,
  ServerWithRole,
  StartMultipartResponse,
  StatusEntry,
  StatusFeed,
  StatusViewer,
  CreateStatusRequest,
  UploadedObject,
  UploadedPart,
  UpdateAccountRequest,
  UpdateChannelRequest,
  UpdateNotificationPreferencesRequest,
  UpdateServerMemberRequest,
  UpdateServerRequest,
  UpdateServerRoleRequest,
  UserSummary,
} from '@betweenus/shared-types';

import { absoluteUrl, serverUrl } from './endpoint';

// Every request is built against whichever deployment this window is pointed
// at - the one from VITE_API_URL, or the one chosen on the login screen. It is
// read per request rather than captured: switching servers reloads the window,
// but nothing here should depend on that.

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenSource = () => string | null;
type TokenRefresher = () => Promise<string | null>;

let getAccessToken: TokenSource = () => null;
let refreshAccessToken: TokenRefresher = async () => null;

/** Wired once by the auth store so requests stay unaware of storage details. */
export function configureApi(source: TokenSource, refresher: TokenRefresher): void {
  getAccessToken = source;
  refreshAccessToken = refresher;
}

let minting: Promise<string | null> | null = null;

/**
 * The access token to send, minting one when this window has none.
 *
 * Access tokens live in memory only, so any window that has a stored session
 * but no token yet - a reload that raced the restore, a store that was cleared
 * while the UI stayed up - has to mint one before its first call. Callers that
 * arrive while that is happening *wait for it*: sending their request anonymously
 * instead is what produced a screen full of "Missing bearer token", because the
 * pair of calls behind one screen (friends + conversations, say) go out
 * together and only the first of them was ever waiting for the token.
 *
 * The refresh call itself must not come through here - it is public, and would
 * be waiting on its own result. `publicRequest` is the door it uses.
 */
async function bearer(): Promise<string | null> {
  const token = getAccessToken();
  if (token) return token;
  minting ??= refreshAccessToken().finally(() => {
    minting = null;
  });
  return minting;
}

/**
 * A reply's body, and whether it was JSON at all.
 *
 * An empty body is reported as JSON holding `null`: a 200 with nothing in it is
 * how a few routes acknowledge a write, and no caller reads a field off that.
 * A body that is present and unparseable is the case worth separating - see
 * `requirePayload`.
 */
async function payloadOf(response: Response): Promise<{ value: unknown; json: boolean }> {
  const body = await response.text();
  if (!body) return { value: null, json: true };
  try {
    return { value: JSON.parse(body) as unknown, json: true };
  } catch {
    return { value: null, json: false };
  }
}

/**
 * A 200 whose body is not JSON is a failed request, not data.
 *
 * Nothing that answers this app replies to a successful call with anything but
 * JSON, so such a reply did not come from a service at all: in development the
 * web dev server answers a route missing from its proxy table with `index.html`
 * - and `/api/v1/remote` is deliberately missing from it, because the web
 * client has no remote-desktop section. That used to be swallowed into `null`
 * and returned as whatever type the caller asked for, so a store kept `null`
 * where it had promised an array and the first render that read a field off it
 * threw - which unmounts React's whole tree and leaves a blank window. Far
 * better to fail where the reply arrived, with the path that produced it.
 */
function requirePayload(path: string, response: Response, body: { value: unknown; json: boolean }): unknown {
  if (body.json) return body.value;
  throw new ApiError(
    'INVALID_RESPONSE',
    `${path} answered ${response.status} with something that is not JSON`,
    response.status,
  );
}

async function send<T>(path: string, init: RequestInit, token: string | null): Promise<T> {
  const sentAt = Date.now();
  const response = await fetch(`${serverUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  // Every reply carries the server's own clock in its `Date` header, so the
  // offset costs nothing to learn and is learned from whatever the app was
  // doing anyway - including the replies that failed. See services/server-clock.ts.
  sampleServerClock(sentAt, Date.now(), response.headers.get('date'));

  if (response.status === 204) return undefined as T;

  const body = await payloadOf(response);

  if (!response.ok) {
    const failure = body.value as ApiErrorBody | null;
    throw new ApiError(
      failure?.error?.code ?? 'REQUEST_FAILED',
      failure?.error?.message ?? 'Request failed',
      response.status,
    );
  }

  return requirePayload(path, response, body) as T;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  try {
    return await send<T>(path, init, await bearer());
  } catch (error) {
    // One transparent retry after refreshing an expired access token.
    if (!(error instanceof ApiError) || error.status !== 401 || !retry) throw error;
    const refreshed = await refreshAccessToken();
    if (!refreshed) throw error;
    return request<T>(path, init, false);
  }
}

/** Registration, sign-in and token refresh: no session, so no token to wait on. */
function publicRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return send<T>(path, init, null);
}

/**
 * Same contract as `request`, for a body the browser has to frame itself.
 * `fetch` sets the multipart boundary in the Content-Type header, so this one
 * must not send a Content-Type of its own.
 */
async function upload<T>(path: string, form: FormData, retry = true): Promise<T> {
  const token = await bearer();
  const response = await fetch(`${serverUrl()}${path}`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (response.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return upload<T>(path, form, false);
  }

  const body = await payloadOf(response);

  if (!response.ok) {
    const failure = body.value as ApiErrorBody | null;
    throw new ApiError(
      failure?.error?.code ?? 'UPLOAD_FAILED',
      failure?.error?.message ?? 'The upload failed',
      response.status,
    );
  }

  return requirePayload(path, response, body) as T;
}

/** Where the browser has to reach this deployment; `/start` is opened there. */
export const apiBaseUrl = (): string => serverUrl();

export const api = {
  register: (email: string, username: string, password: string): Promise<AuthResponse> =>
    publicRequest('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    }),

  login: (email: string, password: string): Promise<AuthResponse> =>
    publicRequest('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  refresh: (refreshToken: string): Promise<AuthTokens> =>
    publicRequest('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken: string): Promise<void> =>
    publicRequest('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  me: (): Promise<PublicUser> => request('/api/v1/auth/me'),

  updateAccount: (body: UpdateAccountRequest): Promise<PublicUser> =>
    request('/api/v1/auth/account', { method: 'PATCH', body: JSON.stringify(body) }),

  /** Signs every other session out; this one keeps its tokens. */
  changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
    request('/api/v1/auth/account/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /**
   * Whether a username can be registered. Cheap on the server - a Bloom filter
   * answers the common case without a query - so the sign-up form can ask while
   * somebody is still typing rather than when they press the button.
   */
  usernameAvailable: (username: string): Promise<UsernameAvailability> =>
    publicRequest(`/api/v1/auth/username-available?username=${encodeURIComponent(username)}`),

  /**
   * What can be done about a forgotten password here.
   *
   * Three answers and only one of them is about the account: a link was sent
   * (or the account does not exist - deliberately the same answer), an
   * administrator has already authorised a reset and here is the token, or this
   * deployment has no mail server and the person should ask an administrator.
   */
  forgotPassword: (identifier: string): Promise<ForgotPasswordResponse> =>
    publicRequest('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    }),

  /** Spends a reset token. The only way to set a password without the old one. */
  resetPassword: (token: string, newPassword: string): Promise<AuthResponse> =>
    publicRequest('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  /** Providers the operator enabled in the admin panel, for the login screen. */
  oauthProviders: (): Promise<OAuthProviderSummary[]> =>
    publicRequest('/api/v1/auth/oauth/providers'),

  /** Trades the one-time code the browser flow handed back for a session. */
  oauthExchange: (code: string): Promise<AuthResponse> =>
    publicRequest('/api/v1/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  servers: (): Promise<ServerWithRole[]> => request('/api/v1/servers'),

  createServer: (name: string): Promise<ServerWithRole> =>
    request('/api/v1/servers', { method: 'POST', body: JSON.stringify({ name }) }),

  joinServer: (code: string): Promise<ServerWithRole> =>
    request('/api/v1/servers/join', { method: 'POST', body: JSON.stringify({ code }) }),

  /** Whose server a code leads to, and how big it is, before joining it. */
  invitePreview: (code: string): Promise<InvitePreview> =>
    request(`/api/v1/servers/invites/${encodeURIComponent(code)}`),

  serverInvites: (serverId: string): Promise<ServerInvite[]> =>
    request(`/api/v1/servers/${serverId}/invites`),

  createServerInvite: (
    serverId: string,
    body: CreateServerInviteRequest,
  ): Promise<ServerInvite> =>
    request(`/api/v1/servers/${serverId}/invites`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revokeServerInvite: (serverId: string, code: string): Promise<ServerInvite> =>
    request(`/api/v1/servers/${serverId}/invites/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),

  updateServer: (serverId: string, body: UpdateServerRequest): Promise<ServerWithRole> =>
    request(`/api/v1/servers/${serverId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** The trail of who did what to this server. Needs MANAGE_SERVER, same as everything on it. */
  serverAudit: (serverId: string): Promise<ServerAuditEntry[]> =>
    request(`/api/v1/servers/${serverId}/audit`),

  deleteServer: (serverId: string): Promise<void> =>
    request(`/api/v1/servers/${serverId}`, { method: 'DELETE' }),

  leaveServer: (serverId: string): Promise<void> =>
    request(`/api/v1/servers/${serverId}/leave`, { method: 'POST' }),

  members: (serverId: string): Promise<ServerMember[]> =>
    request(`/api/v1/servers/${serverId}/members`),

  updateMember: (
    serverId: string,
    userId: string,
    body: UpdateServerMemberRequest,
  ): Promise<ServerMember> =>
    request(`/api/v1/servers/${serverId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** Adds someone to the server by username, from the members screen. */
  // --- A server's own emoji ---

  serverEmoji: (serverId: string): Promise<ServerEmoji[]> =>
    request(`/api/v1/servers/${serverId}/emoji`),

  addServerEmoji: (serverId: string, body: CreateServerEmojiRequest): Promise<ServerEmoji> =>
    request(`/api/v1/servers/${serverId}/emoji`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeServerEmoji: (serverId: string, emojiId: string): Promise<void> =>
    request(`/api/v1/servers/${serverId}/emoji/${emojiId}`, { method: 'DELETE' }),

  addMember: (
    serverId: string,
    username: string,
    shareHistory = false,
  ): Promise<ServerMember> =>
    request(`/api/v1/servers/${serverId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username, shareHistory }),
    }),

  removeMember: (serverId: string, userId: string): Promise<void> =>
    request(`/api/v1/servers/${serverId}/members/${userId}`, { method: 'DELETE' }),

  // --- Custom roles ---
  //
  // Additive on top of the five built-in rungs: a role here carries a name, a
  // colour and a bundle of permissions, and the built-in role is still what
  // decides who may edit whom.

  serverRoles: (serverId: string): Promise<ServerCustomRole[]> =>
    request(`/api/v1/servers/${serverId}/roles`),

  createServerRole: (serverId: string, body: CreateServerRoleRequest): Promise<ServerCustomRole> =>
    request(`/api/v1/servers/${serverId}/roles`, { method: 'POST', body: JSON.stringify(body) }),

  updateServerRole: (
    serverId: string,
    roleId: string,
    body: UpdateServerRoleRequest,
  ): Promise<ServerCustomRole> =>
    request(`/api/v1/servers/${serverId}/roles/${roleId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteServerRole: (serverId: string, roleId: string): Promise<void> =>
    request(`/api/v1/servers/${serverId}/roles/${roleId}`, { method: 'DELETE' }),

  // --- Webhooks ---
  //
  // A URL an outside system posts into a channel with. Every call here needs
  // MANAGE_WEBHOOK on the channel's server; the URL itself is returned exactly
  // twice in a webhook's life - when it is made and when it is rotated -
  // because the server keeps only a hash of the token.

  webhooks: (channelId: string): Promise<WebhookSummary[]> =>
    request(`/api/v1/webhooks?channelId=${encodeURIComponent(channelId)}`),

  createWebhook: (body: CreateWebhookRequest): Promise<WebhookWithToken> =>
    request('/api/v1/webhooks', { method: 'POST', body: JSON.stringify(body) }),

  updateWebhook: (webhookId: string, body: UpdateWebhookRequest): Promise<WebhookSummary> =>
    request(`/api/v1/webhooks/${webhookId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  rotateWebhook: (webhookId: string): Promise<WebhookWithToken> =>
    request(`/api/v1/webhooks/${webhookId}/rotate`, { method: 'POST' }),

  deleteWebhook: (webhookId: string): Promise<void> =>
    request(`/api/v1/webhooks/${webhookId}`, { method: 'DELETE' }),

  channels: (serverId: string): Promise<Channel[]> =>
    request(`/api/v1/channels?serverId=${encodeURIComponent(serverId)}`),

  // --- Channel categories ---
  //
  // Reading needs only membership. Creating, renaming, deleting and reordering
  // need MANAGE_CHANNEL, and reordering is one PUT carrying the whole new
  // arrangement so a drag is never half-applied.

  channelCategories: (serverId: string): Promise<ChannelCategory[]> =>
    request(`/api/v1/servers/${serverId}/categories`),

  createChannelCategory: (serverId: string, name: string): Promise<ChannelCategory> =>
    request(`/api/v1/servers/${serverId}/categories`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  renameChannelCategory: (
    serverId: string,
    categoryId: string,
    name: string,
  ): Promise<ChannelCategory> =>
    request(`/api/v1/servers/${serverId}/categories/${categoryId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  /** Its channels move to uncategorized; none is deleted. */
  deleteChannelCategory: (serverId: string, categoryId: string): Promise<void> =>
    request(`/api/v1/servers/${serverId}/categories/${categoryId}`, { method: 'DELETE' }),

  setChannelLayout: (serverId: string, body: ChannelLayoutRequest): Promise<ChannelLayout> =>
    request(`/api/v1/servers/${serverId}/channel-layout`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  createChannel: (body: CreateChannelRequest): Promise<Channel> =>
    request('/api/v1/channels', { method: 'POST', body: JSON.stringify(body) }),

  updateChannel: (channelId: string, body: UpdateChannelRequest): Promise<Channel> =>
    request(`/api/v1/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteChannel: (channelId: string): Promise<void> =>
    request(`/api/v1/channels/${channelId}`, { method: 'DELETE' }),

  channelMembers: (channelId: string): Promise<ChannelMember[]> =>
    request(`/api/v1/channels/${channelId}/members`),

  setChannelMembers: (channelId: string, userIds: string[]): Promise<ChannelMember[]> =>
    request(`/api/v1/channels/${channelId}/members`, {
      method: 'PUT',
      body: JSON.stringify({ userIds }),
    }),

  /**
   * A page of the channel's timeline - or, with `threadRootId`, of the thread
   * under that root. The same paging either way; the timeline never includes
   * thread replies.
   */
  messages: (
    channelId: string,
    before?: string,
    threadRootId?: string,
  ): Promise<Paginated<Message>> =>
    request(
      `/api/v1/messages?channelId=${encodeURIComponent(channelId)}` +
        (before ? `&before=${encodeURIComponent(before)}` : '') +
        (threadRootId ? `&threadRootId=${encodeURIComponent(threadRootId)}` : ''),
    ),

  /** One message by id, tombstone included - a thread's root, usually. */
  message: (messageId: string): Promise<Message> =>
    request(`/api/v1/messages/${encodeURIComponent(messageId)}`),

  /**
   * `attachmentKeys` names the blobs the sealed body carries. The server cannot
   * read the manifest, so this is the only way it can tie an upload to a
   * message - and the only way a deleted message can take its files with it.
   */
  sendMessage: (
    channelId: string,
    content: string,
    attachmentKeys?: string[],
    viewOnce?: boolean,
    /** Numbers only - the question and labels are sealed inside `content`. */
    poll?: CreatePollSettings,
    /** Posts into the thread under this root instead of the channel. */
    threadRootId?: string,
  ): Promise<Message> =>
    request('/api/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ channelId, content, attachmentKeys, viewOnce, poll, threadRootId }),
    }),

  /**
   * The threads this account follows, each with its root and unread count,
   * most recently active first. `serverId` narrows it to one server.
   */
  followedThreads: (serverId?: string): Promise<FollowedThread[]> =>
    request(
      '/api/v1/messages/threads/followed' +
        (serverId ? `?serverId=${encodeURIComponent(serverId)}` : ''),
    ),

  /** Follows or stops following the thread under `rootId`, on every device. */
  setThreadFollowing: (rootId: string, following: boolean): Promise<ThreadFollowState> =>
    request(`/api/v1/messages/${encodeURIComponent(rootId)}/thread/follow`, {
      method: following ? 'PUT' : 'DELETE',
    }),

  /** Moves this account's read marker in a thread up to the reply named. */
  readThread: (rootId: string, messageId: string): Promise<ThreadFollowState> =>
    request(`/api/v1/messages/${encodeURIComponent(rootId)}/thread/read`, {
      method: 'PUT',
      body: JSON.stringify({ messageId } satisfies MarkThreadReadRequest),
    }),

  /**
   * Replaces this account's whole ballot on a poll: option indexes, never
   * labels. An empty list takes the vote back.
   */
  votePoll: (messageId: string, options: number[]): Promise<Message> =>
    request(`/api/v1/messages/${messageId}/poll/vote`, {
      method: 'PUT',
      body: JSON.stringify({ options } satisfies VotePollRequest),
    }),

  /** Stops voting early. The author, or a moderator in a server channel. */
  closePoll: (messageId: string): Promise<Message> =>
    request(`/api/v1/messages/${messageId}/poll/close`, { method: 'POST' }),

  /** Author or moderator; the row survives as a tombstone, the body does not. */
  deleteMessage: (messageId: string): Promise<void> =>
    request(`/api/v1/messages/${messageId}`, { method: 'DELETE' }),

  /**
   * Reports that a one-time message has been opened, which is what destroys
   * it. A POST rather than a DELETE: the caller is usually not allowed to
   * delete this message and is not claiming to be - they are saying they
   * looked at it, and the destruction is the server's consequence.
   */
  burnMessage: (messageId: string): Promise<void> =>
    request(`/api/v1/messages/${messageId}/burn`, { method: 'POST' }),

  /** The author only. `content` is the replacement envelope, already sealed. */
  editMessage: (messageId: string, content: string): Promise<Message> =>
    request(`/api/v1/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),

  /** Earlier versions of an edited message, newest first, still sealed. */
  messageEdits: (messageId: string): Promise<MessageEditsResponse> =>
    request(`/api/v1/messages/${messageId}/edits`),

  /**
   * One page of pins, newest pin first. Asking for a limit opts in to the
   * paged shape; a server that predates it answers a bare array, which is the
   * whole list and has no next page.
   */
  pins: async (channelId: string, cursor?: string | null): Promise<Paginated<Message>> => {
    const answer = await request<Message[] | Paginated<Message>>(
      `/api/v1/messages/pins?channelId=${encodeURIComponent(channelId)}&limit=25` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
    );
    return Array.isArray(answer) ? { items: answer, nextCursor: null } : answer;
  },

  pinMessage: (messageId: string): Promise<Message> =>
    request(`/api/v1/messages/${messageId}/pin`, { method: 'PUT' }),

  unpinMessage: (messageId: string): Promise<Message> =>
    request(`/api/v1/messages/${messageId}/pin`, { method: 'DELETE' }),

  /** Reacting with an emoji you already chose takes it back. */
  reactToMessage: (messageId: string, emoji: string): Promise<Message> =>
    request(`/api/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  /** Fetch rich social OpenGraph details and link preview metadata for a URL. */
  unfurl: (url: string): Promise<LinkPreview | null> =>
    request(`/api/v1/messages/unfurl?url=${encodeURIComponent(url)}`),

  // --- Uploads ---
  //
  // Pictures go up as they are; attachments go up already encrypted, which is
  // why nothing here is told what the file is or what it is called.

  uploadPicture: (file: Blob, name: string): Promise<UploadedObject> => {
    const form = new FormData();
    form.append('file', file, name);
    return upload('/api/v1/uploads/picture', form);
  },

  uploadAttachment: (ciphertext: Blob): Promise<UploadedObject> => {
    const form = new FormData();
    form.append('file', ciphertext, 'blob');
    return upload('/api/v1/uploads', form);
  },

  startMultipart: (size: number): Promise<StartMultipartResponse> =>
    request('/api/v1/uploads/multipart', { method: 'POST', body: JSON.stringify({ size }) }),

  uploadPart: (ticket: string, partNumber: number, part: Blob): Promise<UploadedPart> => {
    const form = new FormData();
    form.append('ticket', ticket);
    form.append('partNumber', String(partNumber));
    form.append('file', part, 'part');
    return upload('/api/v1/uploads/multipart/part', form);
  },

  completeMultipart: (ticket: string, parts: UploadedPart[]): Promise<UploadedObject> =>
    request('/api/v1/uploads/multipart/complete', {
      method: 'POST',
      body: JSON.stringify({ ticket, parts }),
    }),

  abortMultipart: (ticket: string): Promise<void> =>
    request('/api/v1/uploads/multipart', { method: 'DELETE', body: JSON.stringify({ ticket }) }),

  /**
   * Fetches a stored object's bytes. Attachments come back as ciphertext.
   *
   * Queued and retried rather than fired off the moment something asks. See
   * the note on `objectSlot` below: this is the one door every picture, video,
   * voice note and moment goes through, so it is the one place the gateway's
   * rate limit can be answered for all of them at once.
   */
  fetchObject: (url: string): Promise<Uint8Array<ArrayBuffer>> =>
    objectSlot(async () => {
      for (let attempt = 0; ; attempt += 1) {
        const token = await bearer();
        const response = await fetch(absoluteUrl(url), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (response.ok) return new Uint8Array(await response.arrayBuffer());
        if (!worthRetrying(response.status, attempt)) {
          throw new ApiError(
            'OBJECT_NOT_FOUND',
            'That file is no longer available',
            response.status,
          );
        }
        await new Promise((resolve) => {
          setTimeout(resolve, retryDelayMs(attempt));
        });
      }
    }),

  // --- Statuses ---
  //
  // A post that expires after a day, sealed the way a message is. What differs
  // is where the audience comes from: a channel has members, a status has the
  // friend list as it stood when it was written. See the note in shared-types.

  statusFeed: (): Promise<StatusFeed> => request('/api/v1/statuses'),

  /**
   * Every device a post may be sealed for. Read immediately before posting
   * rather than cached: this list is the audience, and a friend added a minute
   * ago belongs in it.
   */
  /** @deprecated A moment is sealed for accounts - see `statusAudienceAccounts`. */
  statusAudience: (): Promise<DeviceKey[]> => request('/api/v1/statuses/audience'),

  /**
   * Every account a post written now may be sealed for. Read immediately
   * before posting rather than cached, because this list *is* the audience.
   */
  statusAudienceAccounts: (): Promise<AccountKeyRecipient[]> =>
    request('/api/v1/statuses/audience/accounts'),

  /**
   * Posts one. The media, where there is any, travels with the caption in the
   * same request: a status is one file and one button, and a two-step upload
   * leaves an orphaned blob every time somebody changes their mind between the
   * two steps.
   *
   * Everything in `draft` is already sealed by the caller - the caption is an
   * envelope, `media` is ciphertext, and `keys` is the bundle of wraps that
   * decides who can open either.
   */
  postStatus: (draft: CreateStatusRequest, media?: Blob): Promise<StatusEntry> => {
    const form = new FormData();
    form.append('kind', draft.kind);
    if (draft.caption) form.append('caption', draft.caption);
    if (draft.background) form.append('background', draft.background);
    if (draft.durationMs !== undefined) form.append('durationMs', String(draft.durationMs));
    if (draft.mediaIv) form.append('mediaIv', draft.mediaIv);
    if (draft.mediaType) form.append('mediaType', draft.mediaType);
    form.append('senderDeviceId', draft.senderDeviceId);
    // Multipart has no arrays, so the bundle travels as JSON in one field and
    // is parsed back by the DTO. See `parseKeys` in the controller.
    form.append('keys', JSON.stringify(draft.keys));
    if (media) form.append('file', media, 'status');
    return upload('/api/v1/statuses', form);
  },

  markStatusSeen: (statusId: string): Promise<void> =>
    request(`/api/v1/statuses/${statusId}/view`, { method: 'POST' }),

  /** One symbol back. Sending the one already there takes it back. */
  reactToStatus: (statusId: string, emoji: string): Promise<void> =>
    request(`/api/v1/statuses/${statusId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),

  statusViewers: (statusId: string): Promise<StatusViewer[]> =>
    request(`/api/v1/statuses/${statusId}/views`),

  deleteStatus: (statusId: string): Promise<void> =>
    request(`/api/v1/statuses/${statusId}`, { method: 'DELETE' }),

  // --- Friends and direct messages ---

  /**
   * Finds people by name. `friendsOnly` is for the add-to-server picker: the
   * server refuses to add somebody you are not friends with, so offering them
   * would be offering a refusal.
   */
  searchUsers: (query: string, friendsOnly = false): Promise<UserSummary[]> =>
    request(
      `/api/v1/users/search?q=${encodeURIComponent(query)}` +
        (friendsOnly ? '&friendsOnly=true' : ''),
    ),

  friends: (): Promise<Friend[]> => request('/api/v1/friends'),

  addFriend: (username: string): Promise<Friend> =>
    request('/api/v1/friends', { method: 'POST', body: JSON.stringify({ username }) }),

  acceptFriend: (userId: string): Promise<Friend> =>
    request(`/api/v1/friends/${userId}/accept`, { method: 'POST' }),

  removeFriend: (userId: string): Promise<void> =>
    request(`/api/v1/friends/${userId}`, { method: 'DELETE' }),

  /** Everyone this account has blocked, most recent first. */
  blocked: (): Promise<BlockedUser[]> => request('/api/v1/blocks'),

  /**
   * Blocks somebody. It also ends the friendship, and closes the conversation
   * for both sides - the messages stay where they are, and come back if the
   * block is ever lifted.
   */
  blockUser: (userId: string): Promise<BlockedUser> =>
    request('/api/v1/blocks', { method: 'POST', body: JSON.stringify({ userId }) }),

  unblockUser: (userId: string): Promise<void> =>
    request(`/api/v1/blocks/${userId}`, { method: 'DELETE' }),

  /**
   * Hides messages from this account's own view, on all of its devices: one
   * conversation with a `channelId`, every one of them without. Nobody else's
   * copy moves - see the server's `clearChats`.
   */
  clearChats: (channelId?: string): Promise<ClearChatsResponse> =>
    request('/api/v1/messages/clear', {
      method: 'POST',
      body: JSON.stringify(channelId ? { channelId } : {}),
    }),

  directChannels: (): Promise<DirectChannel[]> => request('/api/v1/dm'),

  openDirectChannel: (userId: string): Promise<DirectChannel> =>
    request('/api/v1/dm', { method: 'POST', body: JSON.stringify({ userId }) }),

  /** Adds a friend to a conversation already in progress. Any current member may. */
  addDirectMember: (channelId: string, userId: string): Promise<DirectChannel> =>
    request(`/api/v1/dm/${channelId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  // --- The account vault ---
  //
  // One identity keyring per account, sealed under a master key the server
  // never sees, with one row per way of opening it. This is what replaced the
  // per-machine identity backup, and the reason a new device now reads the
  // whole history instead of the part somebody's other laptop got round to
  // re-wrapping for it.

  /**
   * The caller's sealed vault, or an explicit null.
   *
   * A *failed* call must never be read as "this account has no vault": that
   * would publish a second identity over a standing one and orphan every key
   * wrapped for the first, with no undo. It throws, and `initIdentity`
   * retries.
   */
  vault: (): Promise<AccountVaultResponse> => request('/api/v1/e2ee/vault'),

  createVault: (body: CreateVaultRequest): Promise<AccountVaultResponse> =>
    request('/api/v1/e2ee/vault', { method: 'POST', body: JSON.stringify(body) }),

  rotateVault: (body: RotateVaultRequest): Promise<AccountVaultResponse> =>
    request('/api/v1/e2ee/vault/rotate', { method: 'POST', body: JSON.stringify(body) }),

  /** The master key the server holds for this account, or null. */
  vaultEscrow: (): Promise<VaultEscrowResponse> => request('/api/v1/e2ee/vault/escrow'),

  putVaultEscrow: (masterKey: string): Promise<{ ok: true }> =>
    request('/api/v1/e2ee/vault/escrow', { method: 'PUT', body: JSON.stringify({ masterKey }) }),

  /** Starts over a vault nobody can open. Refused while the server holds its key. */
  resetVault: (): Promise<{ ok: true }> => request('/api/v1/e2ee/vault/reset', { method: 'POST' }),

  putVaultFactor: (body: PutVaultFactorRequest): Promise<{ ok: true }> =>
    request('/api/v1/e2ee/vault/factors', { method: 'PUT', body: JSON.stringify(body) }),

  /** Refused by the server when it would leave no portable way back in. */
  deleteVaultFactor: (kind: PortableFactorKind): Promise<{ ok: true }> =>
    request(`/api/v1/e2ee/vault/factors/${kind}`, { method: 'DELETE' }),

  requestVaultGrant: (body: {
    deviceId: string;
    publicKey: string;
    label: string;
    fingerprint: string;
  }): Promise<{ ok: true }> =>
    request('/api/v1/e2ee/vault/grants', { method: 'POST', body: JSON.stringify(body) }),

  /** Machines of this account waiting to be let in. Never anybody else's. */
  vaultGrants: (): Promise<VaultGrantsResponse> => request('/api/v1/e2ee/vault/grants'),

  /** Whether this machine has been let in - what the locked screen polls. */
  vaultGrant: (deviceId: string): Promise<{ factor: VaultFactor | null }> =>
    request(`/api/v1/e2ee/vault/grants/${encodeURIComponent(deviceId)}`),

  denyVaultGrant: (deviceId: string): Promise<{ ok: true }> =>
    request(`/api/v1/e2ee/vault/grants/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),

  /** How much of this account's history survives losing every machine. */
  keyHealth: (): Promise<KeyHealthResponse> => request('/api/v1/e2ee/health'),

  // --- End-to-end encryption key directory ---

  registerDeviceKey: (body: RegisterDeviceKeyRequest): Promise<DeviceKey> =>
    request('/api/v1/e2ee/devices', { method: 'POST', body: JSON.stringify(body) }),

  /** This account's own machines, for the list that can revoke one. */
  myDevices: (): Promise<DeviceKey[]> => request('/api/v1/e2ee/devices/mine'),

  revokeDevice: (deviceId: string): Promise<DeviceKey> =>
    request(`/api/v1/e2ee/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),

  /** This account's sealed identity keys, for a machine that holds none. */
  identityBackup: (): Promise<IdentityBackupResponse> => request('/api/v1/e2ee/backup'),

  putIdentityBackup: (body: PutIdentityBackupRequest): Promise<{ ok: true }> =>
    request('/api/v1/e2ee/backup', { method: 'PUT', body: JSON.stringify(body) }),

  /** Drops one kind of backup. See `setPasswordRecovery` in `services/e2ee.ts`. */
  deleteIdentityBackup: (kind: BackupSecretKind): Promise<{ ok: true }> =>
    request(`/api/v1/e2ee/backup/${kind}`, { method: 'DELETE' }),

  /** @deprecated Channel keys are wrapped for accounts - see `channelRecipients`. */
  channelDevices: (channelId: string): Promise<DeviceKey[]> =>
    request(`/api/v1/e2ee/devices?channelId=${encodeURIComponent(channelId)}`),

  /** Who a channel key must be wrapped for: one entry per member account. */
  channelRecipients: (channelId: string): Promise<AccountKeyRecipient[]> =>
    request(`/api/v1/e2ee/recipients?channelId=${encodeURIComponent(channelId)}`),

  /**
   * Channels this account holds any wrap for, so a client that has just
   * unlocked the vault can sweep them and promote what only it can open.
   */
  channelsWithKeys: (): Promise<string[]> => request('/api/v1/e2ee/channels'),

  channelKeys: (channelId: string): Promise<ChannelKeysResponse> =>
    request(`/api/v1/e2ee/keys/${encodeURIComponent(channelId)}`),

  publishChannelKeys: (body: PublishChannelKeysRequest): Promise<{ epoch: number; stored: number }> =>
    request('/api/v1/e2ee/keys', { method: 'POST', body: JSON.stringify(body) }),

  // --- Notifications ---

  notificationPreferences: (): Promise<NotificationPreferences> =>
    request('/api/v1/notifications/preferences'),

  /**
   * The application server key a browser needs before it can subscribe. Null
   * on a deployment that has configured no VAPID keys, which is the answer
   * that stops the client prompting for a permission it could not use.
   */
  pushKey: (): Promise<PushKeyResponse> => request('/api/v1/notifications/devices/key'),

  /** Registers this browser's push subscription, or a phone's FCM token. */
  registerPushDevice: (body: RegisterDeviceRequest): Promise<RegisteredDevice> =>
    request('/api/v1/notifications/devices', { method: 'POST', body: JSON.stringify(body) }),

  unregisterPushDevice: (device: string): Promise<{ ok: true }> =>
    request(`/api/v1/notifications/devices/${encodeURIComponent(device)}`, { method: 'DELETE' }),

  updateNotificationPreferences: (
    body: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> =>
    request('/api/v1/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  unread: (): Promise<ChannelUnread[]> => request('/api/v1/notifications/unread'),

  /** Who else has read this channel, and up to when. */
  channelReads: (channelId: string): Promise<ChannelReadReceipt[]> =>
    request(`/api/v1/notifications/channels/${encodeURIComponent(channelId)}/reads`),

  markChannelRead: (channelId: string): Promise<ChannelUnread> =>
    request('/api/v1/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    }),

  // --- Remote desktop ---

  /** Machines this account owns, plus the ones it holds a live grant on. */
  machines: (): Promise<RemoteMachineSummary[]> => request('/api/v1/remote/machines'),

  /** The agent's own call. `machineId` re-enrols and rotates the token. */
  enrolMachine: (name: string, platform: string, machineId?: string): Promise<EnrolMachineResponse> =>
    request('/api/v1/remote/machines', {
      method: 'POST',
      body: JSON.stringify({ name, platform, ...(machineId ? { machineId } : {}) }),
    }),

  renameMachine: (machineId: string, name: string): Promise<RemoteMachineSummary> =>
    request(`/api/v1/remote/machines/${machineId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  removeMachine: (machineId: string): Promise<void> =>
    request(`/api/v1/remote/machines/${machineId}`, { method: 'DELETE' }),

  machineGrants: (machineId: string): Promise<RemoteGrantSummary[]> =>
    request(`/api/v1/remote/machines/${machineId}/grants`),

  /** An empty permission list revokes; there is no separate delete. */
  setMachineGrant: (
    machineId: string,
    userId: string,
    permissions: RemotePermission[],
    expiresAt?: string | null,
  ): Promise<RemoteGrantSummary[]> =>
    request(`/api/v1/remote/machines/${machineId}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ userId, permissions, expiresAt: expiresAt ?? null }),
    }),

  machineAudit: (machineId: string): Promise<RemoteAuditEntry[]> =>
    request(`/api/v1/remote/machines/${machineId}/audit`),

  startRemoteSession: (machineId: string): Promise<RemoteSessionResponse> =>
    request('/api/v1/remote/sessions', { method: 'POST', body: JSON.stringify({ machineId }) }),

  /**
   * Ends a session, carrying what this machine counted while it was up.
   *
   * The usage is optional because a session can end without anybody being in a
   * position to measure it - the window died, the socket went first. A row with
   * no figures reads as zero, which is exactly what it is.
   */
  endRemoteSession: (sessionId: string, usage?: RemoteSessionUsage): Promise<void> =>
    request(`/api/v1/remote/sessions/${sessionId}`, {
      method: 'DELETE',
      body: JSON.stringify(usage ?? {}),
    }),

  /** This account's own remote sessions over a window, and what they moved. */
  remoteUsage: (days = 30): Promise<RemoteUsageReport> =>
    request(`/api/v1/remote/usage?days=${days}`),

  // --- Calls ---

  /**
   * How to reach the other peers - STUN, and TURN when this deployment
   * configures one. Deliberately not "where the media server is": there is not
   * one, and nothing here ever hands a client an address to dial.
   */
  callIce: (channelId: string): Promise<CallIceResponse> =>
    request('/api/v1/calls/ice', { method: 'POST', body: JSON.stringify({ channelId }) }),

  /**
   * "Come into this call." Answers 204, or a 403 saying why not - they are not
   * in this channel, or they were rung a moment ago and the cooldown holds.
   */
  /**
   * This account's own call log, newest first. The server decides whose, so
   * there is nothing to pass and nothing to get wrong.
   */
  callHistory: (): Promise<CallHistoryEntry[]> => request('/api/v1/calls/history'),

  /**
   * The same calls added up over a window of days. Read separately from the log
   * because the log is the last 50 calls and this is the last 30 days, and one
   * is not a slice of the other.
   */
  callAnalytics: (days = 30): Promise<CallAnalytics> =>
    request(`/api/v1/calls/analytics?days=${days}`),

  callRing: (channelId: string, userId: string): Promise<void> =>
    request('/api/v1/calls/ring', {
      method: 'POST',
      body: JSON.stringify({ channelId, userId }),
    }),

  /**
   * "I said no to that, here."
   *
   * Reaches this account's own other devices and nobody else - the caller is
   * deliberately not told. See `CallsService.decline`.
   */
  callDecline: (channelId: string): Promise<void> =>
    request('/api/v1/calls/decline', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    }),
};
