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
import { PERMISSIONS } from '@nexora/permissions';
import { api } from '../services/api';
import { chatSocket } from '../services/socket';
import {
  UNDECRYPTABLE,
  decryptForChannel,
  encryptForChannel,
  keyChannel,
  syncChannelKeys,
} from '../services/e2ee';
import { decodeBody, encodeBody } from '../services/message-body';
import { notifyMessage, publishUnreadCount, windowIsFocused } from '../services/notifications';
import { mentionsMe } from '../services/mentions';
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
   * channelId -> the read marker as this client last saw it. Kept because the
   * divider below is "everything after this", and the marker moves the moment
   * a channel is opened - so it has to be read before it is advanced.
   */
  readMarkers: Record<string, string | null>;
  /**
   * channelId -> the message the "new messages" line is drawn above, or null
   * for a channel with nothing new. It is placed when the channel is opened and
   * left alone while it stays open, the way Discord does it: a line that moved
   * every time something arrived would be no use for finding your place.
   */
  divider: Record<string, string | null>;
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
  /** What the right-hand column shows, if anything. */
  rightPanel: 'members' | 'pins' | 'search' | 'none';
  /** Pinned messages of the open channel, newest pin first. */
  pins: DecryptedMessage[];
  /**
   * A message the pinned list or the search results asked to be shown. The
   * message list watches it, scrolls there and highlights it, then clears it.
   */
  jumpTo: string | null;

  loadServers: () => Promise<void>;
  /** Read markers live on the account, so a badge survives a restart. */
  loadUnread: () => Promise<void>;
  /**
   * "I am looking at this now": clears the badge for the open channel and moves
   * its marker on the account. Called when the window regains focus and when a
   * message arrives in a channel that is already on screen - without it, a
   * message that arrived while the window was in the background stayed counted
   * even after it had been read.
   */
  markActiveRead: () => void;
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
  /** Own message always; anyone else's with DELETE_MESSAGE in that server. */
  deleteMessage: (messageId: string) => Promise<void>;
  /** Rewrites the body of your own message, re-encrypted for the channel. */
  editMessage: (messageId: string, content: string) => Promise<void>;
  /** Pins or unpins, whichever the message is not already. */
  togglePin: (messageId: string) => Promise<void>;
  /** Adds the emoji, or takes it back when it is already yours. */
  react: (messageId: string, emoji: string) => Promise<void>;
  loadPins: () => Promise<void>;
  showPanel: (panel: ChatState['rightPanel']) => void;
  /** Opens the message in the list, wherever the request came from. */
  jumpToMessage: (messageId: string) => void;
  clearJump: () => void;
  /** True when this account may delete a message it did not write. */
  canModerateMessages: () => boolean;
  /** True when this account may pin in the open channel. */
  canPin: () => boolean;
  /** Re-reads the member list of the server on screen. */
  refreshMembers: () => Promise<void>;
  /** Renames a server, sets its icon, or clears it - whatever the change holds. */
  saveServer: (change: UpdateServerRequest) => Promise<void>;
  leaveServer: () => Promise<void>;
  deleteServer: () => Promise<void>;
  /** Adds someone to the server on screen, by the username they can be told. */
  addMember: (username: string) => Promise<void>;
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
  readMarkers: {},
  divider: {},
  history: {},
  loadingMessages: false,
  error: null,
  rightPanel: 'members',
  pins: [],
  jumpTo: null,

  loadServers: async () => {
    const servers = await api.servers();
    set({ servers });
    // Watch every server, not only the open one: being added to or removed
    // from one has to reach this client wherever it happens to be looking.
    chatSocket.syncServers(servers.map((server) => server.id));
  },

  loadUnread: async () => {
    const counts = await api.unread().catch(() => []);
    const unread: Record<string, number> = {};
    const readMarkers: Record<string, string | null> = {};
    for (const entry of counts) {
      if (entry.count > 0) unread[entry.channelId] = entry.count;
      readMarkers[entry.channelId] = entry.lastReadAt;
    }
    set({ readMarkers });
    setUnread(unread);
  },

  markActiveRead: () => {
    const channelId = get().activeChannelId;
    if (!channelId) return;

    if (get().unread[channelId]) {
      const unread = { ...get().unread };
      delete unread[channelId];
      setUnread(unread);
    }

    // The line goes with the badge, a few seconds behind it. Discord keeps it
    // until the channel is opened again, which leaves it sitting there long
    // after everything below it has been read; here it marks unread messages
    // and nothing else, so it clears itself once they are read. The delay is so
    // it can still be seen on the way in - a line that vanishes the instant the
    // window is focused never did its job.
    if (get().divider[channelId]) clearDividerSoon(channelId);

    void api
      .markChannelRead(channelId)
      .then((entry) =>
        set({ readMarkers: { ...get().readMarkers, [channelId]: entry.lastReadAt } }),
      )
      .catch(() => undefined);
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
    // Read before it is advanced: the "new messages" line is drawn from where
    // the marker stood when the channel was opened, and marking it read below
    // is what moves it.
    const previousMarker = get().readMarkers[channelId] ?? null;

    // Opening a channel clears its unread mark here and on the account, so the
    // next window to sign in does not show a badge for something already read.
    if (get().unread[channelId]) {
      const unread = { ...get().unread };
      delete unread[channelId];
      setUnread(unread);
    }
    void api
      .markChannelRead(channelId)
      .then((entry) =>
        set({ readMarkers: { ...get().readMarkers, [channelId]: entry.lastReadAt } }),
      )
      .catch(() => undefined);

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
      // Pins belong to a channel, so they go with it; the panel reloads them.
      pins: [],
      jumpTo: null,
    });
    chatSocket.subscribe(channelId);
    if (get().rightPanel === 'pins') void get().loadPins();

    // Members who joined after this channel was keyed need the key wrapped for
    // them; opening the channel is the natural moment to do it.
    void syncChannelKeys(channelId).catch(() => undefined);

    try {
      const page = await api.messages(channelId);
      const items = await Promise.all(page.items.map(decrypt));

      // Where the line goes: the first message somebody else wrote after this
      // account last read the channel. A channel with no marker at all is one
      // that has never been opened, and starting somebody's first visit with a
      // "new messages" banner across the whole history helps nobody.
      const me = useAuthStore.getState().user?.id;
      const firstUnread = previousMarker
        ? items.find(
            (message) =>
              message.author.id !== me &&
              new Date(message.createdAt).getTime() > new Date(previousMarker).getTime(),
          )
        : undefined;
      set({ divider: { ...get().divider, [channelId]: firstUnread?.id ?? null } });
      // Opening the channel is reading it, so the line it was just given is
      // already on borrowed time - long enough to be seen, then gone.
      if (firstUnread) clearDividerSoon(channelId);
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
    // Mint its key now, while we know we are a member: an unkeyed channel puts
    // the cost on whoever opens it next, and that used to fail for anyone but
    // the creator. A voice channel needs one too - the media key is this key.
    void keyChannel(channel.id).catch(() => undefined);
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

  /**
   * Deleting leaves a tombstone rather than a hole, so nothing is removed from
   * the view here: the `message.updated` event carries the deleted message back
   * with `deletedAt` set, and every client - including this one - draws the
   * same "message deleted" line from it.
   */
  deleteMessage: async (messageId) => {
    await api.deleteMessage(messageId);
  },

  editMessage: async (messageId, content) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    // Re-encrypted under the same channel key: the server only ever sees the
    // replacement envelope, exactly as it saw the original.
    const existing = get().messages.find((message) => message.id === messageId);
    const envelope = await encryptForChannel(
      channelId,
      encodeBody({ text: content, attachments: existing?.attachments ?? [] }),
    );
    await api.editMessage(messageId, envelope);
  },

  togglePin: async (messageId) => {
    const message =
      get().messages.find((item) => item.id === messageId) ??
      get().pins.find((item) => item.id === messageId);
    await (message?.pinnedAt ? api.unpinMessage(messageId) : api.pinMessage(messageId));
    await get().loadPins();
  },

  react: async (messageId, emoji) => {
    await api.reactToMessage(messageId, emoji);
  },

  loadPins: async () => {
    const channelId = get().activeChannelId;
    if (!channelId) {
      set({ pins: [] });
      return;
    }
    const rows = await api.pins(channelId).catch(() => []);
    const pins = await Promise.all(rows.map((message) => decrypt(message)));
    if (get().activeChannelId === channelId) set({ pins });
  },

  showPanel: (panel) => {
    set({ rightPanel: panel });
    if (panel === 'pins') void get().loadPins();
  },

  jumpToMessage: (messageId) => set({ jumpTo: messageId }),
  clearJump: () => set({ jumpTo: null }),

  canModerateMessages: () => {
    const { servers, activeServerId } = get();
    const server = servers.find((item) => item.id === activeServerId);
    return server?.permissions.includes(PERMISSIONS.DELETE_MESSAGE) ?? false;
  },

  /** A direct message has no roles, so both participants may pin in one. */
  canPin: () => {
    const { servers, activeServerId, view } = get();
    if (view === 'home') return true;
    const server = servers.find((item) => item.id === activeServerId);
    return server?.permissions.includes(PERMISSIONS.MANAGE_MESSAGE) ?? false;
  },

  refreshMembers: async () => {
    const serverId = get().activeServerId;
    if (!serverId) return;
    const members = await api.members(serverId).catch(() => null);
    // Re-read: the user may have switched servers while this was in flight.
    if (members && get().activeServerId === serverId) set({ members });
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
    const servers = get().servers.filter((server) => server.id !== serverId);
    chatSocket.syncServers(servers.map((server) => server.id));
    set({
      servers,
      view: 'home',
      activeServerId: null,
      activeChannelId: null,
      channels: [],
      members: [],
      messages: [],
    });
    chatSocket.syncSubscriptions(subscribable([], get().directs));
  },

  addMember: async (username) => {
    const serverId = get().activeServerId;
    if (!serverId) return;
    const member = await api.addMember(serverId, username);
    // Already a member: the list is right as it stands.
    if (get().members.some((item) => item.userId === member.userId)) return;
    set({ members: [...get().members, member] });
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
      pins: [],
      jumpTo: null,
      readMarkers: {},
      divider: {},
    });
  },
}));

