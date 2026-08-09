/**
 * The controller side: the machines this account can reach, and the session it
 * currently holds on one of them.
 *
 * The store hides what the session was not granted, but hiding is not the
 * enforcement - the gateway refuses an event this client should never have sent
 * and audits the attempt. Both are on purpose: the UI should not offer what it
 * cannot do, and the server should not trust that it did not.
 */
import { create } from 'zustand';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import type {
  ClientRemoteEvent,
  RemoteMachineSummary,
  RemotePermission,
  RemoteScreen,
  RemoteSessionResponse,
  ServerRemoteEvent,
} from '@nexora/shared-types';
import { api } from '../services/api';
import { wsUrl } from '../services/endpoint';
import { useAuthStore } from './auth';

/** Mouse moves are sampled: a session does not need 500 events a second. */
const MOVE_INTERVAL_MS = 25;

type SessionStatus = 'connecting' | 'waiting' | 'live' | 'ended';

interface RemoteState {
  machines: RemoteMachineSummary[];
  loading: boolean;
  error: string | null;

  session: RemoteSessionResponse | null;
  status: SessionStatus;
  /** Why it ended, for the panel that replaces the screen. */
  endedReason: string | null;
  /** The agent's screen, once it is publishing. */
  track: MediaStreamTrack | null;
  /**
   * What this session may do *now*. It starts as the session's frozen
   * permissions and changes when the machine lends or takes back control, so
   * the UI never renders from what it asked for.
   */
  permissions: RemotePermission[];
  /** True while the mouse and keyboard are being sent. Off is "just watching". */
  controlling: boolean;
  /** Set while waiting for somebody at the machine to answer. */
  requestingControl: boolean;
  /** The machine's displays. Empty until the agent says, and often just one. */
  screens: RemoteScreen[];
  /** Which of them is on the wire. The agent is the authority on this. */
  activeScreenId: string | null;

  load: () => Promise<void>;
  connect: (machineId: string) => Promise<void>;
  /**
   * Reaches whoever is sharing a screen in a voice channel, by their user id.
   * Watching somebody's screen and wanting the mouse is one thought, so it is
   * one button there rather than a trip through the machine list.
   */
  connectToOwner: (userId: string, alsoRequestControl?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  sendMouse: (input: Omit<Extract<ClientRemoteEvent, { type: 'input.mouse' }>, 'type'>) => void;
  sendKey: (input: Omit<Extract<ClientRemoteEvent, { type: 'input.key' }>, 'type'>) => void;
  can: (permission: RemotePermission) => boolean;
  /** Asks the machine to send a different monitor. */
  selectScreen: (screenId: string) => void;
  /** Takes control, asking the machine for it when it was not granted up front. */
  requestControl: () => void;
  releaseControl: () => void;
  reset: () => void;
}

let socket: WebSocket | null = null;
let room: Room | null = null;
let lastMoveAt = 0;
/** Set when the session was opened by "Request control"; fired once it is up. */
let requestControlOnOpen = false;

export const useRemoteStore = create<RemoteState>((set, get) => ({
  machines: [],
  loading: false,
  error: null,
  session: null,
  status: 'ended',
  endedReason: null,
  track: null,
  permissions: [],
  controlling: false,
  requestingControl: false,
  screens: [],
  activeScreenId: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      set({ machines: await api.machines(), loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Could not list machines',
      });
    }
  },

  connect: async (machineId) => {
    await get().disconnect();
    set({ status: 'connecting', endedReason: null, error: null });

    let session: RemoteSessionResponse;
    try {
      session = await api.startRemoteSession(machineId);
    } catch (error) {
      set({
        status: 'ended',
        error: error instanceof Error ? error.message : 'That machine refused the session',
      });
      return;
    }

    set({
      session,
      status: 'waiting',
      permissions: session.permissions,
      controlling: false,
      requestingControl: false,
      screens: [],
      activeScreenId: null,
    });
    openSocket(session, set, get);
    await joinRoom(session, set);
  },

  connectToOwner: async (userId, alsoRequestControl = false) => {
    let machines = get().machines;
    if (machines.length === 0) {
      await get().load();
      machines = get().machines;
    }

    const theirs = machines.filter((machine) => machine.ownerId === userId);
    const machine = theirs.find((candidate) => candidate.online) ?? theirs[0];
    if (!machine) {
      set({ error: 'You have no remote access to a machine of theirs' });
      return;
    }
    if (!machine.online) {
      set({ error: `${machine.name} is not online` });
      return;
    }

    requestControlOnOpen = alsoRequestControl;
    await get().connect(machine.id);
  },

  disconnect: async () => {
    const session = get().session;
    requestControlOnOpen = false;
    socket?.close();
    socket = null;

    const current = room;
    room = null;
    if (current) await current.disconnect().catch(() => undefined);

    // The socket closing already tells the gateway, but a window that is being
    // torn down may not get the close out; the HTTP call is the belt.
    if (session) await api.endRemoteSession(session.sessionId).catch(() => undefined);
    stopClipboardSync();
    set({
      session: null,
      status: 'ended',
      track: null,
      permissions: [],
      controlling: false,
      requestingControl: false,
      screens: [],
      activeScreenId: null,
    });
  },

  sendMouse: (input) => {
    if (!get().controlling || !get().can('REMOTE_CONTROL')) return;
    if (input.action === 'move') {
      const now = Date.now();
      if (now - lastMoveAt < MOVE_INTERVAL_MS) return;
      lastMoveAt = now;
    }
    send({ type: 'input.mouse', ...input });
  },

  sendKey: (input) => {
    if (!get().controlling || !get().can('REMOTE_CONTROL')) return;
    send({ type: 'input.key', ...input });
  },

  can: (permission) => get().permissions.includes(permission),

  selectScreen: (screenId) => {
    // Not written to `activeScreenId` here: the agent answers with a fresh
    // `screens` once the swap worked, and a label that moved before the picture
    // did would be a lie during the second it takes.
    send({ type: 'screen.select', screenId });
  },

  /**
   * One button, two behaviours. A session already granted control just starts
   * sending; one that was not asks the machine, and somebody sitting at it
   * answers - which is how RDP works, and the one case where a person present
   * outranks a stored grant.
   */
  requestControl: () => {
    if (!get().session) return;
    if (get().can('REMOTE_CONTROL')) {
      set({ controlling: true });
      return;
    }
    set({ requestingControl: true });
    send({ type: 'control.request' });
  },

  releaseControl: () => {
    set({ controlling: false });
    send({ type: 'control.release' });
  },

  reset: () => {
    void get().disconnect();
    set({ machines: [], error: null, endedReason: null });
  },
}));

