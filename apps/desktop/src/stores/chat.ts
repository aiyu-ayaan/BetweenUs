import { create } from 'zustand';
import type {
  Channel,
  ChannelType,
  Message,
  WorkspaceMember,
  WorkspaceWithRole,
} from '@nexora/shared-types';
import { api } from '../services/api';
import { chatSocket } from '../services/socket';
import { decryptForChannel, encryptForChannel, syncChannelKeys } from '../services/e2ee';

interface ChatState {
  workspaces: WorkspaceWithRole[];
  channels: Channel[];
  members: WorkspaceMember[];
  messages: Message[];
  activeWorkspaceId: string | null;
  activeChannelId: string | null;
  loadingMessages: boolean;
  error: string | null;

  loadWorkspaces: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  joinWorkspace: (slug: string) => Promise<void>;
  createChannel: (name: string, type?: ChannelType) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  workspaces: [],
  channels: [],
  members: [],
  messages: [],
  activeWorkspaceId: null,
  activeChannelId: null,
  loadingMessages: false,
  error: null,

  loadWorkspaces: async () => {
    const workspaces = await api.workspaces();
    set({ workspaces });
    const first = workspaces[0];
    if (first && !get().activeWorkspaceId) await get().selectWorkspace(first.id);
  },

  selectWorkspace: async (workspaceId) => {
    set({ activeWorkspaceId: workspaceId, channels: [], members: [], messages: [] });

    const [channels, members] = await Promise.all([
      api.channels(workspaceId),
      // Members carry the display names presence attaches status to.
      api.members(workspaceId).catch(() => []),
    ]);
    set({ channels, members });

    const first = channels.find((channel) => channel.type === 'TEXT');
    if (first) await get().selectChannel(first.id);
  },

  selectChannel: async (channelId) => {
    const previous = get().activeChannelId;
    if (previous && previous !== channelId) chatSocket.unsubscribe(previous);

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

  createWorkspace: async (name) => {
    const workspace = await api.createWorkspace(name);
    set({ workspaces: [...get().workspaces, workspace] });
    await get().selectWorkspace(workspace.id);
  },

  joinWorkspace: async (slug) => {
    const workspace = await api.joinWorkspace(slug);
    const known = get().workspaces.some((item) => item.id === workspace.id);
    if (!known) set({ workspaces: [...get().workspaces, workspace] });
    await get().selectWorkspace(workspace.id);
  },

  createChannel: async (name, type = 'TEXT') => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const channel = await api.createChannel(workspaceId, name, type);
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
      workspaces: [],
      channels: [],
      members: [],
      messages: [],
      activeWorkspaceId: null,
      activeChannelId: null,
      error: null,
    }),
}));

// Realtime messages land here regardless of which component is mounted.
chatSocket.on((event) => {
  if (event.type !== 'message.created') return;
  const incoming = event.message;
  if (incoming.channelId !== useChatStore.getState().activeChannelId) return;

  void decryptForChannel(incoming.channelId, incoming.content).then((content) => {
    // Re-read: decryption is async, so the channel may have changed meanwhile.
    const state = useChatStore.getState();
    if (incoming.channelId !== state.activeChannelId) return;
    if (state.messages.some((message) => message.id === incoming.id)) return;
    useChatStore.setState({ messages: [...state.messages, { ...incoming, content }] });
  });
});
