import { create } from 'zustand';
import type { PublicUser } from '@nexora/shared-types';
import { ApiError, api, configureApi } from '../services/api';
import { chatSocket } from '../services/socket';

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
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;

    set({ status: 'loading' });
    try {
      const tokens = await api.refresh(stored);
      localStorage.setItem(STORAGE_KEY, tokens.refreshToken);
      set({ accessToken: tokens.accessToken });
      const user = await api.me();
      applySession(set, tokens.accessToken, tokens.refreshToken, user);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      set({ status: 'idle', accessToken: null, user: null });
    }
  },

  logout: async () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    chatSocket.disconnect();
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
  chatSocket.connect(accessToken);
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Could not reach the server. Is the backend running?';
}

// Rotating refresh: the API client asks for a fresh access token on a 401.
configureApi(
  () => useAuthStore.getState().accessToken,
  async () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    try {
      const tokens = await api.refresh(stored);
      localStorage.setItem(STORAGE_KEY, tokens.refreshToken);
      useAuthStore.setState({ accessToken: tokens.accessToken });
      chatSocket.connect(tokens.accessToken);
      return tokens.accessToken;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      useAuthStore.setState({ user: null, accessToken: null, status: 'idle' });
      return null;
    }
  },
);
