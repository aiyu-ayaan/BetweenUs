import { create } from 'zustand';
import type { Channel, Message, WorkspaceWithRole } from '@nexora/shared-types';
import { api } from '../services/api';
import { chatSocket } from '../services/socket';

interface ChatState {
  workspaces: WorkspaceWithRole[];
  channels: Channel[];
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
  createChannel: (name: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  workspaces: [],
  channels: [],
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
    set({ activeWorkspaceId: workspaceId, channels: [], messages: [] });
    const channels = await api.channels(workspaceId);
    set({ channels });
    const first = channels[0];
    if (first) await get().selectChannel(first.id);
  },

  selectChannel: async (channelId) => {
    const previous = get().activeChannelId;
    if (previous && previous !== channelId) chatSocket.unsubscribe(previous);

    set({ activeChannelId: channelId, messages: [], loadingMessages: true, error: null });
    chatSocket.subscribe(channelId);

    try {
      const page = await api.messages(channelId);
      // Guard against a slow response for a channel the user already left.
      if (get().activeChannelId !== channelId) return;
      set({ messages: page.items, loadingMessages: false });
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

  createChannel: async (name) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return;
    const channel = await api.createChannel(workspaceId, name);
    set({ channels: [...get().channels, channel] });
    await get().selectChannel(channel.id);
  },

  sendMessage: async (content) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    // No optimistic insert: the message arrives over the socket, so an
    // optimistic copy would have to be de-duplicated for no real gain.
    await api.sendMessage(channelId, content);
  },

  reset: () =>
    set({
      workspaces: [],
      channels: [],
      messages: [],
      activeWorkspaceId: null,
      activeChannelId: null,
      error: null,
    }),
}));

// Realtime messages land here regardless of which component is mounted.
chatSocket.on((event) => {
  if (event.type !== 'message.created') return;
  const state = useChatStore.getState();
  if (event.message.channelId !== state.activeChannelId) return;
  if (state.messages.some((message) => message.id === event.message.id)) return;
  useChatStore.setState({ messages: [...state.messages, event.message] });
});
