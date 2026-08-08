import type {
  ClientChatEvent,
  ClientPresenceEvent,
  ServerChatEvent,
  ServerPresenceEvent,
} from '@nexora/shared-types';

// Same story as the REST base URL: the dev server proxies /ws/chat upstream.
const WS_URL =
  import.meta.env.VITE_WS_URL ??
  (import.meta.env.DEV ? `ws://${window.location.host}` : 'ws://localhost:8080');

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
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private closedByUs = false;

  connect(token: string): void {
    this.token = token;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    if (!this.token) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const socket = new WebSocket(`${WS_URL}/ws/chat?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      // Re-subscribe: the server keeps no membership across connections.
      for (const channelId of this.channels) {
        this.send({ type: 'channel.subscribe', channelId });
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
      // 4401 means the token was rejected - reconnecting would just loop.
      if (this.closedByUs || event.code === 4401) return;
      this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
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

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private send(event: ClientChatEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  disconnect(): void {
    this.closedByUs = true;
    this.channels.clear();
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

  connect(token: string): void {
    this.token = token;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    if (!this.token) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    const socket = new WebSocket(`${WS_URL}/ws/presence?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
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
      if (this.closedByUs || event.code === 4401) return;
      this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
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
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }
}

export const presenceSocket = new PresenceSocket();
