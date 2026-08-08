import { create } from 'zustand';
import type {
  Channel,
  ChannelType,
  DirectChannel,
  Message,
  MessageAttachment,
  ServerMember,
  ServerWithRole,
  UpdateServerMemberRequest,
  UpdateServerRequest,
} from '@nexora/shared-types';
import { api } from '../services/api';
import { chatSocket } from '../services/socket';
import {
  UNDECRYPTABLE,
  decryptForChannel,
  encryptForChannel,
  syncChannelKeys,
} from '../services/e2ee';
import { decodeBody, encodeBody } from '../services/message-body';
import { notifyMessage, publishUnreadCount, windowIsFocused } from '../services/notifications';
import { useAuthStore } from './auth';

/**
 * A message as the client holds it: decrypted, and with the attachment
 * manifest lifted out of the body. The server never sees this shape - it
 * stores one ciphertext string.
 */
export interface DecryptedMessage extends Message {
  attachments: MessageAttachment[];
}

interface ChatState {
  /** Home is the direct-message side of the app; a server is everything else. */
  view: 'home' | 'server';
  servers: ServerWithRole[];
  channels: Channel[];
  /** Open conversations, kept apart from a server's channels. */
  directs: Channel[];
  members: ServerMember[];
  messages: DecryptedMessage[];
  activeServerId: string | null;
  activeChannelId: string | null;
  /** channelId -> unread message count, for the dot in the sidebar. */
  unread: Record<string, number>;
  /**
   * Decrypted history per channel, so reopening one paints immediately instead
   * of clearing the view and waiting for a fetch and fifty decryptions.
   *
   * Memory only, and deliberately: this is plaintext, and writing it to disk
   * would undo what the encryption is for. It dies with the window.
   */
  history: Record<string, DecryptedMessage[]>;
  loadingMessages: boolean;
  error: string | null;

