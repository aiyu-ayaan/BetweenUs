import type {
  ApiErrorBody,
  AuthResponse,
  AuthTokens,
  CallTokenResponse,
  Channel,
  ChannelKeysResponse,
  ChannelMember,
  CreateChannelRequest,
  DeviceKey,
  DirectChannel,
  Friend,
  Message,
  OAuthProviderSummary,
  Paginated,
  PublicUser,
  PublishChannelKeysRequest,
  ServerMember,
  ServerWithRole,
  UpdateChannelRequest,
  UpdateServerMemberRequest,
  UpdateServerRequest,
  UserSummary,
} from '@nexora/shared-types';

// In development requests go to the Vite dev server, which proxies them to the
// services (see vite.config.ts). A packaged build talks to the Nginx gateway.
const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '' : 'http://localhost:8080');

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
  const response = await fetch(`${API_URL}${path}`, {
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

/** Where the browser has to reach this deployment; `/start` is opened there. */
export const apiBaseUrl = (): string => API_URL || window.location.origin;

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

  // --- Calls ---

  callToken: (channelId: string): Promise<CallTokenResponse> =>
    request('/api/v1/calls/token', { method: 'POST', body: JSON.stringify({ channelId }) }),
};
