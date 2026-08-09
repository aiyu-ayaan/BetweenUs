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

/** Somebody asking for the mouse and keyboard part way through a session. */
interface ControlRequest {
  sessionId: string;
  controllerName: string;
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
  /** A live session where the controller has asked for control. */
  controlRequest: ControlRequest | null;
  session: ActiveSession | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  accept: () => void;
  refuse: (reason?: string) => void;
  /** Answers a request for the mouse and keyboard on a session already running. */
  answerControl: (granted: boolean) => void;
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
  controlRequest: null,
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

  answerControl: (granted) => {
    const request = get().controlRequest;
    if (!request) return;
    set({ controlRequest: null });
    send(
      granted
        ? { type: 'control.granted', sessionId: request.sessionId }
        : { type: 'control.denied', sessionId: request.sessionId, reason: 'declined' },
    );
    if (granted) {
      const session = get().session;
      if (session) {
        set({
          session: {
            ...session,
            permissions: [...session.permissions, 'REMOTE_CONTROL'],
          },
        });
      }
    }
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
      useAgentStore.setState({ pending: null, controlRequest: null });
      await teardown(event.reason);
      return;

    case 'screen.select':
      await switchScreen(event.sessionId, event.screenId);
      return;

    case 'control.requested':
      useAgentStore.setState({
        controlRequest: {
          sessionId: event.sessionId,
          controllerName: event.controllerName,
        },
      });
      return;

    // Control handed back, or taken away. The banner reads from this, so it
    // stops claiming somebody can type when they no longer can.
    case 'control.changed': {
      const session = useAgentStore.getState().session;
      if (session && session.sessionId === event.sessionId) {
        useAgentStore.setState({ session: { ...session, permissions: event.permissions } });
      }
      return;
    }

    // Input has already been checked against the session's permissions by the
    // gateway; this side only applies it.
    case 'input.mouse':
      window.nexora?.remoteMouse(event);
      return;

    case 'input.key':
      window.nexora?.remoteKey(event);
      return;

    case 'clipboard.set':
      // Remembered before writing, so the poller below does not read it back
      // out and send it straight to the other end again.
      lastClipboard = event.text;
      window.nexora?.clipboardWrite(event.text);
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

/** The displays this machine offers, and the one currently on the wire. */
let displays: DisplayInfo[] = [];
let activeDisplayId: string | null = null;

/**
 * Publishes one of this machine's screens into the session's room.
 *
 * The picker is bypassed on purpose: a controller asked for this machine, not
 * for a window, and there is nobody to choose in an unattended session. Which
 * *monitor* is a different question, and one the controller is the right side
 * to answer - it is looking at the thing. The primary display starts, the list
 * travels with the session, and `screen.select` swaps it.
 *
 * Resolution follows the display rather than a fixed preset, which is what
 * makes text on the far end readable. LiveKit caps a screen share at 1080p
 * unless it is told the capture size, so a 1440p or a scaled display arrived
 * soft; asking for the display's real pixel size and telling the encoder to
 * keep resolution over frame rate is the same bargain RustDesk makes - a remote
 * desktop that is sharp at 10fps beats a blurry one at 30. The bitrate is
 * derived from the pixel count rather than fixed, so a 4K machine is not sent
 * through a 1080p-sized pipe, and LiveKit still drops frames on its own when
 * the link cannot carry it.
 */
async function startPublishing(pending: PendingSession): Promise<void> {
  const credentials = media.get(pending.sessionId);
  if (!credentials) return;

  try {
    displays = (await window.nexora?.screenDisplays()) ?? [];
    const display = displays.find((entry) => entry.primary) ?? displays[0];
    if (!display) throw new Error('no display to share');

    const next = new Room({ adaptiveStream: false, dynacast: false });
    room = next;
    next.on(RoomEvent.Disconnected, () => {
      if (room === next) room = null;
    });

    const url = credentials.livekitUrl.startsWith('/')
      ? `${wsUrl()}${credentials.livekitUrl}`
      : credentials.livekitUrl;
    await next.connect(url, credentials.token);
    await publishDisplay(next, display);

    useAgentStore.setState({
      session: {
        sessionId: pending.sessionId,
        controllerName: pending.controllerName,
        permissions: pending.permissions,
      },
    });
    send({ type: 'session.accepted', sessionId: pending.sessionId });
    sendScreens(pending.sessionId);
    startClipboardSync(pending.sessionId);
  } catch (error) {
    send({
      type: 'session.refused',
      sessionId: pending.sessionId,
      reason: error instanceof Error ? error.message : 'capture failed',
    });
    await teardown('capture-failed');
  }
}

/**
 * Puts one display on the wire, and points input injection at the same one.
 *
 * Those two have to move together or a controller watching the second monitor
 * clicks on the first, which is the multi-monitor version of the bug that made
 * clicks land short on a scaled display.
 */
async function publishDisplay(target: Room, display: DisplayInfo): Promise<void> {
  await window.nexora?.selectScreenSource(display.sourceId, false);
  await target.localParticipant.setScreenShareEnabled(
    true,
    {
      audio: false,
      resolution: { width: display.width, height: display.height, frameRate: 30 },
      // 'text' tells the encoder this is a desktop, not a video: sharp edges
      // matter more than smooth motion.
      contentHint: 'text',
    },
    {
      simulcast: false,
      degradationPreference: 'maintain-resolution',
      screenShareEncoding: {
        maxFramerate: 30,
        maxBitrate: bitrateFor(display.width, display.height),
      },
    },
  );
  activeDisplayId = display.id;
  window.nexora?.remoteTarget(display.id);
}

/**
 * Switches which monitor the session is watching.
 *
 * The old track is unpublished first: Chromium's capture is bound to the source
 * it was started with, so there is no way to redirect it in place. The
 * controller finds out it worked from the `screens` that follows, never from
 * having asked.
 */
async function switchScreen(sessionId: string, screenId: string): Promise<void> {
  const current = room;
  const display = displays.find((entry) => entry.id === screenId);
  if (!current || !display || display.id === activeDisplayId) return;

  try {
    await current.localParticipant.setScreenShareEnabled(false);
    await publishDisplay(current, display);
  } catch {
    // The old screen is gone and the new one did not start. Say what is true
    // rather than leaving the controller looking at a stale label.
    activeDisplayId = null;
  }
  sendScreens(sessionId);
}

function sendScreens(sessionId: string): void {
  if (displays.length === 0) return;
  send({
    type: 'screens',
    sessionId,
    activeId: activeDisplayId ?? '',
    screens: displays.map((display) => ({
      id: display.id,
      label: display.label,
      width: display.width,
      height: display.height,
      primary: display.primary,
    })),
  });
}

/**
 * A ceiling for the encoder, scaled to the number of pixels being sent.
 *
 * 1080p at 30fps of mostly-static desktop sits comfortably under 4 Mbps; the
 * rest is proportional to the area, clamped so a 4K display does not ask for a
 * link nobody has. This is a ceiling, not a target - the encoder spends far
 * less on a still screen and LiveKit lowers it further when the link says so.
 */
function bitrateFor(width: number, height: number): number {
  const perPixel = 4_000_000 / (1920 * 1080);
  return Math.min(12_000_000, Math.max(1_500_000, Math.round(width * height * perPixel)));
}

/**
 * Clipboard sync, machine side.
 *
 * Polled rather than evented, because no platform offers a reliable clipboard
 * change event and Electron does not expose one. A second is fast enough for
 * copy-then-paste and cheap enough to ignore.
 *
 * ponytail: text only. Files and images through a clipboard are a transfer
 * mechanism, and that is REMOTE_FILE_TRANSFER's job rather than this one's.
 */
let clipboardTimer: number | null = null;
let lastClipboard = '';

function startClipboardSync(sessionId: string): void {
  stopClipboardSync();
  const bridge = window.nexora;
  if (!bridge) return;

  clipboardTimer = window.setInterval(() => {
    const session = useAgentStore.getState().session;
    if (!session || !session.permissions.includes('REMOTE_CLIPBOARD')) return;
    void bridge.clipboardRead().then((text) => {
      if (!text || text === lastClipboard) return;
      lastClipboard = text;
      send({ type: 'clipboard.text', sessionId, text });
    });
  }, 1000);
}

function stopClipboardSync(): void {
  if (clipboardTimer !== null) window.clearInterval(clipboardTimer);
  clipboardTimer = null;
  lastClipboard = '';
}

async function teardown(_reason: string): Promise<void> {
  clearConsentTimer();
  stopClipboardSync();
  const current = room;
  room = null;
  displays = [];
  activeDisplayId = null;
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
  useAgentStore.setState({
    status: 'off',
    pending: null,
    controlRequest: null,
    session: null,
    machineId: null,
  });
}
