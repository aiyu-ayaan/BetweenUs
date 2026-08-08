import { create } from 'zustand';
import type {
  Channel,
  ChannelType,
  Message,
  ServerMember,
  ServerWithRole,
} from '@nexora/shared-types';
import { api } from '../services/api';
import { chatSocket } from '../services/socket';
import {
  UNDECRYPTABLE,
  decryptForChannel,
  encryptForChannel,
  syncChannelKeys,
} from '../services/e2ee';
import { notifyMessage, windowIsFocused } from '../services/notifications';
import { useAuthStore } from './auth';

interface ChatState {
  servers: ServerWithRole[];
  channels: Channel[];
  members: ServerMember[];
  messages: Message[];
  activeServerId: string | null;
  activeChannelId: string | null;
  /** channelId -> unread message count, for the dot in the sidebar. */
  unread: Record<string, number>;
  loadingMessages: boolean;
  error: string | null;

  loadServers: () => Promise<void>;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  createServer: (name: string) => Promise<void>;
  joinServer: (slug: string) => Promise<void>;
  createChannel: (options: {
    name: string;
    type?: ChannelType;
    isPrivate?: boolean;
    memberIds?: string[];
  }) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  servers: [],
  channels: [],
  members: [],
  messages: [],
  activeServerId: null,
  activeChannelId: null,
  unread: {},
  loadingMessages: false,
  error: null,

  loadServers: async () => {
    const servers = await api.servers();
    set({ servers });
    const first = servers[0];
    if (first && !get().activeServerId) await get().selectServer(first.id);
  },

  selectServer: async (serverId) => {
    set({ activeServerId: serverId, channels: [], members: [], messages: [] });

    const [channels, members] = await Promise.all([
      api.channels(serverId),
      // Members carry the display names presence attaches status to.
      api.members(serverId).catch(() => []),
    ]);
    set({ channels, members });

    // Subscribed to every text channel, not only the open one: a message in
    // another channel has to arrive for it to be counted or notified about.
    chatSocket.syncSubscriptions(
      channels.filter((channel) => channel.type === 'TEXT').map((channel) => channel.id),
    );

    const first = channels.find((channel) => channel.type === 'TEXT');
    if (first) await get().selectChannel(first.id);
  },

  selectChannel: async (channelId) => {
    // Opening a channel clears its unread mark.
    if (get().unread[channelId]) {
      const unread = { ...get().unread };
      delete unread[channelId];
      set({ unread });
    }

    // A voice channel opens its own screen; there is no history to fetch and no
    // message socket to subscribe to.
    if (get().channels.find((channel) => channel.id === channelId)?.type === 'VOICE') {
      set({ activeChannelId: channelId, messages: [], loadingMessages: false, error: null });
      return;
    }

    set({ activeChannelId: channelId, messages: [], loadingMessages: true, error: null });
    chatSocket.subscribe(channelId);

    // Members who joined after this channel was keyed need the key wrapped for
    // them; opening the channel is the natural moment to do it.
    void syncChannelKeys(channelId).catch(() => undefined);

    try {
      const page = await api.messages(channelId);
      const items = await Promise.all(
        page.items.map(async (message) => ({
          ...message,
          content: await decryptForChannel(channelId, message.content),
        })),
      );
      // Guard against a slow response for a channel the user already left.
      if (get().activeChannelId !== channelId) return;
      set({ messages: items, loadingMessages: false });
    } catch (error) {
      set({ loadingMessages: false, error: (error as Error).message });
    }
  },

  createServer: async (name) => {
    const server = await api.createServer(name);
    set({ servers: [...get().servers, server] });
    await get().selectServer(server.id);
  },

  joinServer: async (slug) => {
    const server = await api.joinServer(slug);
    const known = get().servers.some((item) => item.id === server.id);
    if (!known) set({ servers: [...get().servers, server] });
    await get().selectServer(server.id);
  },

  createChannel: async ({ name, type = 'TEXT', isPrivate, memberIds }) => {
    const serverId = get().activeServerId;
    if (!serverId) return;
    const channel = await api.createChannel({ serverId, name, type, isPrivate, memberIds });
    set({ channels: [...get().channels, channel] });
    // A voice channel is joined, not read, so selection stays where it was.
    if (channel.type === 'TEXT') await get().selectChannel(channel.id);
  },

  sendMessage: async (content) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    // The server stores and forwards ciphertext only.
    const envelope = await encryptForChannel(channelId, content);
    // No optimistic insert: the message arrives over the socket, so an
    // optimistic copy would have to be de-duplicated for no real gain.
    await api.sendMessage(channelId, envelope);
  },

  reset: () =>
    set({
      servers: [],
      channels: [],
      members: [],
      messages: [],
      activeServerId: null,
      activeChannelId: null,
      unread: {},
      error: null,
    }),
}));

// Realtime messages land here regardless of which component is mounted, for
// every subscribed channel - not only the one on screen.
chatSocket.on((event) => {
  if (event.type !== 'message.created') return;
  const incoming = event.message;

  void decryptForChannel(incoming.channelId, incoming.content).then((content) => {
    // Re-read: decryption is async, so the channel may have changed meanwhile.
    const state = useChatStore.getState();
    const active = incoming.channelId === state.activeChannelId;
    const mine = incoming.author.id === useAuthStore.getState().user?.id;

    if (active && !state.messages.some((message) => message.id === incoming.id)) {
      useChatStore.setState({ messages: [...state.messages, { ...incoming, content }] });
    }

    if (mine) return;

    if (!active || !windowIsFocused()) {
      const count = (state.unread[incoming.channelId] ?? 0) + 1;
      useChatStore.setState({ unread: { ...state.unread, [incoming.channelId]: count } });
    }

    notifyMessage({
      channelId: incoming.channelId,
      channelName:
        state.channels.find((channel) => channel.id === incoming.channelId)?.name ?? 'a channel',
      author: incoming.author.displayName || incoming.author.username,
      // A message this device cannot read still deserves a notification, just
      // without quoting the placeholder into it.
      text: content === UNDECRYPTABLE ? null : content,
      active,
    });
  });
});
