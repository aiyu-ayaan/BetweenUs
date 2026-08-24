import type {
  ClientChatEvent,
  ClientPresenceEvent,
  ServerChatEvent,
  ServerPresenceEvent,
} from '@betweenus/shared-types';

import { wsUrl } from './endpoint';

/**
 * Mints a fresh access token, set by the auth store on startup.
 *
 * A socket carries the access token in its URL, so the token it opened with
 * expires while it is open - fifteen minutes in, or over any sleep longer than
 * that. The next reconnect is then refused with 4401, and a socket that gave up
 * there stayed down until the app was restarted: no messages, no presence, an
 * app that looks signed out while the session behind it is fine. Refreshing is
 * what fixes it, and nothing else was going to ask.
 */
let renewToken: (() => Promise<unknown>) | null = null;

export function onSocketTokenRejected(renew: () => Promise<unknown>): void {
  renewToken = renew;
}

// Same host as the REST base, ws scheme: both sockets are behind the gateway
// this window is pointed at, so there is no second address to configure.


/**
 * Whether this window can reach the backend, for the reconnecting banner.
 *
 * Both sockets report into it and the worst answer wins: presence being down
 * with chat up is still a window that is missing events, and saying so is the
 * whole point. `offline` is a deliberate stop rather than a slower retry - see
 * `RECONNECT_DEADLINE_MS`.
 */
export type ConnectionState = 'online' | 'reconnecting' | 'offline';

/**
 * How long a socket is allowed to keep retrying before it is given up on.
 *
 * A backoff that never stops is a spinner that never stops, and thirty seconds
 * of "Reconnecting…" is already longer than anybody waits before deciding the
 * app is broken. Past it the window says so and offers the retry as a button:
 * a person who has just walked back into wifi presses it and is back in a
 * second, which an exponential backoff sitting on its thirty-second step is
 * not.
 */
export const RECONNECT_DEADLINE_MS = 30_000;

const socketStates = new Map<string, ConnectionState>();
const connectionListeners = new Set<(state: ConnectionState) => void>();
let lastPublished: ConnectionState = 'online';

function reportSocket(name: string, state: ConnectionState): void {
  socketStates.set(name, state);
  const states = [...socketStates.values()];
  const next: ConnectionState = states.includes('offline')
    ? 'offline'
    : states.includes('reconnecting')
      ? 'reconnecting'
      : 'online';
  if (next === lastPublished) return;
  lastPublished = next;
  for (const listener of connectionListeners) listener(next);
}

export function connectionState(): ConnectionState {
  return lastPublished;
}