type Setter = (partial: Partial<RemoteState>) => void;

function openSocket(
  session: RemoteSessionResponse,
  set: Setter,
  get: () => RemoteState,
): void {
  const token = useAuthStore.getState().accessToken ?? '';
  const next = new WebSocket(
    `${wsUrl()}/ws/remote?sessionId=${encodeURIComponent(session.sessionId)}` +
      `&token=${encodeURIComponent(token)}`,
  );
  socket = next;

  // A session opened from "Request control" asks the moment there is something
  // to ask over; `send` is a no-op before the socket is up.
  next.onopen = () => {
    if (!requestControlOnOpen) return;
    requestControlOnOpen = false;
    get().requestControl();
  };

  next.onmessage = (raw) => {
    let event: ServerRemoteEvent;
    try {
      event = JSON.parse(String(raw.data)) as ServerRemoteEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case 'control.changed':
        set({
          permissions: event.permissions,
          requestingControl: false,
          controlling: event.granted,
          ...(event.granted ? {} : { error: event.reason ?? null }),
        });
        return;

      case 'screens':
        set({ screens: event.screens, activeScreenId: event.activeId || null });
        return;

      case 'agent.state':
        if (event.state === 'refused') {
          set({ status: 'ended', endedReason: event.reason ?? 'The machine refused' });
        }
        return;

      case 'session.ended':
        set({ status: 'ended', endedReason: event.reason, track: null });
        void get().disconnect();
        return;

      case 'clipboard.set':
        // Remembered before writing so the poller does not read it straight
        // back out and send it round again.
        lastClipboard = event.text;
        window.nexora?.clipboardWrite(event.text);
        return;

      case 'error':
        set({ error: event.message });
        return;

      default:
        return;
    }
  };

  // A session with no socket is not a session; there is nothing to reconnect
  // to, because the gateway ended it the moment this closed.
  next.onclose = () => {
    if (socket === next) socket = null;
  };
  next.onerror = () => next.close();
}

/**
 * Subscribes to the agent's screen. Nothing is published from this side.
 *
 * `adaptiveStream` is off on purpose, unlike a voice call: it sizes the
 * subscription to the video element, so a remote desktop in a window smaller
 * than the machine's screen was downscaled and then stretched back up, which is
 * what made the picture soft no matter what the agent published. A desktop
 * arrives at the size it was captured and the element does the fitting.
 */
async function joinRoom(session: RemoteSessionResponse, set: Setter): Promise<void> {
  const next = new Room({ adaptiveStream: false, dynacast: false });
  room = next;

  next.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Video) return;
    set({ track: track.mediaStreamTrack, status: 'live' });
    startClipboardSync();
  });
  next.on(RoomEvent.TrackUnsubscribed, () => set({ track: null }));
  next.on(RoomEvent.Disconnected, () => {
    if (room === next) room = null;
    set({ track: null });
  });

  const url = session.livekitUrl.startsWith('/')
    ? `${wsUrl()}${session.livekitUrl}`
    : session.livekitUrl;

  try {
    await next.connect(url, session.token);
  } catch (error) {
    set({
      status: 'ended',
      endedReason: error instanceof Error ? error.message : 'Could not reach the media server',
    });
  }
}

/**
 * Clipboard sync, controller side. Polled for the same reason the agent polls:
 * there is no reliable clipboard change event, and a second is fast enough for
 * copy-then-paste.
 */
let clipboardTimer: number | null = null;
let lastClipboard = '';

function startClipboardSync(): void {
  stopClipboardSync();
  const bridge = window.nexora;
  if (!bridge) return;

  clipboardTimer = window.setInterval(() => {
    if (!useRemoteStore.getState().can('REMOTE_CLIPBOARD')) return;
    void bridge.clipboardRead().then((text) => {
      if (!text || text === lastClipboard) return;
      lastClipboard = text;
      send({ type: 'clipboard.set', text });
    });
  }, 1000);
}

function stopClipboardSync(): void {
  if (clipboardTimer !== null) window.clearInterval(clipboardTimer);
  clipboardTimer = null;
  lastClipboard = '';
}

function send(event: ClientRemoteEvent): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}