/**
 * Marks the open channel read, at most once a second.
 *
 * A busy channel would otherwise mean one write per message arriving, and the
 * marker only has to be roughly current - it is a "you have seen up to here",
 * not an audit trail.
 */
/** How long the unread line stays after its messages have been read. */
const DIVIDER_LINGER_MS = 5000;
const dividerTimers = new Map<string, number>();

function clearDividerSoon(channelId: string): void {
  if (dividerTimers.has(channelId)) return;
  dividerTimers.set(
    channelId,
    window.setTimeout(() => {
      dividerTimers.delete(channelId);
      const state = useChatStore.getState();
      // Something new may have arrived and re-placed it while we waited; only
      // clear it if this channel is still the one being read.
      if (state.activeChannelId !== channelId || state.unread[channelId]) return;
      useChatStore.setState({ divider: { ...state.divider, [channelId]: null } });
    }, DIVIDER_LINGER_MS),
  );
}

let readTimer: number | null = null;
function markActiveReadSoon(): void {
  if (readTimer !== null) return;
  readTimer = window.setTimeout(() => {
    readTimer = null;
    useChatStore.getState().markActiveRead();
  }, 1000);
}

/**
 * The one place unread counts are written, because two things follow every
 * change: the sidebar dots and the tray tooltip / dock badge.
 */
