import type {
  CreateServerInviteRequest,
  ApiErrorBody,
  AuthResponse,
  AuthTokens,
  CallIceResponse,
  Channel,
  InvitePreview,
  ChannelKeysResponse,
  ChannelMember,
  ChannelUnread,
  CreateChannelRequest,
  EnrolMachineResponse,
  DeviceKey,
  DirectChannel,
  Friend,
  IdentityBackupResponse,
  Message,
  NotificationPreferences,
  OAuthProviderSummary,
  Paginated,
  PublicUser,
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
  CreateServerRoleRequest,
  ServerCustomRole,
  ServerMember,
  ServerInvite,
  ServerWithRole,
  StartMultipartResponse,
  UploadedObject,
  UploadedPart,
  UpdateAccountRequest,
  UpdateChannelRequest,
  UpdateNotificationPreferencesRequest,
  UpdateServerMemberRequest,
  UpdateServerRequest,
  UpdateServerRoleRequest,
  UserSummary,
} from '@nexora/shared-types';

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
  const response = await fetch(`${serverUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

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

  addMember: (serverId: string, username: string): Promise<ServerMember> =>
    request(`/api/v1/servers/${serverId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username }),
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

  channels: (serverId: string): Promise<Channel[]> =>
    request(`/api/v1/channels?serverId=${encodeURIComponent(serverId)}`),

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

  messages: (channelId: string, before?: string): Promise<Paginated<Message>> =>
    request(
      `/api/v1/messages?channelId=${encodeURIComponent(channelId)}` +
        (before ? `&before=${encodeURIComponent(before)}` : ''),
    ),

  /**
   * `attachmentKeys` names the blobs the sealed body carries. The server cannot
   * read the manifest, so this is the only way it can tie an upload to a
   * message - and the only way a deleted message can take its files with it.
   */
  sendMessage: (channelId: string, content: string, attachmentKeys?: string[]): Promise<Message> =>
    request('/api/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ channelId, content, attachmentKeys }),
    }),

  /** Author or moderator; the row survives as a tombstone, the body does not. */
  deleteMessage: (messageId: string): Promise<void> =>
    request(`/api/v1/messages/${messageId}`, { method: 'DELETE' }),

  /** The author only. `content` is the replacement envelope, already sealed. */
  editMessage: (messageId: string, content: string): Promise<Message> =>
    request(`/api/v1/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),

  pins: (channelId: string): Promise<Message[]> =>
    request(`/api/v1/messages/pins?channelId=${encodeURIComponent(channelId)}`),

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

  /** Fetches a stored object's bytes. Attachments come back as ciphertext. */
  fetchObject: async (url: string): Promise<Uint8Array<ArrayBuffer>> => {
    const token = await bearer();
    const response = await fetch(absoluteUrl(url), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      throw new ApiError('OBJECT_NOT_FOUND', 'That file is no longer available', response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
  },

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

  directChannels: (): Promise<DirectChannel[]> => request('/api/v1/dm'),

  openDirectChannel: (userId: string): Promise<DirectChannel> =>
    request('/api/v1/dm', { method: 'POST', body: JSON.stringify({ userId }) }),

  // --- End-to-end encryption key directory ---

  registerDeviceKey: (body: RegisterDeviceKeyRequest): Promise<DeviceKey> =>
    request('/api/v1/e2ee/devices', { method: 'POST', body: JSON.stringify(body) }),

  /** This account's own machines, for the list that can revoke one. */
  myDevices: (): Promise<DeviceKey[]> => request('/api/v1/e2ee/devices/mine'),

  revokeDevice: (deviceId: string): Promise<DeviceKey> =>
    request(`/api/v1/e2ee/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),

  /** This account's sealed identity key, for a machine that holds none. */
  identityBackup: (): Promise<IdentityBackupResponse> => request('/api/v1/e2ee/backup'),

  putIdentityBackup: (body: PutIdentityBackupRequest): Promise<{ ok: true }> =>
    request('/api/v1/e2ee/backup', { method: 'PUT', body: JSON.stringify(body) }),

  channelDevices: (channelId: string): Promise<DeviceKey[]> =>
    request(`/api/v1/e2ee/devices?channelId=${encodeURIComponent(channelId)}`),

  channelKeys: (channelId: string): Promise<ChannelKeysResponse> =>
    request(`/api/v1/e2ee/keys/${encodeURIComponent(channelId)}`),

  publishChannelKeys: (body: PublishChannelKeysRequest): Promise<{ epoch: number; stored: number }> =>
    request('/api/v1/e2ee/keys', { method: 'POST', body: JSON.stringify(body) }),

  // --- Notifications ---

  notificationPreferences: (): Promise<NotificationPreferences> =>
    request('/api/v1/notifications/preferences'),

  updateNotificationPreferences: (
    body: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationPreferences> =>
    request('/api/v1/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  unread: (): Promise<ChannelUnread[]> => request('/api/v1/notifications/unread'),

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

  endRemoteSession: (sessionId: string): Promise<void> =>
    request(`/api/v1/remote/sessions/${sessionId}`, { method: 'DELETE' }),

  // --- Calls ---

  /**
   * How to reach the other peers - STUN, and TURN when this deployment
   * configures one. Deliberately not "where the media server is": there is not
   * one, and nothing here ever hands a client an address to dial.
   */
  callIce: (channelId: string): Promise<CallIceResponse> =>
    request('/api/v1/calls/ice', { method: 'POST', body: JSON.stringify({ channelId }) }),
};
