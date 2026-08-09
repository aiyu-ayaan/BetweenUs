/**
 * The agent: this machine, offering itself for remote access.
 *
 * It is part of the desktop app rather than a service of its own, because the
 * app is already on the machine and already has everything an agent needs -
 * screen capture, a LiveKit publisher, and an OS keychain to keep a credential
 * in. `apps/services/remote-agent` stays reserved for a headless server that
 * has no Nexora window to run inside.
 *
 * Nothing here decides what a controller may do. The gateway checked the grant
 * before the session existed and refuses every event the session was not
 * granted; by the time an input event arrives here it has already been allowed.
 * The one decision this side makes is whether to accept the session at all.
 */
import { create } from 'zustand';
import { Room, RoomEvent } from 'livekit-client';
import type { AgentRemoteEvent, RemotePermission, ServerRemoteEvent } from '@nexora/shared-types';
import { api } from './api';
import { wsUrl } from './endpoint';
import { secureGet, secureSet } from './e2ee';

const TOKEN_KEY = 'remote.agentToken';
const MACHINE_KEY = 'remote.machineId';
/** Machine-local, not per account: enabling remote access is a machine decision. */
const ENABLED_KEY = 'nexora.remote.enabled';

/** A request from someone who is not the owner is refused if nobody answers. */
const CONSENT_TIMEOUT_MS = 30_000;

interface PendingSession {
  sessionId: string;
  controllerName: string;
  permissions: RemotePermission[];
}

interface ActiveSession {
  sessionId: string;
  controllerName: string;
  permissions: RemotePermission[];
}

interface AgentState {
  /** The switch in settings. Off is off: no socket, no enrolment, nothing. */
  enabled: boolean;
  machineId: string | null;
  machineName: string;
  status: 'off' | 'connecting' | 'online' | 'error';
  error: string | null;
  /** True on a platform where a controller can actually type; view-only elsewhere. */
  controlSupported: boolean;
  /** Waiting for the person at this machine to say yes. */
  pending: PendingSession | null;
  session: ActiveSession | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  accept: () => void;
  refuse: (reason?: string) => void;
  /** Ends the session from this side - the machine's owner pulling the plug. */
  endSession: () => void;
  /** Called at sign-in; reconnects if the switch was left on. */
  restore: (ownerId: string) => Promise<void>;
}

let socket: WebSocket | null = null;
let room: Room | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempt = 0;
let consentTimer: number | null = null;
/** The account signed in here; a session from them needs no prompt. */
let selfUserId: string | null = null;
let closedByUs = false;

export const useAgentStore = create<AgentState>((set, get) => ({
  enabled: localStorage.getItem(ENABLED_KEY) === '1',
  machineId: null,
  machineName: 'This machine',
  status: 'off',
  error: null,
  controlSupported: false,
  pending: null,
  session: null,

  enable: async () => {
    localStorage.setItem(ENABLED_KEY, '1');
    set({ enabled: true, error: null });
    await connect();
  },

  disable: async () => {
    localStorage.removeItem(ENABLED_KEY);
    set({ enabled: false, status: 'off', pending: null, session: null });
    await teardown('disabled');
    closedByUs = true;
    socket?.close();
    socket = null;
  },

  accept: () => {
    const pending = get().pending;
    if (!pending) return;
    clearConsentTimer();
    set({ pending: null });
    void startPublishing(pending);
  },

  refuse: (reason = 'declined') => {
    const pending = get().pending;
    if (!pending) return;
    clearConsentTimer();
    set({ pending: null });
    send({ type: 'session.refused', sessionId: pending.sessionId, reason });
  },

  endSession: () => {
    const session = get().session;
    if (!session) return;
    send({ type: 'session.ended', sessionId: session.sessionId });
    void teardown('agent');
  },

  restore: async (ownerId) => {
    selfUserId = ownerId;
    set({
      machineName: (await window.nexora?.machineName()) ?? 'This machine',
      controlSupported: (await window.nexora?.remoteInputSupported()) ?? false,
      machineId: await secureGet(MACHINE_KEY),
    });
    if (get().enabled) await connect();
  },
}));

/**
 * Enrols if this machine has never enrolled, then opens the outbound socket.
 *
 * Enrolment needs the signed-in account, because the person enrolling is the
 * person who will own the machine. The token that comes back is what the socket
 * uses afterwards, so a session survives the access token expiring.
 */
async function connect(): Promise<void> {
  useAgentStore.setState({ status: 'connecting', error: null });
  closedByUs = false;

  let token = await secureGet(TOKEN_KEY);
  let machineId = await secureGet(MACHINE_KEY);

  if (!token) {
    try {
      const name = (await window.nexora?.machineName()) ?? 'This machine';
      const result = await api.enrolMachine(name, window.nexora?.platform ?? 'unknown', machineId ?? undefined);
      token = result.agentToken;
      machineId = result.machine.id;
      await secureSet(TOKEN_KEY, token);
      await secureSet(MACHINE_KEY, machineId);
      useAgentStore.setState({ machineId, machineName: result.machine.name });
    } catch (error) {
      useAgentStore.setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not enrol this machine',
      });
      return;
    }
  }

  openSocket(token);
}