function setUnread(unread: Record<string, number>): void {
  useChatStore.setState({ unread });
  publishUnreadCount(Object.values(unread).reduce((total, count) => total + count, 0));
}

/**
 * Decrypts one message for display. A deleted message has no body to open -
 * the server emptied it - so it goes straight through as a tombstone.
 */
async function decrypt(message: Message): Promise<DecryptedMessage> {
  if (message.deletedAt) return { ...message, content: '', attachments: [] };
  return toDecrypted(message, await decryptForChannel(message.channelId, message.content));
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

/**
 * Replaces a message wherever this client is holding it - the open list, the
 * cached history of its channel, and the pinned panel. An edit, a deletion, a
 * pin and a reaction all arrive as the same replacement.
 */
function replaceMessage(message: DecryptedMessage): void {
  const state = useChatStore.getState();
  const swap = (items: DecryptedMessage[]): DecryptedMessage[] =>
    items.map((item) => (item.id === message.id ? message : item));

  const cached = state.history[message.channelId];
  useChatStore.setState({
    ...(cached ? { history: { ...state.history, [message.channelId]: swap(cached) } } : {}),
    messages: swap(state.messages),
    // A message that stopped being pinned - or was deleted - leaves the panel;
    // a newly pinned one is picked up by the reload below.
    pins:
      message.pinnedAt === null
        ? state.pins.filter((item) => item.id !== message.id)
        : swap(state.pins),
  });

  const newlyPinned =
    message.pinnedAt !== null && !state.pins.some((item) => item.id === message.id);
  if (newlyPinned && state.rightPanel === 'pins') void useChatStore.getState().loadPins();
}

// Realtime events land here regardless of which component is mounted, for
// every subscribed channel - not only the one on screen.
chatSocket.on((event) => {
  if (event.type === 'message.updated') {
    void decrypt(event.message).then(replaceMessage);
    return;
  }

  // Somebody joined or left a server this client is in. The member list is
  // small and the change is rare, so it is re-read rather than patched from a
  // payload - and the server list too, because this may be the client that was
  // added or removed.
  if (event.type === 'server.members.changed') {
    void (async () => {
      const store = useChatStore.getState();
      await store.loadServers().catch(() => undefined);
      const gone = !useChatStore
        .getState()
        .servers.some((server) => server.id === event.serverId);
      // Removed from the server that is on screen: leave it rather than keep
      // painting channels this account can no longer open.
      if (gone) {
        if (useChatStore.getState().activeServerId === event.serverId) {
          store.forgetServer(event.serverId);
        }
        return;
      }
      if (event.serverId === useChatStore.getState().activeServerId) {
        await store.refreshMembers();
      }
    })();
    return;
  }

  if (event.type !== 'message.created') return;
  const incoming = event.message;

  void decryptForChannel(incoming.channelId, incoming.content).then((plaintext) => {
    const message = toDecrypted(incoming, plaintext);
    // Re-read: decryption is async, so the channel may have changed meanwhile.
    const state = useChatStore.getState();
    const active = incoming.channelId === state.activeChannelId;
    const self = useAuthStore.getState().user;
    const mine = incoming.author.id === self?.id;

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
      // First one to go unread in this channel: that is where the line goes,
      // including for a channel that is open behind an unfocused window.
      if (!state.divider[incoming.channelId]) {
        useChatStore.setState({
          divider: { ...state.divider, [incoming.channelId]: incoming.id },
        });
      }
    } else {
      // Arrived in the channel on screen, in a focused window: it has been
      // read as soon as it is drawn, so move the marker on the account too.
      // Otherwise the next sign-in counts it as unread.
      markActiveReadSoon();
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
      // Decided here because this is where the plaintext exists at all: the
      // services see ciphertext, so "was I mentioned" is not a question any of
      // them could answer.
      mentioned: mentionsMe(notificationText(message), {
        username: self?.username ?? '',
        displayName: self?.displayName,
      }),
    });
  });
});