  loadServers: () => Promise<void>;
  /** Read markers live on the account, so a badge survives a restart. */
  loadUnread: () => Promise<void>;
  /** The channel on screen, wherever it lives. */
  activeChannel: () => Channel | undefined;
  showHome: () => void;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  loadDirects: () => Promise<void>;
  openDirectChannel: (direct: DirectChannel) => Promise<void>;
  createServer: (name: string) => Promise<void>;
  joinServer: (slug: string) => Promise<void>;
  createChannel: (options: {
    name: string;
    type?: ChannelType;
    isPrivate?: boolean;
    memberIds?: string[];
  }) => Promise<void>;
  sendMessage: (content: string, attachments?: MessageAttachment[]) => Promise<void>;
  /** Renames a server, sets its icon, or clears it - whatever the change holds. */
  saveServer: (change: UpdateServerRequest) => Promise<void>;
  leaveServer: () => Promise<void>;
  deleteServer: () => Promise<void>;
  updateMember: (userId: string, change: UpdateServerMemberRequest) => Promise<void>;
  kickMember: (userId: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;
  /** Drops a server from the client after leaving or deleting it. */
  forgetServer: (serverId: string) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  view: 'home',
  servers: [],
  channels: [],
  directs: [],
  members: [],
  messages: [],
  activeServerId: null,
  activeChannelId: null,
  unread: {},
  history: {},
  loadingMessages: false,
  error: null,

  loadServers: async () => {
    const servers = await api.servers();
    set({ servers });
  },

  loadUnread: async () => {
    const counts = await api.unread().catch(() => []);
    const unread: Record<string, number> = {};
    for (const entry of counts) if (entry.count > 0) unread[entry.channelId] = entry.count;
    setUnread(unread);
  },

  activeChannel: () => {
    const { channels, directs, activeChannelId } = get();
    return [...channels, ...directs].find((channel) => channel.id === activeChannelId);
  },

  showHome: () => set({ view: 'home' }),

  /**
   * Conversations are loaded once at sign-in rather than when the home screen
   * is opened, because a direct message has to be able to arrive and be
   * notified about while the user is somewhere else entirely.
   */
  loadDirects: async () => {
    const directs = (await api.directChannels().catch(() => [])).map(toDirectChannel);
    set({ directs });
    chatSocket.syncSubscriptions(subscribable(get().channels, directs));
  },

  openDirectChannel: async (direct) => {
    const channel = toDirectChannel(direct);
    const known = get().directs.some((item) => item.id === channel.id);
    if (!known) set({ directs: [channel, ...get().directs] });
    set({ view: 'home' });
    await get().selectChannel(channel.id);
  },

  selectServer: async (serverId) => {
    set({ view: 'server', activeServerId: serverId, channels: [], members: [], messages: [] });

    const [channels, members] = await Promise.all([
      api.channels(serverId),
      // Members carry the display names presence attaches status to.
      api.members(serverId).catch(() => []),
    ]);
    set({ channels, members });

    // Subscribed to every readable channel, not only the open one: a message in
    // another channel has to arrive for it to be counted or notified about.
    chatSocket.syncSubscriptions(subscribable(channels, get().directs));

    const first = channels.find((channel) => channel.type === 'TEXT');
    if (first) await get().selectChannel(first.id);
  },

  selectChannel: async (channelId) => {
    // Opening a channel clears its unread mark here and on the account, so the
    // next window to sign in does not show a badge for something already read.
    if (get().unread[channelId]) {
      const unread = { ...get().unread };
      delete unread[channelId];
      setUnread(unread);
    }
    void api.markChannelRead(channelId).catch(() => undefined);

    // A voice channel opens its own screen; there is no history to fetch and no
    // message socket to subscribe to.
    if (get().channels.find((channel) => channel.id === channelId)?.type === 'VOICE') {
      set({ activeChannelId: channelId, messages: [], loadingMessages: false, error: null });
      return;
    }

    // Whatever was read before is still true; show it now and refresh behind
    // it, rather than blanking the view for the round trip.
    const cached = get().history[channelId];
    set({
      activeChannelId: channelId,
      messages: cached ?? [],
      loadingMessages: cached === undefined,
      error: null,
    });
    chatSocket.subscribe(channelId);

    // Members who joined after this channel was keyed need the key wrapped for
    // them; opening the channel is the natural moment to do it.
    void syncChannelKeys(channelId).catch(() => undefined);

    try {
      const page = await api.messages(channelId);
      const items = await Promise.all(
        page.items.map(async (message) => toDecrypted(message, await decryptForChannel(channelId, message.content))),
      );
      // The cache is written even when the user has already moved on - the
      // fetch was paid for, and the next visit gets it for free.
      set({ history: { ...get().history, [channelId]: items } });
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

  sendMessage: async (content, attachments = []) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    // The server stores and forwards ciphertext only - and the attachment
    // manifest is inside it, so the names and types are encrypted too.
    const envelope = await encryptForChannel(
      channelId,
      encodeBody({ text: content, attachments }),
    );
    // No optimistic insert: the message arrives over the socket, so an
    // optimistic copy would have to be de-duplicated for no real gain.
    await api.sendMessage(channelId, envelope);
  },

  saveServer: async (change) => {
    const serverId = get().activeServerId;
    if (!serverId) return;
    const updated = await api.updateServer(serverId, change);
    set({
      servers: get().servers.map((server) => (server.id === serverId ? updated : server)),
    });
  },

  /** Leaving or deleting both end with no server on screen, so both go home. */
  leaveServer: async () => {
    const serverId = get().activeServerId;
    if (!serverId) return;
    await api.leaveServer(serverId);
    get().forgetServer(serverId);
  },

  deleteServer: async () => {
    const serverId = get().activeServerId;
    if (!serverId) return;
    await api.deleteServer(serverId);
    get().forgetServer(serverId);
  },

  forgetServer: (serverId) => {
    set({
      servers: get().servers.filter((server) => server.id !== serverId),
      view: 'home',
      activeServerId: null,
      activeChannelId: null,
      channels: [],
      members: [],
      messages: [],
    });
    chatSocket.syncSubscriptions(subscribable([], get().directs));
  },

  updateMember: async (userId, change) => {
    const serverId = get().activeServerId;
    if (!serverId) return;
    const member = await api.updateMember(serverId, userId, change);
    set({
      members: get().members.map((item) => (item.userId === userId ? member : item)),
    });
  },

  kickMember: async (userId) => {
    const serverId = get().activeServerId;
    if (!serverId) return;
    await api.removeMember(serverId, userId);
    set({ members: get().members.filter((member) => member.userId !== userId) });
  },

  deleteChannel: async (channelId) => {
    await api.deleteChannel(channelId);
    const channels = get().channels.filter((channel) => channel.id !== channelId);
    set({ channels });
    chatSocket.syncSubscriptions(subscribable(channels, get().directs));
    if (get().activeChannelId === channelId) {
      const next = channels.find((channel) => channel.type === 'TEXT');
      if (next) await get().selectChannel(next.id);
      else set({ activeChannelId: null, messages: [] });
    }
  },

  reset: () => {
    setUnread({});
    set({
      view: 'home',
      servers: [],
      channels: [],
      directs: [],
      members: [],
      messages: [],
      activeServerId: null,
      activeChannelId: null,
      history: {},
      error: null,
    });
  },
}));

