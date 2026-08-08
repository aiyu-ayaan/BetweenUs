import { create } from 'zustand';
import type { PublicUser } from '@nexora/shared-types';
import { ApiError, api, configureApi } from '../services/api';
import { chatSocket, presenceSocket } from '../services/socket';
import { initIdentity, resetE2ee } from '../services/e2ee';

/** Both realtime sockets carry the same access token and reconnect together. */
function connectSockets(accessToken: string): void {
  chatSocket.connect(accessToken);
  presenceSocket.connect(accessToken);
}

const STORAGE_KEY = 'nexora.refreshToken';

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  status: 'idle' | 'loading' | 'authenticated';
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  restore: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  error: null,

  clearError: () => set({ error: null }),

  login: async (email, password) => {
    set({ status: 'loading', error: null });
    try {
      const result = await api.login(email, password);
      applySession(set, result.accessToken, result.refreshToken, result.user);
    } catch (error) {
      set({ status: 'idle', error: messageOf(error) });
    }
  },

  register: async (email, username, password) => {
    set({ status: 'loading', error: null });
    try {
      const result = await api.register(email, username, password);
      applySession(set, result.accessToken, result.refreshToken, result.user);
    } catch (error) {
      set({ status: 'idle', error: messageOf(error) });
    }
  },

  /** Silent sign-in on launch using the stored refresh token. */
  restore: async () => {
    if (!localStorage.getItem(STORAGE_KEY)) return;

    set({ status: 'loading' });
    const accessToken = await refreshSession();
    if (!accessToken) {
      set({ status: 'idle' });
      return;
    }

    try {
      const user = await api.me();
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
): void {
  localStorage.setItem(STORAGE_KEY, refreshToken);
  set({ user, accessToken, status: 'authenticated', error: null });
  connectSockets(accessToken);
  // Device key setup runs alongside the first workspace load; everything that
  // needs key material awaits the same promise, so the order does not matter.
  void initIdentity(user.id).catch(() => undefined);
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
    if (!stored) return null;
    try {
      const tokens = await api.refresh(stored);
      localStorage.setItem(STORAGE_KEY, tokens.refreshToken);
      useAuthStore.setState({ accessToken: tokens.accessToken });
      connectSockets(tokens.accessToken);
      return tokens.accessToken;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      useAuthStore.setState({ user: null, accessToken: null, status: 'idle' });
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

// Rotating refresh: the API client asks for a fresh access token on a 401.
configureApi(() => useAuthStore.getState().accessToken, refreshSession);
