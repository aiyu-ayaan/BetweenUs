/**
 * Online status, typing indicators and voice-channel membership, fed by the
 * `/ws/presence` socket.
 */
import { create } from 'zustand';
import { presenceSocket } from '../services/socket';

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
  /** channelId -> userId -> entry */
  typing: Map<string, Map<string, TypingEntry>>;
  /** channelId -> user ids currently in that voice channel */
  voice: Map<string, string[]>;

  isOnline: (userId: string) => boolean;
  typistsIn: (channelId: string) => string[];
  voiceMembers: (channelId: string) => string[];
  notifyTyping: (channelId: string) => void;
  reset: () => void;
}

let lastTypingSentAt = 0;

export const usePresenceStore = create<PresenceState>((set, get) => ({
  online: new Set(),
  typing: new Map(),
  voice: new Map(),

  isOnline: (userId) => get().online.has(userId),

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

  reset: () => set({ online: new Set(), typing: new Map(), voice: new Map() }),
}));

presenceSocket.on((event) => {
  const state = usePresenceStore.getState();

  switch (event.type) {
    case 'presence.sync': {
      usePresenceStore.setState({
        online: new Set(event.users.map((user) => user.userId)),
        voice: new Map(event.voice.map((entry) => [entry.channelId, entry.userIds])),
      });
      return;
    }

    case 'presence.changed': {
      const online = new Set(state.online);
      if (event.user.status === 'offline') online.delete(event.user.userId);
      else online.add(event.user.userId);
      usePresenceStore.setState({ online });
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
      voice.set(event.voice.channelId, event.voice.userIds);
      usePresenceStore.setState({ voice });
      return;
    }

    default:
      return;
  }
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
