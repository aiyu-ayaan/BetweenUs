/**
 * Friends and direct message conversations - everything behind the home button
 * on the server rail.
 */
import { create } from 'zustand';
import type { BlockedUser, DirectChannel, Friend, UserSummary } from '@betweenus/shared-types';
import { api } from '../services/api';
import { chatSocket } from '../services/socket';
import { useAuthStore } from './auth';
import { useChatStore } from './chat';

interface FriendsState {
  friends: Friend[];
  directChannels: DirectChannel[];
  /** Everyone this account has blocked. Loaded with the friend list. */
  blocked: BlockedUser[];
  searchResults: UserSummary[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  add: (username: string) => Promise<void>;
  accept: (userId: string) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  /** Blocks somebody: the friendship ends and the conversation closes. */
  block: (userId: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  /** Opens (or reopens) the conversation and puts it on screen. */
  openDirect: (userId: string) => Promise<void>;
  reset: () => void;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  directChannels: [],
  blocked: [],
  searchResults: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [friends, directChannels, blocked] = await Promise.all([
        api.friends(),
        api.directChannels(),
        // A deployment that has not been migrated yet answers 404 here, and a
        // missing block list is not a reason for the friends screen to fail.
        api.blocked().catch(() => [] as BlockedUser[]),
      ]);
      set({ friends, directChannels, blocked, loading: false });
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

  block: async (userId) => {
    const entry = await api.blockUser(userId);
    // The friendship went with it on the server, and the conversation is closed
    // for both sides - so it leaves the two lists here as well rather than
    // waiting for the reload the announcement will trigger.
    set({
      blocked: [entry, ...get().blocked.filter((item) => item.user.id !== userId)],
      friends: get().friends.filter((friend) => friend.user.id !== userId),
      directChannels: get().directChannels.filter(
        (channel) => channel.participant.id !== userId,
      ),
      searchResults: get().searchResults.filter((person) => person.id !== userId),
    });
  },

  unblock: async (userId) => {
    await api.unblockUser(userId);
    set({ blocked: get().blocked.filter((item) => item.user.id !== userId) });
    // The conversation is open again and its channel was hidden while it was
    // not, so the list is re-read rather than reconstructed from memory.
    await get().load();
  },

  openDirect: async (userId) => {
    const channel = await api.openDirectChannel(userId);
    const known = get().directChannels.some((item) => item.channelId === channel.channelId);
    if (!known) set({ directChannels: [channel, ...get().directChannels] });
    await useChatStore.getState().openDirectChannel(channel);
  },

  reset: () =>
    set({ friends: [], directChannels: [], blocked: [], searchResults: [], error: null }),
}));

/**
 * A request, an acceptance, a removal or a new conversation on the other side:
 * the server says only that something changed, and both lists are re-read. They
 * are one call each and rarely change, so a payload per recipient would buy
 * nothing - see the note on `ServerChatEvent`.
 */
chatSocket.on((event) => {
  if (event.type === 'friends.changed') {
    void useFriendsStore.getState().load();
    void useChatStore.getState().loadDirects();
    return;
  }

  // A friend changed their picture or their name. Both lists name them, and
  // the conversation list is the one on screen while it happens.
  if (event.type === 'user.updated') {
    const { friends, directChannels, searchResults } = useFriendsStore.getState();
    const same = (person: UserSummary): UserSummary =>
      person.id === event.user.id ? event.user : person;
    useFriendsStore.setState({
      friends: friends.map((friend) => ({ ...friend, user: same(friend.user) })),
      directChannels: directChannels.map((direct) => ({
        ...direct,
        participant: same(direct.participant),
      })),
      searchResults: searchResults.map(same),
    });
  }
});

function upsert(friends: Friend[], incoming: Friend): Friend[] {
  const without = friends.filter((friend) => friend.user.id !== incoming.user.id);
  return [incoming, ...without];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