function openSocket(token: string): void {
  if (socket && socket.readyState <= WebSocket.OPEN) return;

  const next = new WebSocket(`${wsUrl()}/ws/remote?agent=${encodeURIComponent(token)}`);
  socket = next;

  next.onopen = () => {
    reconnectAttempt = 0;
    useAgentStore.setState({ status: 'online', error: null });
    send({ type: 'agent.ready', screens: 1 });
  };

  next.onmessage = (raw) => {
    let event: ServerRemoteEvent;
    try {
      event = JSON.parse(String(raw.data)) as ServerRemoteEvent;
    } catch {
      return;
    }
    void onEvent(event);
  };

  next.onclose = (event) => {
    socket = null;
    useAgentStore.setState({ status: closedByUs ? 'off' : 'connecting' });
    // 4401 is a token this gateway does not know: the machine was removed, or
    // it was re-enrolled somewhere else. Reconnecting would loop forever, so
    // the stored credential is dropped and the switch reports it.
    if (event.code === 4401) {
      void secureSet(TOKEN_KEY, '');
      useAgentStore.setState({
        status: 'error',
        error: 'This machine is no longer enrolled. Turn remote access off and on to enrol again.',
      });
      return;
    }
    if (closedByUs || !useAgentStore.getState().enabled) return;
    scheduleReconnect(token);
  };

  next.onerror = () => next.close();
}

function scheduleReconnect(token: string): void {
  if (reconnectTimer !== null) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    openSocket(token);
  }, delay);
}

async function onEvent(event: ServerRemoteEvent): Promise<void> {
  switch (event.type) {
    case 'session.start': {
      const pending: PendingSession & { room: string; livekitUrl: string; token: string } = {
        sessionId: event.sessionId,
        controllerName: event.controllerName,
        permissions: event.permissions,
        room: event.room,
        livekitUrl: event.livekitUrl,
        token: event.token,
      };
      media.set(event.sessionId, pending);

      // The owner reaching their own machine from another device is the case
      // remote access exists for; asking them to walk over and click yes would
      // defeat it. Anyone else has to be let in by whoever is sitting here.
      if (event.controllerId === selfUserId) {
        void startPublishing(pending);
        return;
      }

      useAgentStore.setState({ pending });
      clearConsentTimer();
      consentTimer = window.setTimeout(() => {
        useAgentStore.getState().refuse('nobody answered');
      }, CONSENT_TIMEOUT_MS);
      return;
    }

    case 'session.ended':
      clearConsentTimer();
      media.delete(event.sessionId);
      useAgentStore.setState({ pending: null });
      await teardown(event.reason);
      return;

    // Input has already been checked against the session's permissions by the
    // gateway; this side only applies it.
    case 'input.mouse':
      window.nexora?.remoteMouse(event);
      return;

    case 'input.key':
      window.nexora?.remoteKey(event);
      return;

    case 'clipboard.set':
      await navigator.clipboard.writeText(event.text).catch(() => undefined);
      return;

    default:
      return;
  }
}

/** Session id -> the LiveKit credentials that came with it. */
const media = new Map<
  string,
  PendingSession & { room: string; livekitUrl: string; token: string }
>();

/**
 * Publishes the primary screen into the session's room.
 *
 * The picker is bypassed on purpose: a controller asked for this machine, not
 * for a window, and there is nobody to choose in an unattended session.
 */
async function startPublishing(pending: PendingSession): Promise<void> {
  const credentials = media.get(pending.sessionId);
  if (!credentials) return;

  try {
    const sources = (await window.nexora?.screenSources()) ?? [];
    const screen = sources.find((source) => source.kind === 'screen');
    await window.nexora?.selectScreenSource(screen?.id ?? '', false);

    const next = new Room({ adaptiveStream: false, dynacast: false });
    room = next;
    next.on(RoomEvent.Disconnected, () => {
      if (room === next) room = null;
    });

    const url = credentials.livekitUrl.startsWith('/')
      ? `${wsUrl()}${credentials.livekitUrl}`
      : credentials.livekitUrl;
    await next.connect(url, credentials.token);
    await next.localParticipant.setScreenShareEnabled(true, { audio: false });

    useAgentStore.setState({
      session: {
        sessionId: pending.sessionId,
        controllerName: pending.controllerName,
        permissions: pending.permissions,
      },
    });
    send({ type: 'session.accepted', sessionId: pending.sessionId });
  } catch (error) {
    send({
      type: 'session.refused',
      sessionId: pending.sessionId,
      reason: error instanceof Error ? error.message : 'capture failed',
    });
    await teardown('capture-failed');
  }
}

async function teardown(_reason: string): Promise<void> {
  clearConsentTimer();
  const current = room;
  room = null;
  useAgentStore.setState({ session: null });
  window.nexora?.remoteInputStop();
  if (current) await current.disconnect().catch(() => undefined);
}

function clearConsentTimer(): void {
  if (consentTimer !== null) window.clearTimeout(consentTimer);
  consentTimer = null;
}

function send(event: AgentRemoteEvent): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

/** Called on sign-out: the machine stops offering itself with nobody signed in. */
export async function stopAgent(): Promise<void> {
  closedByUs = true;
  selfUserId = null;
  await teardown('signed-out');
  socket?.close();
  socket = null;
  useAgentStore.setState({ status: 'off', pending: null, session: null, machineId: null });
}
