import { create } from 'zustand';
import type {
  Channel,
  ChannelReadReceipt,
  ChannelType,
  DirectChannel,
  Message,
  MessageAttachment,
  MessageCustomEmoji,
  MessageForward,
  MessageReply,
  ServerMember,
  ServerWithRole,
  UserSummary,
  UpdateServerMemberRequest,
  UpdateServerRequest,
} from '@betweenus/shared-types';
import { PERMISSIONS } from '@betweenus/permissions';
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
import { cache } from '../services/cache';
import { forgetAttachments, openAttachment, uploadAttachment } from '../services/attachments';
import { emojiFor, forgetEmoji, loadEmoji, usedEmoji } from '../services/server-emoji';
import { useAuthStore } from './auth';

/**
 * A message as the client holds it: decrypted, and with the attachment
 * manifest lifted out of the body. The server never sees this shape - it
 * stores one ciphertext string.
 */
export interface DecryptedMessage extends Message {
  attachments: MessageAttachment[];
  /** What this message answers, quoted inside the envelope. */
  replyTo?: MessageReply;
  /** Pictures for the `:name:` shortcodes in `content`, carried with it. */
  emoji?: MessageCustomEmoji[];
  /** Set when these are somebody else's words, carried in from elsewhere. */
  forwardedFrom?: MessageForward;
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
  /**
   * channelId -> the id to ask for the next page before, null once the channel
   * has been read back to its first message. A channel with no entry has not
   * been opened yet.
   */
  cursors: Record<string, string | null>;
  /** True while an older page is in flight, so the scroll does not ask twice. */
  loadingOlder: boolean;
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
  /**
   * channelId -> everyone else's read marker in it. The "seen by" row under
   * your own messages is derived from these; see `features/chat/receipts.ts`.
   * Loaded when a channel is opened and kept current by `channel.read`.
   */
  receipts: Record<string, ChannelReadReceipt[]>;

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
  /** Joins with an invite code. A slug is not one. */
  joinServer: (code: string) => Promise<void>;
  createChannel: (options: {
    name: string;
    type?: ChannelType;
    isPrivate?: boolean;
    memberIds?: string[];
  }) => Promise<void>;
  /**
   * The page before the oldest message on screen. Called by the message list
   * when it is scrolled near the top; a no-op once the channel is exhausted.
   */
  loadOlder: () => Promise<void>;
  sendMessage: (
    content: string,
    attachments?: MessageAttachment[],
    replyTo?: MessageReply,
    /** One-time: its media may be opened once, and opening it destroys it. */
    viewOnce?: boolean,
  ) => Promise<void>;
  /**
   * The same message again, in another channel.
   *
   * A copy and not a pointer, because a pointer could not be read: every body
   * and every blob is sealed under the key of the channel it was sent to, and
   * the destination holds a different one. So the plaintext is re-sealed there
   * and the files are opened here and uploaded again - which is why this takes
   * as long as sending them did the first time.
   *
   * What travels is what the message said, not what happened to it since. The
   * reactions, the pins and the read receipts belong to the original and stay
   * with it; only the tag saying whose words these were comes along.
   */
  forwardMessage: (messageId: string, toChannelId: string) => Promise<void>;
  /**
   * Reports that this account has opened a one-time message, which is what
   * destroys it. Idempotent, and does nothing for the author's own message.
   */
  burnMessage: (messageId: string) => Promise<void>;
  /**
   * The message the composer is answering, per channel, so switching away and
   * back does not silently drop what was being replied to.
   */
  replyingTo: Record<string, MessageReply | null>;
  /** Starts a reply to a message in the open channel, or clears one with null. */
  setReplyTo: (reply: MessageReply | null) => void;
  /** Own message always; anyone else's with DELETE_MESSAGE in that server. */
  deleteMessage: (messageId: string) => Promise<void>;
  /** Rewrites the body of your own message, re-encrypted for the channel. */
  editMessage: (messageId: string, content: string) => Promise<void>;
  /** Pins or unpins, whichever the message is not already. */
  togglePin: (messageId: string) => Promise<void>;
  /** Adds the emoji, or takes it back when it is already yours. */
  react: (messageId: string, emoji: string) => Promise<void>;
  loadPins: () => Promise<void>;
  /** Who else has read the open channel. Cheap, and only for the open one. */
  loadReceipts: (channelId: string) => Promise<void>;
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
  cursors: {},
  loadingOlder: false,
  error: null,
  rightPanel: 'none',
  pins: [],
  jumpTo: null,
  receipts: {},