export function onConnectionChange(listener: (state: ConnectionState) => void): () => void {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

/** The button on the banner: start the ladder again, from the bottom. */
export function retryConnection(): void {
  chatSocket.retry();
  presenceSocket.retry();
}

type Listener = (event: ServerChatEvent) => void;

/**
 * Chat socket with reconnect and channel re-subscription.
 *
 * The token rides in the query string because a browser WebSocket cannot set
 * an Authorization header; the gateway treats it as a bearer token.
 */
export class ChatSocket {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly channels = new Set<string>();
  /** Servers this client watches for membership changes. */
  private readonly servers = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private closedByUs = false;
  /** When this socket was last up, which is what the deadline measures from. */
  private downSince: number | null = null;

  connect(token: string): void {
    this.token = token;
    this.closedByUs = false;
    this.downSince ??= Date.now();
    this.open();
  }

  /** Asked for by the banner. A retry starts the backoff ladder again. */
  retry(): void {
    if (!this.token || this.closedByUs) return;
    this.reconnectAttempt = 0;
    this.downSince = Date.now();
    reportSocket('chat', 'reconnecting');
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.open();
  }

  private open(): void {
    if (!this.token) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const socket = new WebSocket(`${wsUrl()}/ws/chat?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.downSince = null;
      reportSocket('chat', 'online');
      // Re-subscribe: the server keeps no membership across connections.
      for (const channelId of this.channels) {
        this.send({ type: 'channel.subscribe', channelId });
      }
      for (const serverId of this.servers) {
        this.send({ type: 'server.subscribe', serverId });
      }
    };

    socket.onmessage = (raw) => {
      let event: ServerChatEvent;
      try {
        event = JSON.parse(String(raw.data)) as ServerChatEvent;
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(event);
    };

    socket.onclose = (event) => {
      this.socket = null;
      if (this.closedByUs) return;
      // 4401 is the token being rejected, not the connection failing. Ask for a
      // fresh one - a successful refresh reconnects both sockets itself - and
      // fall through to the backoff so a refresh that cannot happen right now
      // is retried rather than being the end of it.
      if (event.code === 4401) void renewToken?.();
      this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.downSince ??= Date.now();

    // Given up on rather than retried more slowly: past the deadline the window
    // says it is disconnected and waits to be told to try again.
    if (Date.now() - this.downSince >= RECONNECT_DEADLINE_MS) {
      reportSocket('chat', 'offline');
      return;
    }
    reportSocket('chat', 'reconnecting');

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  subscribe(channelId: string): void {
    this.channels.add(channelId);
    this.send({ type: 'channel.subscribe', channelId });
  }

  /**
   * Subscribes to exactly `channelIds`, dropping anything else.
   *
   * The client stays subscribed to every text channel it can read, not only the
   * one on screen - otherwise a message in another channel never arrives and
   * there is nothing to notify about.
   */
  syncSubscriptions(channelIds: string[]): void {
    const wanted = new Set(channelIds);
    for (const channelId of this.channels) {
      if (!wanted.has(channelId)) this.unsubscribe(channelId);
    }
    for (const channelId of wanted) {
      if (!this.channels.has(channelId)) this.subscribe(channelId);
    }
  }

  unsubscribe(channelId: string): void {
    this.channels.delete(channelId);
    this.send({ type: 'channel.unsubscribe', channelId });
  }

  /**
   * Watches exactly these servers. Separate from channel subscriptions because
   * a member joining or leaving is not news about any one channel, and a client
   * has to hear it for every server it is in, not only the one on screen.
   */
  syncServers(serverIds: string[]): void {
    const wanted = new Set(serverIds);
    for (const serverId of this.servers) {
      if (!wanted.has(serverId)) {
        this.servers.delete(serverId);
        this.send({ type: 'server.unsubscribe', serverId });
      }
    }
    for (const serverId of wanted) {
      if (this.servers.has(serverId)) continue;
      this.servers.add(serverId);
      this.send({ type: 'server.subscribe', serverId });
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private send(event: ClientChatEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  disconnect(): void {
    this.closedByUs = true;
    this.downSince = null;
    reportSocket('chat', 'online');
    this.channels.clear();
    this.servers.clear();
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}

export const chatSocket = new ChatSocket();

type PresenceListener = (event: ServerPresenceEvent) => void;

/**
 * `/ws/presence` socket: online status, typing indicators, voice membership.
 *
 * Separate from the chat socket because presence is a separate service - the
 * client should not care that both happen to reach the same gateway host.
 */
export class PresenceSocket {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private readonly listeners = new Set<PresenceListener>();
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private closedByUs = false;
  /** When this socket was last up, which is what the deadline measures from. */
  private downSince: number | null = null;

  connect(token: string): void {
    this.token = token;
    this.closedByUs = false;
    this.downSince ??= Date.now();
    this.open();
  }

  /** Asked for by the banner. A retry starts the backoff ladder again. */
  retry(): void {
    if (!this.token || this.closedByUs) return;
    this.reconnectAttempt = 0;
    this.downSince = Date.now();
    reportSocket('presence', 'reconnecting');
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.open();
  }

  private open(): void {
    if (!this.token) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const socket = new WebSocket(`${wsUrl()}/ws/presence?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.downSince = null;
      reportSocket('presence', 'online');
    };

    socket.onmessage = (raw) => {
      let event: ServerPresenceEvent;
      try {
        event = JSON.parse(String(raw.data)) as ServerPresenceEvent;
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(event);
    };

    socket.onclose = (event) => {
      this.socket = null;
      if (this.closedByUs) return;
      // 4401 is the token being rejected, not the connection failing. Ask for a
      // fresh one - a successful refresh reconnects both sockets itself - and
      // fall through to the backoff so a refresh that cannot happen right now
      // is retried rather than being the end of it.
      if (event.code === 4401) void renewToken?.();
      this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.downSince ??= Date.now();

    // Given up on rather than retried more slowly: past the deadline the window
    // says it is disconnected and waits to be told to try again.
    if (Date.now() - this.downSince >= RECONNECT_DEADLINE_MS) {
      reportSocket('presence', 'offline');
      return;
    }
    reportSocket('presence', 'reconnecting');

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  send(event: ClientPresenceEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  on(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(): void {
    this.closedByUs = true;
    this.downSince = null;
    reportSocket('presence', 'online');
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}

export const presenceSocket = new PresenceSocket();
