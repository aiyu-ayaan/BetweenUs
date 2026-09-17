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
 *
 * The deadline restarts every time the window comes back to the screen, so a
 * laptop that was shut for an hour is not greeted by a connection that gave up
 * fifty-nine minutes ago. See `wakeUp`.
 */
export const RECONNECT_DEADLINE_MS = 30_000;

/**
 * How long a handshake may take before the attempt is written off.
 *
 * A browser WebSocket stuck in `CONNECTING` is the worst state this client can
 * be in: nothing has failed, so no `close` ever fires, so the ladder never
 * takes its next step and the banner sits on "Reconnecting…" forever. That is
 * exactly what a machine which slept mid-handshake leaves behind. A connection
 * that has not opened in ten seconds is not opening.
 */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * How often an idle socket is asked to prove it is still there.
 *
 * The gateways ping at the protocol level and drop whatever stops answering,
 * which keeps the *server* honest. Nothing kept the client honest: a laptop
 * that suspends, a wifi handover, a tunnel restarted underneath it all leave a
 * socket that reads `OPEN` and will never deliver another byte. The window then
 * shows no banner at all, which is worse than the wrong banner - it is a chat
 * app that has quietly stopped receiving messages.
 *
 * Every gateway answers `{ type: 'ping' }` with `{ type: 'pong' }`, so this is
 * the same question asked over the application protocol, where the answer is
 * visible from here.
 */
export const PING_INTERVAL_MS = 25_000;

/** Silence this long after a ping means the socket is gone, whatever `readyState` claims. */
export const PONG_TIMEOUT_MS = 10_000;

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

type Timer = ReturnType<typeof setTimeout>;

/**
 * A reconnecting JSON WebSocket.
 *
 * Chat and presence are the same machine with different vocabularies, and were
 * the same machine written out twice until a bug had to be fixed in both. The
 * rules that keep it out of the state it used to get stuck in:
 *
 *  - **One socket at a time.** `open` refuses to build a second, and everything
 *    that wants a fresh one calls `discard` first. Two live sockets deliver
 *    every message twice and take turns reporting different states.
 *  - **Only the current socket may speak.** A handler belonging to a connection
 *    that has already been replaced is a previous attempt dying late; it used to
 *    null the live socket's reference and schedule a reconnect on top of a
 *    working connection, which is how one blip became a permanent flap.
 *  - **Every wait has a timer.** A handshake, an answer to a ping, a backoff
 *    step: while the state says "reconnecting" there is always something in
 *    flight that will change it. The banner in the bug report was this machine
 *    sitting in `reconnecting` with nothing left to fire.
 */
abstract class JsonSocket<Incoming extends { type: string }, Outgoing extends { type: string }> {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private closedByUs = false;
  private attempt = 0;
  private reconnectTimer: Timer | null = null;
  /** When this socket was last up, which is what the deadline measures from. */
  private downSince: number | null = null;
  /** Armed whenever something is expected: a handshake, or an answer to a ping. */
  private silence: Timer | null = null;
  private heartbeat: Timer | null = null;
  private readonly listeners = new Set<(event: Incoming) => void>();

  protected constructor(
    private readonly name: string,
    private readonly path: string,
  ) {}

  /**
   * Called every time the session hands out an access token, which includes
   * every refresh - so a socket that is already up is left strictly alone. The
   * gateway checked the token at the handshake and does not check it again;
   * tearing a working connection down every fifteen minutes would cost a
   * re-subscribe and a gap in delivery for no reason at all.
   */
  connect(token: string): void {
    this.token = token;
    this.closedByUs = false;
    this.downSince ??= Date.now();
    this.open();
  }

