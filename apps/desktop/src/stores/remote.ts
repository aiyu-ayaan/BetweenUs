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

  load: () => Promise<void>;
  connect: (machineId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  sendMouse: (input: Omit<Extract<ClientRemoteEvent, { type: 'input.mouse' }>, 'type'>) => void;
  sendKey: (input: Omit<Extract<ClientRemoteEvent, { type: 'input.key' }>, 'type'>) => void;
  can: (permission: RemotePermission) => boolean;
  reset: () => void;
}

let socket: WebSocket | null = null;
let room: Room | null = null;
let lastMoveAt = 0;

export const useRemoteStore = create<RemoteState>((set, get) => ({
  machines: [],
  loading: false,
  error: null,
  session: null,
  status: 'ended',
  endedReason: null,
  track: null,

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

    set({ session, status: 'waiting' });
    openSocket(session, set, get);
    await joinRoom(session, set);
  },

  disconnect: async () => {
    const session = get().session;
    socket?.close();
    socket = null;

    const current = room;
    room = null;
    if (current) await current.disconnect().catch(() => undefined);

    // The socket closing already tells the gateway, but a window that is being
    // torn down may not get the close out; the HTTP call is the belt.
    if (session) await api.endRemoteSession(session.sessionId).catch(() => undefined);
    set({ session: null, status: 'ended', track: null });
  },

  sendMouse: (input) => {
    if (!get().can('REMOTE_CONTROL')) return;
    if (input.action === 'move') {
      const now = Date.now();
      if (now - lastMoveAt < MOVE_INTERVAL_MS) return;
      lastMoveAt = now;
    }
    send({ type: 'input.mouse', ...input });
  },

  sendKey: (input) => {
    if (!get().can('REMOTE_CONTROL')) return;
    send({ type: 'input.key', ...input });
  },

  can: (permission) => get().session?.permissions.includes(permission) ?? false,

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

  next.onmessage = (raw) => {
    let event: ServerRemoteEvent;
    try {
      event = JSON.parse(String(raw.data)) as ServerRemoteEvent;
    } catch {
      return;
    }

    switch (event.type) {
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
        void navigator.clipboard.writeText(event.text).catch(() => undefined);
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

/** Subscribes to the agent's screen. Nothing is published from this side. */
async function joinRoom(session: RemoteSessionResponse, set: Setter): Promise<void> {
  const next = new Room({ adaptiveStream: true, dynacast: true });
  room = next;

  next.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Video) return;
    set({ track: track.mediaStreamTrack, status: 'live' });
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

function send(event: ClientRemoteEvent): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}
