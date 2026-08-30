/**
 * Admin panel API client.
 *
 * Same contract as the desktop client's: bearer access token, refresh on 401,
 * one retry. The refresh token lives in localStorage under its own key so a
 * panel session and a chat session on the same host do not overwrite each
 * other.
 */
import type {
  AdminAuditPage,
  AdminOAuthProvider,
  AdminOAuthProviderUpdate,
  AdminSmtpSettings,
  AdminSmtpTestResult,
  AdminServerHealth,
  AdminSmtpUpdate,
  AdminStatus,
  AdminUser,
  AdminUserPage,
  AdminUserUpdate,
  ApiErrorBody,
  AuthResponse,
  AuthTokens,
  OAuthProviderSummary,
  PublicUser,
} from '@betweenus/shared-types';

// Optional chaining rather than a plain read: `import.meta.env` is Vite's, and
// this module is also pulled in by the screens' self-checks, which run under
// plain Node where it does not exist at all. An empty base URL is what the
// browser bundle gets anyway when the variable is unset.
const API_URL = import.meta.env?.VITE_API_URL ?? '';
const REFRESH_KEY = 'betweenus.admin.refreshToken';

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

let accessToken: string | null = null;

export const session = {
  get token(): string | null {
    return accessToken;
  },
  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  start(tokens: AuthTokens): void {
    accessToken = tokens.accessToken;
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  end(): void {
    accessToken = null;
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Single-flight, because refresh tokens rotate and a race kills the session. */
let refreshInFlight: Promise<string | null> | null = null;

async function refresh(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const stored = session.refreshToken;
    if (!stored) return null;
    try {
      const tokens = await request<AuthTokens>(
        '/api/v1/auth/refresh',
        { method: 'POST', body: JSON.stringify({ refreshToken: stored }) },
        false,
      );
      session.start(tokens);
      return tokens.accessToken;
    } catch {
      session.end();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && retry && session.refreshToken) {
    const refreshed = await refresh();
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

/** Rows per request. Small enough that the first page draws immediately. */
const PAGE_SIZE = 50;

export const api = {
  /** Public - answers whether `pnpm admin:create` has been run. */
  status: (): Promise<AdminStatus> => request('/api/v1/admin/status'),

  /** Public - which sign-in providers the operator switched on. */
  signInProviders: (): Promise<OAuthProviderSummary[]> =>
    request('/api/v1/auth/oauth/providers'),

  /**
   * Where to send the browser to sign in with a provider. It comes back to this
   * origin with `?code=`, which `exchangeOAuthCode` trades for a session.
   */
  signInUrl: (provider: string): string =>
    `${API_URL}/api/v1/auth/oauth/${provider}/start?redirect=${encodeURIComponent(
      `${window.location.origin}${window.location.pathname}`,
    )}`,

  exchangeOAuthCode: (code: string): Promise<AuthResponse> =>
    request('/api/v1/auth/oauth/exchange', { method: 'POST', body: JSON.stringify({ code }) }),

  login: (identifier: string, password: string): Promise<AuthResponse> =>
    request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: identifier, password }),
    }),

  me: (): Promise<PublicUser> => request('/api/v1/auth/me'),

  logout: (refreshToken: string): Promise<void> =>
    request('/api/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),

  changePassword: (currentPassword: string, newPassword: string): Promise<AuthResponse> =>
    request('/api/v1/auth/account/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  updateAccount: (update: { username?: string; displayName?: string }): Promise<PublicUser> =>
    request('/api/v1/auth/account', { method: 'PATCH', body: JSON.stringify(update) }),

  users: (query: string, cursor?: string): Promise<AdminUserPage> =>
    request(
      `/api/v1/admin/users?query=${encodeURIComponent(query)}&take=${PAGE_SIZE}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
    ),

  audit: (cursor?: string): Promise<AdminAuditPage> =>
    request(
      `/api/v1/admin/audit?take=${PAGE_SIZE}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
    ),

  updateUser: (id: string, update: AdminUserUpdate): Promise<AdminUser> =>
    request(`/api/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(update) }),

  deleteUser: (id: string): Promise<void> =>
    request(`/api/v1/admin/users/${id}`, { method: 'DELETE' }),

  smtp: (): Promise<AdminSmtpSettings> => request('/api/v1/admin/smtp'),

  updateSmtp: (update: AdminSmtpUpdate): Promise<AdminSmtpSettings> =>
    request('/api/v1/admin/smtp', { method: 'PUT', body: JSON.stringify(update) }),

  testSmtp: (to?: string): Promise<AdminSmtpTestResult> =>
    request('/api/v1/admin/smtp/test', { method: 'POST', body: JSON.stringify(to ? { to } : {}) }),

  /**
   * One snapshot of the deployment: dependencies, runtime, storage, traffic and
   * live sockets. `days` sizes the bandwidth window only; everything else is
   * measured at the moment of the call, so this is polled rather than cached.
   */
  health: (days?: number): Promise<AdminServerHealth> =>
    request(`/api/v1/admin/health${days === undefined ? '' : `?days=${days}`}`),

  oauthProviders: (): Promise<AdminOAuthProvider[]> => request('/api/v1/admin/oauth'),

  updateOAuthProvider: (
    provider: string,
    update: AdminOAuthProviderUpdate,
  ): Promise<AdminOAuthProvider> =>
    request(`/api/v1/admin/oauth/${provider}`, { method: 'PUT', body: JSON.stringify(update) }),
};

export { refresh as refreshSession };
