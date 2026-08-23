import { create } from 'zustand';
import type { PublicUser } from '@betweenus/shared-types';
import { ApiError, api, apiBaseUrl, configureApi } from '../services/api';
import { chatSocket, presenceSocket } from '../services/socket';
import { initIdentity, resetE2ee, type BackupSecret } from '../services/e2ee';
import { cache } from '../services/cache';

/** Both realtime sockets carry the same access token and reconnect together. */
function connectSockets(accessToken: string): void {
  chatSocket.connect(accessToken);
  presenceSocket.connect(accessToken);
}

const STORAGE_KEY = 'betweenus.refreshToken';
/**
 * The address of the last account signed in on this machine, so the form comes
 * back filled in. Only the address: a password belongs in the OS keychain or
 * nowhere, and the refresh token above is what actually keeps a session alive
 * across restarts.
 */
const EMAIL_KEY = 'betweenus.lastEmail';

/** Prefills the login form. Empty on a machine nobody has signed in on. */
export function rememberedEmail(): string {
  return localStorage.getItem(EMAIL_KEY) ?? '';
}

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  status: 'idle' | 'loading' | 'authenticated';
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithProvider: (provider: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  restore: () => Promise<void>;
  /** Re-reads the profile after it has been edited in settings. */
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  error: null,

  clearError: () => set({ error: null }),

  refreshUser: async () => {
    set({ user: await api.me() });
  },

  login: async (email, password) => {
    set({ status: 'loading', error: null });
    try {
      const result = await api.login(email, password);
      localStorage.setItem(EMAIL_KEY, email);
      applySession(set, result.accessToken, result.refreshToken, result.user, {
        value: password,
        kind: 'password',
      });
    } catch (error) {
      set({ status: 'idle', error: messageOf(error) });
    }
  },

  /**
   * Provider sign-in. The browser does the provider part; this window only
   * waits for the one-time code and trades it for a session.
   */
  loginWithProvider: async (provider) => {
    const bridge = window.betweenus;
    if (!bridge) {
      // In a tab the page itself is the redirect target: leave for the provider
      // and come back with `?code=`, which `restore` trades for a session. The
      // desktop app cannot do this - it has no origin to be sent back to, which
      // is what its loopback server stands in for.
      set({ status: 'loading', error: null });
      const back = `${window.location.origin}${window.location.pathname}`;
      window.location.assign(
        `${apiBaseUrl()}/api/v1/auth/oauth/${provider}/start?redirect=${encodeURIComponent(back)}`,
      );
      return;
    }

    set({ status: 'loading', error: null });
    try {
      const code = await bridge.startOAuth(
        `${apiBaseUrl()}/api/v1/auth/oauth/${provider}/start`,
      );
      if (!code) {
        set({ status: 'idle', error: 'Sign-in was cancelled' });
        return;
      }
      const result = await api.oauthExchange(code);
      applySession(set, result.accessToken, result.refreshToken, result.user);
    } catch (error) {
      set({ status: 'idle', error: messageOf(error) });
    }
  },

  register: async (email, username, password) => {
    set({ status: 'loading', error: null });
    try {
      const result = await api.register(email, username, password);
      localStorage.setItem(EMAIL_KEY, email);
      applySession(set, result.accessToken, result.refreshToken, result.user, {
        value: password,
        kind: 'password',
      });
    } catch (error) {
      set({ status: 'idle', error: messageOf(error) });
    }
  },

  /** Silent sign-in on launch using the stored refresh token. */
  restore: async () => {
    // A provider sign-in that went through the browser comes back here, as a
    // one-time code on the URL. Taken off the address bar either way: a code is
    // single use, and leaving a spent one in the history is noise at best.
    const returned = new URLSearchParams(window.location.search).get('code');
    if (returned) {
      window.history.replaceState(null, '', window.location.pathname);
      set({ status: 'loading', error: null });
      try {
        const result = await api.oauthExchange(returned);
        applySession(set, result.accessToken, result.refreshToken, result.user);
        return;
      } catch (error) {
        set({ status: 'idle', error: messageOf(error) });
        return;
      }
    }

    if (!localStorage.getItem(STORAGE_KEY)) return;

    set({ status: 'loading' });
    const accessToken = await refreshSession();
    if (!accessToken) {
      set({ status: 'idle' });
      return;
    }

    try {
      const user = await api.me();
      // Before anything reads from it: a cache belonging to another account has
      // to be gone, not merely about to be.
      await cache.claim(user.id).catch(() => undefined);
      set({ user, status: 'authenticated', error: null });
      void initIdentity(user.id).catch(() => undefined);
    } catch {
      set({ status: 'idle' });
    }
  },

  logout: async () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    chatSocket.disconnect();
    presenceSocket.disconnect();
    resetE2ee();
    localStorage.removeItem(STORAGE_KEY);
    // Only a deliberate sign-out empties the cache. A session that expired on
    // its own is coming back, and should come back instantly.
    void cache.clear().catch(() => undefined);
    set({ user: null, accessToken: null, status: 'idle' });
    if (stored) await api.logout(stored).catch(() => undefined);
  },
}));

