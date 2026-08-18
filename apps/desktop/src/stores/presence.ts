/**
 * Online status, typing indicators and voice-channel membership, fed by the
 * `/ws/presence` socket.
 */
import { create } from 'zustand';
import type { ActiveStatus, PresenceStatus } from '@betweenus/shared-types';
import { presenceSocket } from '../services/socket';
import { notifyVoiceJoin } from '../services/notifications';
import { startIdleWatch, stopIdleWatch } from '../services/idle';
import { useAuthStore } from './auth';
import { useChatStore } from './chat';
import { useVoiceStore } from './voice';

/** How long a typing indicator stays up after the last keystroke event. */
const TYPING_TTL_MS = 5_000;
/** Do not send a typing event on every keystroke. */
const TYPING_THROTTLE_MS = 2_000;

interface TypingEntry {
  username: string;
  until: number;
}

interface PresenceState {
  online: Set<string>;
  /** userId -> what that person appears as. Nobody in here reads `invisible`. */
  statuses: Map<string, PresenceStatus>;
  /** This user's own status, which is the only place `invisible` shows up. */
  selfStatus: ActiveStatus;
  /**
   * What this user *picked*, which is not always what they appear as: the idle
   * watcher reports `idle` over a chosen `online` and puts it back afterwards.
   * Kept apart so an automatic idle cannot swallow a deliberate choice - a
   * person who set do-not-disturb and walked away comes back to do-not-disturb.
   */
  chosenStatus: ActiveStatus;
  /** channelId -> userId -> entry */
  typing: Map<string, Map<string, TypingEntry>>;
  /** channelId -> user ids currently in that voice channel */
  voice: Map<string, string[]>;

  isOnline: (userId: string) => boolean;
  statusOf: (userId: string) => PresenceStatus;
  typistsIn: (channelId: string) => string[];
  voiceMembers: (channelId: string) => string[];
  notifyTyping: (channelId: string) => void;
  setStatus: (status: ActiveStatus) => void;
  /**
   * The idle watcher's way in. Sends only when the reported status actually
   * changes, so a poll every half minute is not a message every half minute.
   */
  reportAutoStatus: (status: ActiveStatus) => void;
  reset: () => void;
}

let lastTypingSentAt = 0;

export const usePresenceStore = create<PresenceState>((set, get) => ({
  online: new Set(),
  statuses: new Map(),
  selfStatus: 'online',
  chosenStatus: 'online',
  typing: new Map(),
  voice: new Map(),

  isOnline: (userId) => get().online.has(userId),

  statusOf: (userId) => get().statuses.get(userId) ?? 'offline',

  typistsIn: (channelId) => {
    const now = Date.now();
    const entries = get().typing.get(channelId);
    if (!entries) return [];
    return [...entries.values()].filter((entry) => entry.until > now).map((e) => e.username);
  },

  voiceMembers: (channelId) => get().voice.get(channelId) ?? [],

  notifyTyping: (channelId) => {
    const now = Date.now();
    if (now - lastTypingSentAt < TYPING_THROTTLE_MS) return;
    lastTypingSentAt = now;
    presenceSocket.send({ type: 'typing.start', channelId });
  },

  /**
   * Optimistic: the picker closes on the chosen value straight away, and the
   * server's `status.self` confirms it a moment later.
   */
  setStatus: (status) => {
    set({ selfStatus: status, chosenStatus: status });
    presenceSocket.send({ type: 'status.set', status });
  },

  reportAutoStatus: (status) => {
    if (get().selfStatus === status) return;
    set({ selfStatus: status });
    presenceSocket.send({ type: 'status.set', status });
  },

  reset: () =>
    set({
      online: new Set(),
      statuses: new Map(),
      selfStatus: 'online',
      chosenStatus: 'online',
      typing: new Map(),
      voice: new Map(),
    }),
}));

/**
 * Someone joining a voice channel is this app's closest thing to a ringing
 * phone, so it is worth a notification - unless it is this user, or a channel
 * they are already sitting in, where the tile appearing says it better.
 */
function announceVoiceJoins(channelId: string, before: string[], after: string[]): void {
  const joined = after.filter((userId) => !before.includes(userId));
  if (joined.length === 0) return;

  const me = useAuthStore.getState().user?.id;
  if (useVoiceStore.getState().channelId === channelId) return;

  const { channels, members } = useChatStore.getState();
  const channel = channels.find((item) => item.id === channelId);
  if (!channel) return;

  for (const userId of joined) {
    if (userId === me) continue;
    const member = members.find((item) => item.userId === userId);
    notifyVoiceJoin(channelId, channel.name, member?.displayName ?? 'Someone');
  }
}

presenceSocket.on((event) => {
  const state = usePresenceStore.getState();

  switch (event.type) {
    case 'presence.sync': {
      usePresenceStore.setState({
        online: new Set(event.users.map((user) => user.userId)),
        statuses: new Map(event.users.map((user) => [user.userId, user.status])),
        voice: new Map(event.voice.map((entry) => [entry.channelId, entry.userIds])),
      });
      return;
    }

    case 'status.self': {
      usePresenceStore.setState({ selfStatus: event.status });
      return;
    }

    case 'presence.changed': {
      const online = new Set(state.online);
      const statuses = new Map(state.statuses);
      if (event.user.status === 'offline') {
        online.delete(event.user.userId);
        statuses.delete(event.user.userId);
      } else {
        online.add(event.user.userId);
        statuses.set(event.user.userId, event.user.status);
      }
      usePresenceStore.setState({ online, statuses });
      return;
    }

    case 'typing': {
      const typing = new Map(state.typing);
      const forChannel = new Map(typing.get(event.channelId) ?? []);
      forChannel.set(event.userId, {
        username: event.username,
        until: Date.now() + TYPING_TTL_MS,
      });
      typing.set(event.channelId, forChannel);
      usePresenceStore.setState({ typing });
      return;
    }

    case 'voice.changed': {
      const voice = new Map(state.voice);
      const before = voice.get(event.voice.channelId) ?? [];
      voice.set(event.voice.channelId, event.voice.userIds);
      usePresenceStore.setState({ voice });
      announceVoiceJoins(event.voice.channelId, before, event.voice.userIds);
      return;
    }

    default:
      return;
  }
});

/**
 * The idle watch runs for exactly as long as somebody is signed in.
 *
 * Driven from here rather than from the auth store, which would have to import
 * this one and the voice one to do it and would make a cycle out of three
 * modules that currently only point one way.
 */
useAuthStore.subscribe((state, previous) => {
  if (state.status === previous.status) return;

  if (state.status === 'authenticated') {
    startIdleWatch(
      (status) => usePresenceStore.getState().reportAutoStatus(status),
      () => usePresenceStore.getState().chosenStatus,
      // Being in a call is being present, whatever the keyboard has been doing.
      () => useVoiceStore.getState().channelId !== null,
    );
    return;
  }

  stopIdleWatch();
});

// Indicators expire on a timer, not on the next event, so a stale "typing…"
// disappears even when the typist goes quiet.
setInterval(() => {
  const { typing } = usePresenceStore.getState();
  const now = Date.now();
  let changed = false;

  const next = new Map<string, Map<string, TypingEntry>>();
  for (const [channelId, entries] of typing) {
    const live = new Map([...entries].filter(([, entry]) => entry.until > now));
    if (live.size !== entries.size) changed = true;
    if (live.size > 0) next.set(channelId, live);
  }

  if (changed) usePresenceStore.setState({ typing: next });
}, 1_000);
