/**
 * Friends and direct message conversations - everything behind the home button
 * on the server rail.
 */
import { create } from 'zustand';
import type { DirectChannel, Friend, UserSummary } from '@nexora/shared-types';
import { api } from '../services/api';
import { chatSocket } from '../services/socket';
import { useAuthStore } from './auth';
import { useChatStore } from './chat';

interface FriendsState {
  friends: Friend[];
  directChannels: DirectChannel[];
  searchResults: UserSummary[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  add: (username: string) => Promise<void>;
  accept: (userId: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  /** Opens (or reopens) the conversation and puts it on screen. */
  openDirect: (userId: string) => Promise<void>;
  reset: () => void;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  directChannels: [],
  searchResults: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [friends, directChannels] = await Promise.all([api.friends(), api.directChannels()]);
      set({ friends, directChannels, loading: false });
    } catch (error) {
      set({ loading: false, error: message(error) });
    }
  },

  search: async (query) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      set({ searchResults: [] });
      return;
    }
    try {
      set({ searchResults: await api.searchUsers(trimmed) });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  clearSearch: () => set({ searchResults: [] }),

  add: async (username) => {
    set({ error: null });
    try {
      const friend = await api.addFriend(username);
      set({ friends: upsert(get().friends, friend) });
    } catch (error) {
      if (useAuthStore.getState().status === 'authenticated') {
        set({ error: message(error) });
      }
      throw error;
    }
  },

  accept: async (userId) => {
    const friend = await api.acceptFriend(userId);
    set({ friends: upsert(get().friends, friend) });
  },

  remove: async (userId) => {
    await api.removeFriend(userId);
    set({ friends: get().friends.filter((friend) => friend.user.id !== userId) });
  },

  openDirect: async (userId) => {
    const channel = await api.openDirectChannel(userId);
    const known = get().directChannels.some((item) => item.channelId === channel.channelId);
    if (!known) set({ directChannels: [channel, ...get().directChannels] });
    await useChatStore.getState().openDirectChannel(channel);
  },

  reset: () => set({ friends: [], directChannels: [], searchResults: [], error: null }),
}));

/**
 * A request, an acceptance, a removal or a new conversation on the other side:
 * the server says only that something changed, and both lists are re-read. They
 * are one call each and rarely change, so a payload per recipient would buy
 * nothing - see the note on `ServerChatEvent`.
 */
chatSocket.on((event) => {
  if (event.type !== 'friends.changed') return;
  void useFriendsStore.getState().load();
  void useChatStore.getState().loadDirects();
});

function upsert(friends: Friend[], incoming: Friend): Friend[] {
  const without = friends.filter((friend) => friend.user.id !== incoming.user.id);
  return [incoming, ...without];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