type Setter = (partial: Partial<AuthState>) => void;

function applySession(
  set: Setter,
  accessToken: string,
  refreshToken: string,
  user: PublicUser,
  secret?: BackupSecret,
): void {
  localStorage.setItem(STORAGE_KEY, refreshToken);
  void cache.claim(user.id).catch(() => undefined);
  set({ user, accessToken, status: 'authenticated', error: null });
  connectSockets(accessToken);
  // Device key setup runs alongside the first server load; everything that
  // needs key material awaits the same promise, so the order does not matter.
  //
  // The password goes with it and no further: it is what unseals this account's
  // identity backup on a machine that holds no key yet, which is what makes the
  // account work anywhere rather than only where it was created. It is never
  // stored, and the server never receives anything derived from it.
  void initIdentity(user.id, secret).catch(() => undefined);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Could not reach the server. Is the backend running?';
}

/**
 * Refresh tokens rotate, so two concurrent refreshes would race and one of them
 * would present an already-consumed token and get the session killed. Every
 * caller shares one in-flight request instead.
 */
let refreshInFlight: Promise<string | null> | null = null;

function refreshSession(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      // Nothing left to refresh with. A window that still believes it is signed
      // in would keep sending tokenless requests and show "Missing bearer token"
      // under every screen, so end the session and let the login form take over.
      if (useAuthStore.getState().status !== 'idle') {
        useAuthStore.setState({ user: null, accessToken: null, status: 'idle' });
      }
      return null;
    }
    try {
      const tokens = await api.refresh(stored);
      localStorage.setItem(STORAGE_KEY, tokens.refreshToken);
      useAuthStore.setState({ accessToken: tokens.accessToken });
      connectSockets(tokens.accessToken);
      return tokens.accessToken;
    } catch (error) {
      // Only the server *rejecting* the token ends the session. A network
      // failure, a gateway 502 or a service still starting says nothing about
      // whether this session is still good - and throwing the token away there
      // signed people out permanently the first time the app opened before the
      // backend did, which on a desktop that starts with the system is most
      // times. The token is kept, the login screen says why, and the next
      // start signs back in on its own.
      const rejected = error instanceof ApiError && error.status === 401;
      if (!rejected && useAuthStore.getState().user) {
        // A session that is already running stays running. The credential was
        // never refused - the network was - so ending the session here threw
        // people back to a login form over a lift, a sleeping laptop or a
        // gateway restart, which is the sign-out nobody could explain. The
        // stored token is untouched and the next request refreshes again.
        return null;
      }
      if (rejected) localStorage.removeItem(STORAGE_KEY);
      useAuthStore.setState({
        user: null,
        accessToken: null,
        status: 'idle',
        error: rejected ? null : messageOf(error),
      });
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

// Rotating refresh: the API client asks for a fresh access token on a 401.
configureApi(() => useAuthStore.getState().accessToken, refreshSession);