  loadServers: async () => {
    // What was on screen last time, before anything is asked of the network.
    if (get().servers.length === 0) {
      const cached = await cache.servers().catch(() => null);
      if (cached && get().servers.length === 0) set({ servers: cached });
    }

    const servers = await api.servers();
    set({ servers });
    void cache.putServers(servers).catch(() => undefined);
    // Watch every server, not only the open one: being added to or removed
    // from one has to reach this client wherever it happens to be looking.
    chatSocket.syncServers(servers.map((server) => server.id));
  },

  loadUnread: async () => {
    // Whatever this device last knew, first. The markers decide where the
    // unread line goes, and a channel opened before the network answers used to
    // get no line at all - which is the whole of "the line does not survive a
    // restart": it was a race, not a missing feature.
    const stored = await cache.readMarkers().catch(() => null);
    if (stored && Object.keys(get().readMarkers).length === 0) set({ readMarkers: stored });

    const counts = await api.unread().catch(() => []);
    const unread: Record<string, number> = {};
    const readMarkers: Record<string, string | null> = {};
    for (const entry of counts) {
      if (entry.count > 0) unread[entry.channelId] = entry.count;
      readMarkers[entry.channelId] = entry.lastReadAt;
    }
    set({ readMarkers });
    void cache.putReadMarkers(readMarkers).catch(() => undefined);
    setUnread(unread);
    markersKnown();
  },

  markActiveRead: () => {
    const channelId = get().activeChannelId;
    if (!channelId) return;

    if (get().unread[channelId]) {
      const unread = { ...get().unread };
      delete unread[channelId];
      setUnread(unread);
    }

    // The line and the banner above it go with it, now rather than in five
    // seconds. They are placed when messages arrive at a window nobody is
    // looking at, and coming back to that window is reading them - a bar that
    // says "new messages" over messages already on screen is just wrong, and
    // sitting there for five seconds is long enough to be read as stuck.
    if (get().divider[channelId]) {
      set({ divider: { ...get().divider, [channelId]: null } });
    }

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
    if (get().directs.length === 0) {
      const cached = await cache.directs().catch(() => null);
      if (cached && get().directs.length === 0) {
        set({ directs: cached.map(toDirectChannel) });
      }
    }

    const rows = await api.directChannels().catch(() => null);
    if (rows === null) return;
    void cache.putDirects(rows).catch(() => undefined);
    const directs = rows.map(toDirectChannel);
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

    // The channel list this server had last time, painted while the fresh one
    // is fetched. A sidebar that appears instantly and corrects itself beats
    // an empty column and a spinner.
    const cachedChannels = await cache.channels(serverId).catch(() => null);
    if (cachedChannels && get().activeServerId === serverId && get().channels.length === 0) {
      set({ channels: cachedChannels });
    }

    // The emoji are needed before the first message renders, and they are a
    // small public list - so they are fetched alongside the channels rather
    // than lazily when a shortcode first appears.
    void loadEmoji(serverId);

    const [channels, members] = await Promise.all([
      api.channels(serverId),
      // Members carry the display names presence attaches status to.
      api.members(serverId).catch(() => []),
    ]);
    set({ channels, members });
    void cache.putChannels(serverId, channels).catch(() => undefined);

    // Subscribed to every readable channel, not only the open one: a message in
    // another channel has to arrive for it to be counted or notified about.
    chatSocket.syncSubscriptions(subscribable(channels, get().directs));

    const first = channels.find((channel) => channel.type === 'TEXT');
    if (first) await get().selectChannel(first.id);
  },

