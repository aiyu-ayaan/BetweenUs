import type {
  ApiErrorBody,
  AuthResponse,
  AuthTokens,
  Channel,
  Message,
  Paginated,
  PublicUser,
  WorkspaceMember,
  WorkspaceWithRole,
} from '@nexora/shared-types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

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

  workspaces: (): Promise<WorkspaceWithRole[]> => request('/api/v1/workspaces'),

  createWorkspace: (name: string): Promise<WorkspaceWithRole> =>
    request('/api/v1/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),

  joinWorkspace: (slug: string): Promise<WorkspaceWithRole> =>
    request('/api/v1/workspaces/join', { method: 'POST', body: JSON.stringify({ slug }) }),

  members: (workspaceId: string): Promise<WorkspaceMember[]> =>
    request(`/api/v1/workspaces/${workspaceId}/members`),

  channels: (workspaceId: string): Promise<Channel[]> =>
    request(`/api/v1/channels?workspaceId=${encodeURIComponent(workspaceId)}`),

  createChannel: (workspaceId: string, name: string): Promise<Channel> =>
    request('/api/v1/channels', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name }),
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
};
