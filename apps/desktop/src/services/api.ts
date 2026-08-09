import type {
  ApiErrorBody,
  AuthResponse,
  AuthTokens,
  CallTokenResponse,
  Channel,
  ChannelKeysResponse,
  ChannelMember,
  ChannelUnread,
  CreateChannelRequest,
  DeviceKey,
  DirectChannel,
  Friend,
  Message,
  NotificationPreferences,
  OAuthProviderSummary,
  Paginated,
  PublicUser,
  PublishChannelKeysRequest,
  ServerMember,
  ServerWithRole,
  StartMultipartResponse,
  UploadedObject,
  UploadedPart,
  UpdateAccountRequest,
  UpdateChannelRequest,
  UpdateNotificationPreferencesRequest,
  UpdateServerMemberRequest,
  UpdateServerRequest,
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

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${serverUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  // One transparent retry after refreshing an expired access token.
  if (response.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, init, false);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? 'Request failed',
      response.status,
    );
  }

  return payload as T;
}

/**
 * Same contract as `request`, for a body the browser has to frame itself.
 * `fetch` sets the multipart boundary in the Content-Type header, so this one
 * must not send a Content-Type of its own.
 */
async function upload<T>(path: string, form: FormData, retry = true): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${serverUrl()}${path}`, {
    method: 'POST',
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (response.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return upload<T>(path, form, false);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      body?.error?.code ?? 'UPLOAD_FAILED',
      body?.error?.message ?? 'The upload failed',
      response.status,
    );
  }

  return payload as T;
}

/** Where the browser has to reach this deployment; `/start` is opened there. */
export const apiBaseUrl = (): string => serverUrl();

export const api = {
  register: (email: string, username: string, password: string): Promise<AuthResponse> =>
    request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    }),

  login: (email: string, password: string): Promise<AuthResponse> =>
    request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  refresh: (refreshToken: string): Promise<AuthTokens> =>
    request('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken: string): Promise<void> =>
    request('/api/v1/auth/logout', {
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
  oauthProviders: (): Promise<OAuthProviderSummary[]> => request('/api/v1/auth/oauth/providers'),

  /** Trades the one-time code the browser flow handed back for a session. */
  oauthExchange: (code: string): Promise<AuthResponse> =>
    request('/api/v1/auth/oauth/exchange', { method: 'POST', body: JSON.stringify({ code }) }),

  servers: (): Promise<ServerWithRole[]> => request('/api/v1/servers'),

  createServer: (name: string): Promise<ServerWithRole> =>
    request('/api/v1/servers', { method: 'POST', body: JSON.stringify({ name }) }),

  joinServer: (slug: string): Promise<ServerWithRole> =>
    request('/api/v1/servers/join', { method: 'POST', body: JSON.stringify({ slug }) }),

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
  addMember: (serverId: string, username: string): Promise<ServerMember> =>
    request(`/api/v1/servers/${serverId}/members`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),

  removeMember: (serverId: string, userId: string): Promise<void> =>
    request(`/api/v1/servers/${serverId}/members/${userId}`, { method: 'DELETE' }),

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

  sendMessage: (channelId: string, content: string): Promise<Message> =>
    request('/api/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ channelId, content }),
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
    const token = getAccessToken();
    const response = await fetch(absoluteUrl(url), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      throw new ApiError('OBJECT_NOT_FOUND', 'That file is no longer available', response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
  },

  // --- Friends and direct messages ---

  searchUsers: (query: string): Promise<UserSummary[]> =>
    request(`/api/v1/users/search?q=${encodeURIComponent(query)}`),

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

  registerDeviceKey: (publicKey: string): Promise<DeviceKey> =>
    request('/api/v1/e2ee/devices', { method: 'POST', body: JSON.stringify({ publicKey }) }),

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

  // --- Calls ---

  callToken: (channelId: string): Promise<CallTokenResponse> =>
    request('/api/v1/calls/token', { method: 'POST', body: JSON.stringify({ channelId }) }),
};