  selectChannel: async (channelId) => {
    // The markers have to be in hand before the line can be placed at all. On a
    // cold start this is a race the channel used to win: the first channel
    // opens while `loadUnread` is still in flight, so there was no marker to
    // draw from and the line was simply absent until the next visit.
    await whenMarkersKnown();

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
    // Who has read it, for the "seen by" row. Fetched per open channel rather
    // than for every channel at sign-in: it is only ever drawn for the one on
    // screen, and it goes stale the moment somebody reads anyway.
    void get().loadReceipts(channelId);

    // Nothing in memory: what this device has on disk, decrypted here rather
    // than waiting for the round trip. It is the same fifty messages the fetch
    // below is about to return, and on a slow connection - or none at all -
    // it is the difference between a conversation and a spinner.
    if (cached === undefined) {
      const stored = await cache.messages(channelId).catch(() => []);
      if (stored.length > 0 && get().activeChannelId === channelId) {
        const items = await Promise.all(stored.map(decrypt));
        if (get().activeChannelId === channelId && get().history[channelId] === undefined) {
          set({
            messages: items,
            history: { ...get().history, [channelId]: items },
            loadingMessages: false,
          });
        }
      }
    }

    // Members who joined after this channel was keyed need the key wrapped for
    // them; opening the channel is the natural moment to do it.
    void syncChannelKeys(channelId).catch(() => undefined);

    try {
      const page = await api.messages(channelId);
      void cache.putMessages(page.items).catch(() => undefined);
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
      // It stays for as long as the channel is open. It used to be taken away
      // five seconds later, which made it a notification rather than a place -
      // and a place is what it is for: the point of the line is to still be
      // there when you have finished reading and want to know what was new.
      // Opening the channel again, with everything read, is what clears it.
      set({ divider: { ...get().divider, [channelId]: firstUnread?.id ?? null } });
      // The cache is written even when the user has already moved on - the
      // fetch was paid for, and the next visit gets it for free.
      set({
        history: { ...get().history, [channelId]: items },
        cursors: { ...get().cursors, [channelId]: page.nextCursor },
      });
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

  joinServer: async (code) => {
    const server = await api.joinServer(code);
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

  replyingTo: {},

  setReplyTo: (reply) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    set({ replyingTo: { ...get().replyingTo, [channelId]: reply } });
  },

  loadOlder: async () => {
    const channelId = get().activeChannelId;
    if (!channelId || get().loadingOlder) return;
    const cursor = get().cursors[channelId];
    // Undefined is a channel whose first page has not landed yet; null is one
    // that has been read back to its first message. Neither has a page to ask
    // for, and both would otherwise be asked for on every scroll event.
    if (!cursor) return;

    set({ loadingOlder: true });
    try {
      const page = await api.messages(channelId, cursor);
      void cache.putMessages(page.items).catch(() => undefined);
      const older = await Promise.all(page.items.map(decrypt));

      // Re-read: decryption is async and the channel may have changed. The
      // cursor is still stored either way, so the fetch is not wasted.
      const state = useChatStore.getState();
      const known = new Set((state.history[channelId] ?? []).map((message) => message.id));
      const fresh = older.filter((message) => !known.has(message.id));
      const merged = [...fresh, ...(state.history[channelId] ?? [])];

      set({
        history: { ...state.history, [channelId]: merged },
        cursors: { ...state.cursors, [channelId]: page.nextCursor },
        ...(state.activeChannelId === channelId ? { messages: merged } : {}),
      });
    } catch {
      // Nothing to say: the history on screen is still the history on screen,
      // and an error banner over a scroll gesture is worse than a short list.
    } finally {
      set({ loadingOlder: false });
    }
  },

  sendMessage: async (content, attachments = [], replyTo, viewOnce = false) => {
    const channelId = get().activeChannelId;
    if (!channelId) return;
    // The server stores and forwards ciphertext only - and the attachment
    // manifest is inside it, so the names and types are encrypted too.
    // The pictures for whatever custom emoji the text uses, taken from the
    // server this channel belongs to. They travel inside the envelope so a
    // reader who is not in that server still sees them - see `server-emoji.ts`.
    const emoji = usedEmoji(content, emojiFor(get().activeServerId));

    const envelope = await encryptForChannel(
      channelId,
      encodeBody({
        text: content,
        attachments,
        ...(replyTo ? { replyTo } : {}),
        ...(emoji.length > 0 ? { emoji } : {}),
      }),
    );
    // No optimistic insert: the message arrives over the socket, so an
    // optimistic copy would have to be de-duplicated for no real gain.
    // The keys travel outside the envelope as well as inside it: the server
    // cannot read the manifest, and without them it could never sweep the
    // blobs when this message is deleted.
    await api.sendMessage(
      channelId,
      envelope,
      attachments.map((attachment) => attachment.key),
      viewOnce,
    );
  },

  forwardMessage: async (messageId, toChannelId) => {
    const original = get().messages.find((message) => message.id === messageId);
    if (!original) return;

    const from = original.channelId;
    const carried: MessageAttachment[] = [];
    for (const attachment of original.attachments) {
      const blob = await openAttachment(from, attachment);
      // `openAttachment` may have turned a HEIC into a JPEG on the way out of
      // the cache, so the blob's own type is the truthful one.
      const file = new File([blob], attachment.name, {
        type: blob.type || attachment.contentType,
      });
      carried.push(
        await uploadAttachment(toChannelId, file, undefined, {
          ...(attachment.duration != null
            ? { voice: { duration: attachment.duration, waveform: attachment.waveform ?? [] } }
            : {}),
        }),
      );
    }

    // The pictures the original carried, not the destination's. The text was
    // written somewhere else - possibly in another server entirely - and its
    // shortcodes mean what they meant there. Working them out again from where
    // it is landing would drop exactly the ones the pictures exist to keep
    // readable.
    const emoji = original.emoji ?? [];
    const envelope = await encryptForChannel(
      toChannelId,
      encodeBody({
        text: original.content,
        attachments: carried,
        ...(emoji.length > 0 ? { emoji } : {}),
        forwardedFrom: {
          author: original.author.displayName,
          channel: originName(get(), from),
        },
      }),
    );
    await api.sendMessage(
      toChannelId,
      envelope,
      carried.map((attachment) => attachment.key),
      false,
    );
  },

  /**
   * Records this account's look at a one-time message, which is what spends
   * it. Outside the encrypted envelope, because the server is the one that has
   * to act on it and it cannot read the envelope.
   *
   * Throws on failure, and the viewer waits on it: nothing is drawn until the
   * look is written down. The alternative - draw first, record after - is a
   * message that is one-time only when the request happened to succeed.
   */
  burnMessage: async (messageId) => {
    // Deliberately not swallowed. The viewer waits on this before it draws
    // anything, so a failure has to reach it: a picture shown when the look
    // was never written down is a look spent only when the network happened
    // to be working, which is not one look.
    await api.burnMessage(messageId);
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
      encodeBody({
        text: content,
        attachments: existing?.attachments ?? [],
        // An edit may introduce a shortcode that was not there before, so the
        // manifest is recomputed rather than carried over.
        ...(() => {
          const emoji = usedEmoji(content, emojiFor(get().activeServerId));
          return emoji.length > 0 ? { emoji } : {};
        })(),
        // An edit changes the words. What the message was answering is not one
        // of them, so the quote rides along untouched.
        ...(existing?.replyTo ? { replyTo: existing.replyTo } : {}),
      }),
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

  loadReceipts: async (channelId) => {
    const receipts = await api.channelReads(channelId).catch(() => null);
    if (receipts === null) return;
    set({ receipts: { ...get().receipts, [channelId]: receipts } });
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
    forgetMarkers();
    forgetEmoji();
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
      cursors: {},
      loadingOlder: false,
      error: null,
      pins: [],
      jumpTo: null,
      readMarkers: {},
      divider: {},
      replyingTo: {},
      receipts: {},
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
/**
 * Resolves once the read markers are in hand.
 *
 * They arrive from `notification-service` a moment after sign-in, and the first
 * channel opens before that - so the unread line was being placed against an
 * empty marker table and came out as "nothing is new". That is not a line that
 * fails to survive a restart; it is a line that loses a race on every cold
 * start. The channel waits for the answer instead, and the cached markers make
 * that wait a disk read rather than a round trip.
 */
let markersKnown: () => void = () => undefined;
let markersReady: Promise<void> = new Promise<void>((resolve) => {
  markersKnown = resolve;
});

function whenMarkersKnown(): Promise<void> {
  return markersReady;
}

/** A new session asks again: the markers belong to whoever just signed in. */
function forgetMarkers(): void {
  markersReady = new Promise<void>((resolve) => {
    markersKnown = resolve;
  });
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
  return {
    ...message,
    content: body.text,
    attachments: body.attachments,
    ...(body.replyTo ? { replyTo: body.replyTo } : {}),
    ...(body.emoji ? { emoji: body.emoji } : {}),
    ...(body.forwardedFrom ? { forwardedFrom: body.forwardedFrom } : {}),
  };
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
/**
 * Drops the decrypted bytes of these messages' files.
 *
 * The keys come from the copies this store is holding, which is the only place
 * left that knows them: the manifest lives inside the encrypted body, and a
 * message that has been tombstoned or destroyed no longer has one. So this has
 * to run before the store's copy is replaced or removed.
 */
/**
 * What to call the place a forward came from.
 *
 * A channel has a name; a direct message is named after the person on the
 * other end, and naming them is the honest answer to "where did this come
 * from" - the alternative was a blank, which reads as a forward from nowhere.
 */
function originName(state: ChatState, channelId: string): string {
  return (
    [...state.channels, ...state.directs].find((channel) => channel.id === channelId)?.name ?? ''
  );
}

function forgetMessageAttachments(messageIds: string[]): void {
  const state = useChatStore.getState();
  const wanted = new Set(messageIds);
  const keys: string[] = [];
  for (const list of [state.messages, ...Object.values(state.history), state.pins]) {
    for (const message of list) {
      if (wanted.has(message.id)) keys.push(...message.attachments.map((file) => file.key));
    }
  }
  forgetAttachments(keys);
}

/**
 * Messages a viewer is currently open over, and the ones the server destroyed
 * while that was true.
 *
 * Ephemeral screen state rather than store state: nothing renders from it, it
 * does not survive a reload, and putting it in the store would re-render every
 * message list whenever a picture was opened.
 *
 * The problem it solves is a lifecycle one. A one-time message is burned as
 * its viewer opens - deliberately, because closing the viewer is not a promise
 * anybody can keep - and the server answers by destroying the row and saying
 * so. The viewer is drawn inside the message row, so acting on that
 * immediately unmounted the thing the person had just opened. They never saw
 * the picture they had spent their one look on.
 */
const heldOpen = new Set<string>();
const goneWhileOpen = new Set<string>();

/** Keeps a message on screen while its viewer is open, whatever the server says. */
export function holdMessage(messageId: string): void {
  heldOpen.add(messageId);
}

/** Lets it go again, and applies the removal if one arrived in the meantime. */
export function releaseMessage(messageId: string): void {
  heldOpen.delete(messageId);
  if (!goneWhileOpen.delete(messageId)) return;

  forgetMessageAttachments([messageId]);
  void cache.forgetMessages([messageId]).catch(() => undefined);
  forgetMessages(new Set([messageId]));
}

/** Takes messages out of every list this store keeps one in. */
function forgetMessages(messageIds: Set<string>): void {
  if (messageIds.size === 0) return;
  const state = useChatStore.getState();
  const keep = (items: DecryptedMessage[]): DecryptedMessage[] =>
    items.filter((item) => !messageIds.has(item.id));

  useChatStore.setState({
    messages: keep(state.messages),
    pins: keep(state.pins),
    history: Object.fromEntries(
      Object.entries(state.history).map(([channelId, items]) => [channelId, keep(items)]),
    ),
  });
}

/**
 * Drops whatever has outlived a disappearing window - either of them.
 *
 * Two windows, and the client has to enforce both for the same reason: it is
 * holding decrypted copies that no server can reach.
 *
 * The server's window is stamped on each message, and the server destroys
 * those itself and says so - so on a client that has been connected the whole
 * time this half finds nothing. It is for the one that has not: a laptop
 * asleep since yesterday wakes holding messages the server destroyed hours
 * ago, and would keep drawing them until something refetched the channel.
 *
 * This account's own window is never enforced by deletion anywhere, because it
 * is one-sided - the rows are somebody else's history too. The server leaves
 * them out of a history page, and this leaves them out of what is already on
 * screen and on disk. Without this half, switching the setting on hid nothing
 * that had already been fetched.
 */
export function pruneExpired(now = Date.now()): void {
  const state = useChatStore.getState();
  const personal = useAuthStore.getState().user?.messageTtlSeconds ?? null;
  const floor = personal ? now - personal * 1000 : null;

  const expired = new Set<string>();
  for (const list of [state.messages, ...Object.values(state.history), state.pins]) {
    for (const message of list) {
      const gone =
        (message.expiresAt && Date.parse(message.expiresAt) <= now) ||
        (floor !== null && Date.parse(message.createdAt) <= floor);
      if (gone) expired.add(message.id);
    }
  }
  if (expired.size === 0) return;

  forgetMessageAttachments([...expired]);
  void cache.forgetMessages([...expired]).catch(() => undefined);
  forgetMessages(expired);
}

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

/**
 * Repaint one account's face wherever this store is holding a copy of it.
 *
 * Patched rather than refetched because the copies are everywhere: every
 * message that account ever sent in an open channel, every page of history
 * cached behind it, the pins, the read receipts and the member list. Refetching
 * would be five calls to change three fields that arrived in the event.
 *
 * `replyTo.author` is deliberately left alone - it is a snapshot of how the
 * quoted message was signed when the reply was written, not a live reference.
 */
function patchProfile(user: UserSummary): void {
  const state = useChatStore.getState();
  const face = {
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };
  const inMessage = (message: DecryptedMessage): DecryptedMessage =>
    message.author.id === user.id ? { ...message, author: { ...message.author, ...face } } : message;
  const mapValues = <T>(record: Record<string, T[]>, map: (item: T) => T): Record<string, T[]> =>
    Object.fromEntries(Object.entries(record).map(([key, list]) => [key, list.map(map)]));

  useChatStore.setState({
    // A member row is the one place the about line is held, so it is patched
    // here and nowhere else - a message author carries a name and a picture
    // and has never carried a sentence about the person.
    members: state.members.map((member) =>
      member.userId === user.id ? { ...member, ...face, about: user.about } : member,
    ),
    messages: state.messages.map(inMessage),
    pins: state.pins.map(inMessage),
    history: mapValues(state.history, inMessage),
    receipts: mapValues(state.receipts, (receipt) =>
      receipt.user.id === user.id ? { ...receipt, user: { ...receipt.user, ...face } } : receipt,
    ),
  });
}

// Realtime events land here regardless of which component is mounted, for
// every subscribed channel - not only the one on screen.
chatSocket.on((event) => {
  if (event.type === 'user.updated') {
    patchProfile(event.user);
    return;
  }

  // A server was renamed or given a new picture. Only the sidebar entry holds
  // either, so this is a patch of one row rather than a reload of the list.
  if (event.type === 'server.updated') {
    const { servers } = useChatStore.getState();
    if (!servers.some((server) => server.id === event.serverId)) return;
    useChatStore.setState({
      servers: servers.map((server) =>
        server.id === event.serverId
          ? { ...server, name: event.name, iconUrl: event.iconUrl }
          : server,
      ),
    });
    return;
  }

  /**
   * This account cleared its own history, here or on another of its devices.
   *
   * Everything on screen and everything on disk goes: the cache holds sealed
   * envelopes the server will no longer hand back, and the open channel holds
   * the decrypted ones. Refetching is what fills both again, and what comes
   * back is whatever arrived after the cut.
   */
  if (event.type === 'chats.cleared') {
    const { activeChannelId } = useChatStore.getState();
    // One conversation leaves the rest of the cache alone: throwing away every
    // other channel's messages would turn "clear this chat" into a spinner on
    // the next four things the person opens.
    void (event.channelId
      ? cache.forgetChannel(event.channelId)
      : cache.clear()
    ).catch(() => undefined);

    const clearedHere = !event.channelId || event.channelId === activeChannelId;
    if (clearedHere) {
      useChatStore.setState({ messages: [], pins: [], divider: {}, receipts: {} });
      if (activeChannelId) void useChatStore.getState().selectChannel(activeChannelId);
    }
    // Whichever it was, the unread counts moved with it: a badge promising
    // messages that can no longer be opened is worse than no badge.
    void useChatStore.getState().loadUnread();
    return;
  }

  if (event.type === 'message.updated') {
    // A deletion arrives here as a tombstone, and a tombstone carries no
    // manifest - the body is empty. So the keys are read off the copy this
    // client is still holding, *before* it is replaced, or the decrypted
    // pictures stay in the attachment cache for the rest of the session with
    // nothing left that names them.
    if (event.message.deletedAt) forgetMessageAttachments([event.message.id]);
    // An edit, a deletion, a pin and a reaction all replace the stored row, so
    // the cache does not hand back a message that was taken down an hour ago.
    void cache.putMessages([event.message]).catch(() => undefined);
    void decrypt(event.message).then(replaceMessage);
    return;
  }

  /**
   * A message that left no tombstone: a one-time message somebody opened, or
   * one whose disappearing window closed.
   *
   * Nothing is drawn in its place, so it is removed rather than replaced -
   * from the view, from the pinned panel, from the on-disk cache, and from the
   * attachment cache holding its decrypted pictures.
   */
  if (event.type === 'message.gone') {
    // Not while somebody is looking at it. Burning happens as the viewer
    // opens, and the viewer is drawn inside the message row - so removing the
    // message here unmounted the row, which unmounted the viewer, which is why
    // a one-time picture vanished the instant it was opened. The removal is
    // held until the viewer closes; see `holdMessage`.
    if (heldOpen.has(event.messageId)) {
      goneWhileOpen.add(event.messageId);
      return;
    }
    forgetMessageAttachments([event.messageId]);
    void cache.forgetMessages([event.messageId]).catch(() => undefined);
    forgetMessages(new Set([event.messageId]));
    return;
  }

  // Somebody read a channel this client is subscribed to. One marker per
  // person, replaced rather than appended: it only ever moves forwards, and
  // keeping the old one would draw a face against a message they have since
  // read past.
  if (event.type === 'channel.read') {
    const self = useAuthStore.getState().user;
    // Your own marker, from another of your devices. It is not a receipt: the
    // row is about who else has seen your message.
    if (event.userId === self?.id) return;
    const state = useChatStore.getState();
    const known = state.receipts[event.channelId];
    // A channel this client has never opened has no list to patch, and one
    // will be fetched whole when it is opened.
    if (!known) return;
    const existing = known.find((receipt) => receipt.user.id === event.userId);
    if (!existing) {
      // Somebody who had never read this channel before: their name is not on
      // any list here, so the whole thing is re-read rather than invented.
      void useChatStore.getState().loadReceipts(event.channelId);
      return;
    }
    useChatStore.setState({
      receipts: {
        ...state.receipts,
        [event.channelId]: known.map((receipt) =>
          receipt.user.id === event.userId ? { ...receipt, readAt: event.at } : receipt,
        ),
      },
    });
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
  // Cached whether or not the channel is open: a conversation nobody has looked
  // at this session is exactly the one that should not be a spinner when the
  // badge is finally clicked.
  void cache.putMessages([incoming]).catch(() => undefined);

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
      authorId: incoming.author.id,
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