  /**
   * Make sure this socket is really up.
   *
   * The banner's button, a window coming back to the screen and a machine
   * finding its network again all mean the same thing. A socket that claims to
   * be open is asked to prove it rather than believed - proving it costs one
   * frame - and anything else is thrown away and opened again from the bottom
   * of the ladder. Nothing here is allowed to be a no-op: the version this
   * replaces could return having done nothing at all while the banner said it
   * was trying, and that is the whole bug.
   */
  retry(): void {
    if (!this.token || this.closedByUs) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.probe();
      return;
    }
    this.attempt = 0;
    this.downSince = Date.now();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    reportSocket(this.name, 'reconnecting');
    this.discard();
    this.open();
  }

  private open(): void {
    if (!this.token || this.socket) return;

    const socket = new WebSocket(`${wsUrl()}${this.path}?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;
    // Nothing else bounds a handshake. A browser will sit in `CONNECTING`
    // against a path that no longer leads anywhere for minutes, and on a
    // machine that slept mid-connect, for as long as the window is left open.
    this.expect(HANDSHAKE_TIMEOUT_MS);

    socket.onopen = () => {
      if (this.socket !== socket) {
        socket.close();
        return;
      }
      this.attempt = 0;
      this.downSince = null;
      this.heard();
      this.startHeartbeat();
      reportSocket(this.name, 'online');
      this.onOpen();
    };

    socket.onmessage = (raw) => {
      if (this.socket !== socket) return;
      // Any frame at all is proof of life, which is why a busy socket is never
      // really pinged: the messages are the heartbeat.
      this.heard();
      let event: Incoming;
      try {
        event = JSON.parse(String(raw.data)) as Incoming;
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(event);
    };

    socket.onclose = (event) => {
      // A socket this client has already replaced is a previous attempt
      // finishing late; its death says nothing about the live one.
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopWaiting();
      if (this.closedByUs) return;
      // 4401 is the token being rejected, not the connection failing. Ask for a
      // fresh one - a successful refresh reconnects both sockets itself - and
      // fall through to the backoff so a refresh that cannot happen right now
      // is retried rather than being the end of it.
      if (event.code === 4401) void renewToken?.();
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      if (this.socket === socket) socket.close();
    };
  }

  /**
   * Closes the current socket without letting it drive the state machine on its
   * way out: whoever called this is about to decide what happens next, and a
   * `close` handler firing halfway through that decision is how two reconnects
   * end up racing each other.
   */
  private discard(): void {
    this.stopWaiting();
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }

  /** Something arrived, so whatever was being waited for has been answered. */
  private heard(): void {
    if (this.silence === null) return;
    clearTimeout(this.silence);
    this.silence = null;
  }

  /** Silence for `ms` means this socket is gone, whatever it says about itself. */
  private expect(ms: number): void {
    this.heard();
    this.silence = setTimeout(() => {
      this.silence = null;
      if (this.closedByUs) return;
      this.discard();
      this.downSince ??= Date.now();
      this.scheduleReconnect();
    }, ms);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.probe(), PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private stopWaiting(): void {
    this.heard();
    this.stopHeartbeat();
  }

  /**
   * Asks the gateway to say something. All four answer `ping` with `pong`.
   *
   * An answer that does not come inside [PONG_TIMEOUT_MS] is the socket being
   * gone, and the timer is armed only if nothing was already being waited on -
   * otherwise a window being focused over and over would push the deadline out
   * forever and never find out.
   */
  private probe(): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'ping' }));
    if (this.silence === null) this.expect(PONG_TIMEOUT_MS);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.downSince ??= Date.now();

    // Given up on rather than retried more slowly: past the deadline the window
    // says it is disconnected and waits to be told to try again - by the button,
    // or by coming back to the screen.
    if (Date.now() - this.downSince >= RECONNECT_DEADLINE_MS) {
      reportSocket(this.name, 'offline');
      return;
    }
    reportSocket(this.name, 'reconnecting');

    const delay = Math.min(1000 * 2 ** this.attempt, 30_000);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /** Overridden to re-subscribe: the server keeps nothing across connections. */
  protected onOpen(): void {}

  send(event: Outgoing): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  on(listener: (event: Incoming) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(): void {
    this.closedByUs = true;
    this.downSince = null;
    this.token = null;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.discard();
    // A deliberate sign-out is not a connection problem, and a banner left up
    // over the login form is a lie about a socket nothing wants open.
    reportSocket(this.name, 'online');
  }
}

/**
 * Chat socket with reconnect and channel re-subscription.
 *
 * The token rides in the query string because a browser WebSocket cannot set
 * an Authorization header; the gateway treats it as a bearer token.
 */
export class ChatSocket extends JsonSocket<ServerChatEvent, ClientChatEvent> {
  private readonly channels = new Set<string>();
  /** Servers this client watches for membership changes. */
  private readonly servers = new Set<string>();

  constructor() {
    super('chat', '/ws/chat');
  }

  /** Re-subscribe: the server keeps no membership across connections. */
  protected override onOpen(): void {
    for (const channelId of this.channels) this.send({ type: 'channel.subscribe', channelId });
    for (const serverId of this.servers) this.send({ type: 'server.subscribe', serverId });
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

  override disconnect(): void {
    this.channels.clear();
    this.servers.clear();
    super.disconnect();
  }
}

export const chatSocket = new ChatSocket();

/**
 * `/ws/presence` socket: online status, typing indicators, voice membership.
 *
 * Separate from the chat socket because presence is a separate service - the
 * client should not care that both happen to reach the same gateway host.
 */
export class PresenceSocket extends JsonSocket<ServerPresenceEvent, ClientPresenceEvent> {
  constructor() {
    super('presence', '/ws/presence');
  }
}

export const presenceSocket = new PresenceSocket();

/** The button on the banner: make sure both sockets are really there. */
export function retryConnection(): void {
  chatSocket.retry();
  presenceSocket.retry();
}

/**
 * The moments a client is not allowed to assume anything about its own sockets.
 *
 * A minimised window is a throttled window: browsers and Electron slow a hidden
 * page's timers to a crawl and freeze them outright after a few minutes, so the
 * backoff that was supposed to be reconnecting simply did not run, and the
 * socket the OS killed during sleep was never noticed. Coming back to the
 * screen - and getting the network back - is when both get checked, which is
 * why neither WhatsApp nor Discord ever shows a returning window a banner
 * somebody has to clear by hand.
 *
 * `retry` is cheap on a healthy socket: one ping.
 */
function wakeUp(): void {
  retryConnection();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('online', wakeUp);
  window.addEventListener('focus', wakeUp);
  window.addEventListener('pageshow', wakeUp);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wakeUp();
  });
}