/**
 * The one place unread counts are written, because two things follow every
 * change: the sidebar dots and the tray tooltip / dock badge.
 */
function setUnread(unread: Record<string, number>): void {
  useChatStore.setState({ unread });
  publishUnreadCount(Object.values(unread).reduce((total, count) => total + count, 0));
}

/** Splits a decrypted body into the text and the files it carried. */
function toDecrypted(message: Message, plaintext: string): DecryptedMessage {
  // An undecryptable body is a placeholder, not a body - do not try to read
  // an attachment manifest out of it.
  if (plaintext === UNDECRYPTABLE) return { ...message, content: plaintext, attachments: [] };
  const body = decodeBody(plaintext);
  return { ...message, content: body.text, attachments: body.attachments };
}

function notificationText(message: DecryptedMessage): string | null {
  if (message.content === UNDECRYPTABLE) return null;
  if (message.content.trim()) return message.content;
  return message.attachments.length > 0 ? 'Sent an attachment' : null;
}

/**
 * A direct message is a channel; the client only has to give it the shape the
 * rest of the app already knows, named after the person on the other end.
 */
function toDirectChannel(direct: DirectChannel): Channel {
  return {
    id: direct.channelId,
    serverId: null,
    name: direct.participant.displayName || direct.participant.username,
    type: 'DM',
    topic: null,
    isPrivate: true,
    createdAt: direct.createdAt,
  };
}

/** Channels a message can arrive in - everything except voice. */
function subscribable(channels: Channel[], directs: Channel[]): string[] {
  return [...channels, ...directs]
    .filter((channel) => channel.type !== 'VOICE')
    .map((channel) => channel.id);
}

// Realtime messages land here regardless of which component is mounted, for
// every subscribed channel - not only the one on screen.
chatSocket.on((event) => {
  if (event.type !== 'message.created') return;
  const incoming = event.message;

  void decryptForChannel(incoming.channelId, incoming.content).then((plaintext) => {
    const message = toDecrypted(incoming, plaintext);
    // Re-read: decryption is async, so the channel may have changed meanwhile.
    const state = useChatStore.getState();
    const active = incoming.channelId === state.activeChannelId;
    const mine = incoming.author.id === useAuthStore.getState().user?.id;

    // Append to the cache as well as the view, so a channel read earlier in
    // the session is up to date when it is opened again.
    const cachedHistory = state.history[incoming.channelId];
    if (cachedHistory && !cachedHistory.some((existing) => existing.id === incoming.id)) {
      useChatStore.setState({
        history: { ...state.history, [incoming.channelId]: [...cachedHistory, message] },
      });
    }

    if (active && !state.messages.some((existing) => existing.id === incoming.id)) {
      useChatStore.setState({ messages: [...state.messages, message] });
    }

    if (mine) return;

    if (!active || !windowIsFocused()) {
      const count = (state.unread[incoming.channelId] ?? 0) + 1;
      setUnread({ ...state.unread, [incoming.channelId]: count });
    }

    notifyMessage({
      channelId: incoming.channelId,
      channelName:
        [...state.channels, ...state.directs].find(
          (channel) => channel.id === incoming.channelId,
        )?.name ?? 'a channel',
      author: incoming.author.displayName || incoming.author.username,
      // A message this device cannot read still deserves a notification, just
      // without quoting the placeholder into it. Nor is a file's name quoted:
      // the notification goes to the OS, which is outside the encrypted path.
      text: notificationText(message),
      active,
    });
  });
});
