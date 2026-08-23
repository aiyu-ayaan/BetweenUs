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
import type {
  ClientRemoteEvent,
  RemoteMachineSummary,
  RemotePermission,
  RemoteScreen,
  RemoteSessionResponse,
  ServerRemoteEvent,
} from '@betweenus/shared-types';
import { api } from '../services/api';
import { wsUrl } from '../services/endpoint';
import { ScreenLink } from '../services/remote-peer';
import { chunksOf, safeFileName, type TransferProgress } from '../services/remote-transfer';
import { useAuthStore } from './auth';

/** Mouse moves are sampled: a session does not need 500 events a second. */
const MOVE_INTERVAL_MS = 25;

/**
 * How long the machine has to answer an offered file.
 *
 * Long enough for a machine that is busy, short enough that a controller is not
 * left staring at a progress bar that will never move. An agent that has gone
 * away answers nothing at all, and the session's own socket closing is the
 * other way this ends.
 */
const TRANSFER_ANSWER_TIMEOUT_MS = 30_000;

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
   * The machine's own sound, when the session was granted `REMOTE_AUDIO` and
   * the machine can capture it. Null on a session without it, and on a machine
   * whose platform has no loopback - which is everything but Windows today.
   */
  audioTrack: MediaStreamTrack | null;
  /** Whether the controller is listening. Off by default: sound is a surprise. */
  listening: boolean;
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
  /** The file being sent to the machine, and how far it has got. One at a time. */
  transfer: TransferProgress | null;

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
  /** Sends one file to the machine. Refused while another one is in flight. */
  sendFile: (file: File) => Promise<void>;
  /** Gives up on the file being sent; the machine throws away what arrived. */
  cancelTransfer: () => void;
  /** Clears a finished transfer off the panel. */
  dismissTransfer: () => void;
  /** Turns the machine's own sound on and off, locally. */
  setListening: (listening: boolean) => void;
  reset: () => void;
}

let socket: WebSocket | null = null;
/** The connection the agent's screen arrives over. */
let link: ScreenLink | null = null;
let lastMoveAt = 0;
/** Set when the session was opened by "Request control"; fired once it is up. */
let requestControlOnOpen = false;

/**
 * The machine's answer to the file currently being offered.
 *
 * A transfer is two things that happen in different places - a message over the
 * gateway and a stream over the data channel - and this is the join between
 * them: `sendFile` waits here, and the socket handler settles it.
 */
let answering: {
  transferId: string;
  settle: (accepted: boolean, reason?: string) => void;
} | null = null;
/** Set by a cancel, read by the sending loop between chunks. */
let transferCancelled = false;

export const useRemoteStore = create<RemoteState>((set, get) => ({
  machines: [],
  loading: false,
  error: null,
  session: null,
  status: 'ended',
  endedReason: null,
  track: null,
  audioTrack: null,
  listening: false,
  permissions: [],
  controlling: false,
  requestingControl: false,
  screens: [],
  activeScreenId: null,
  transfer: null,

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
      transfer: null,
      audioTrack: null,
      // A session that may listen starts listening. The machine's owner agreed
      // to it when they granted the permission, and a toggle that has to be
      // found before anything is heard is a feature nobody knows is there.
      listening: session.permissions.includes('REMOTE_AUDIO'),
    });
    openSocket(session, set, get);
    openLink(session, set);
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
    // A transfer waiting for an answer that is never coming has to be let go
    // before the socket does, or `sendFile` sits on a promise for its timeout.
    answering?.settle(false, 'The session ended');
    answering = null;
    transferCancelled = true;
    socket?.close();
    socket = null;

    link?.close();
    link = null;

    // The socket closing already tells the gateway, but a window that is being
    // torn down may not get the close out; the HTTP call is the belt.
    if (session) await api.endRemoteSession(session.sessionId).catch(() => undefined);
    stopClipboardSync();
    set({
      session: null,
      status: 'ended',
      track: null,
      audioTrack: null,
      listening: false,
      permissions: [],
      controlling: false,
      requestingControl: false,
      screens: [],
      activeScreenId: null,
      transfer: null,
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

  /**
   * Sends one file to the machine.
   *
   * Two channels, in this order and no other: the offer goes over the gateway,
   * which is what checks `REMOTE_FILE_TRANSFER` and writes it down, and only
   * when the machine has answered do the bytes go down the data channel
   * directly. Sending first and asking afterwards would put a file on a machine
   * whose permission nothing had checked.
   */
  sendFile: async (file) => {
    const current = get().transfer;
    if (current && (current.status === 'offering' || current.status === 'sending')) {
      set({ error: 'One file at a time; that one is still going' });
      return;
    }
    if (!get().can('REMOTE_FILE_TRANSFER')) {
      set({ error: 'This session may not send files' });
      return;
    }
    if (!link?.dataReady) {
      set({ error: 'The link to the machine is not ready yet' });
      return;
    }

    const transferId = crypto.randomUUID();
    const name = safeFileName(file.name);
    transferCancelled = false;
    set({
      error: null,
      transfer: { transferId, name, size: file.size, moved: 0, status: 'offering' },
    });
    send({ type: 'file.offer', transferId, name, size: file.size });

    // Waits for `file.accepted`, or for the machine to say no. An empty file is
    // finished by the agent before it ever answers, and `file.done` settles
    // this too - see the socket handler.
    const answer = await new Promise<{ accepted: boolean; reason?: string }>((resolve) => {
      const timer = window.setTimeout(
        () => resolve({ accepted: false, reason: 'The machine did not answer' }),
        TRANSFER_ANSWER_TIMEOUT_MS,
      );
      answering = {
        transferId,
        settle: (accepted, reason) => {
          window.clearTimeout(timer);
          answering = null;
          resolve({ accepted, reason });
        },
      };
    });

    if (!answer.accepted) {
      // `file.done` on an empty file settles this as refused-but-finished; the
      // handler has already written the outcome, so nothing is overwritten here.
      const now = get().transfer;
      if (now?.transferId === transferId && now.status === 'offering') {
        set({ transfer: { ...now, status: 'refused', detail: answer.reason } });
      }
      return;
    }

    set((state) =>
      state.transfer?.transferId === transferId
        ? { transfer: { ...state.transfer, status: 'sending' } }
        : {},
    );

    try {
      let moved = 0;
      for await (const chunk of chunksOf(file)) {
        if (transferCancelled || get().transfer?.transferId !== transferId) return;
        // Awaited, so the loop is paced by the network rather than by how fast
        // the disk can be read - see `sendBytes`.
        await link.sendBytes(chunk);
        moved += chunk.byteLength;
        set((state) =>
          state.transfer?.transferId === transferId
            ? { transfer: { ...state.transfer, moved } }
            : {},
        );
      }
      // Not marked done here. The machine says when the last byte reached its
      // disk, which is a different moment from the last byte leaving this one.
    } catch (error) {
      send({ type: 'file.cancel', transferId, reason: 'send failed' });
      set((state) =>
        state.transfer?.transferId === transferId
          ? {
              transfer: {
                ...state.transfer,
                status: 'failed',
                detail: error instanceof Error ? error.message : 'The file could not be sent',
              },
            }
          : {},
      );
    }
  },

  cancelTransfer: () => {
    const current = get().transfer;
    if (!current || current.status === 'done' || current.status === 'cancelled') return;
    transferCancelled = true;
    answering?.settle(false, 'Cancelled');
    send({ type: 'file.cancel', transferId: current.transferId, reason: 'cancelled' });
    set({ transfer: { ...current, status: 'cancelled' } });
  },

  dismissTransfer: () => set({ transfer: null }),

  setListening: (listening) => set({ listening }),

  reset: () => {
    void get().disconnect();
    set({ machines: [], error: null, endedReason: null });
  },
}));

type Setter = (
  partial: Partial<RemoteState> | ((state: RemoteState) => Partial<RemoteState>),
) => void;

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
        window.betweenus?.clipboardWrite(event.text);
        return;

      // The machine's answer to an offered file, and the receipt when the last
      // byte has landed on its disk.
      case 'file.accepted':
        if (answering?.transferId === event.transferId) answering.settle(true);
        return;

      case 'file.refused':
        if (answering?.transferId === event.transferId) {
          answering.settle(false, event.reason);
          return;
        }
        // Refused part way through: the machine gave up on a file it had
        // already taken, so the sending loop is stopped rather than left
        // pushing bytes at a file that no longer exists.
        transferCancelled = true;
        set((state) =>
          state.transfer?.transferId === event.transferId
            ? { transfer: { ...state.transfer, status: 'refused', detail: event.reason } }
            : {},
        );
        return;

      case 'file.done':
        // An empty file is finished before it is ever accepted, so this settles
        // the wait as well as reporting the outcome.
        if (answering?.transferId === event.transferId) answering.settle(false, undefined);
        set((state) =>
          state.transfer?.transferId === event.transferId
            ? {
                transfer: {
                  ...state.transfer,
                  moved: state.transfer.size,
                  status: 'done',
                  detail: event.path,
                },
              }
            : {},
        );
        return;

      // The agent's offer, and its ICE candidates. Relayed by the gateway,
      // which reads none of it.
      case 'rtc.signal':
        void link?.accept(event.data);
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
 * Waits for the agent's screen. Nothing is sent from this side.
 *
 * There is no subscription to size and nothing between the two machines to
 * resize anything: the desktop arrives at the size it was captured and the
 * element does the fitting. That was not true of the SFU build, where the
 * stream was sized to the video element and a remote desktop in a small window
 * came back soft no matter what the agent sent.
 *
 * The agent offers, so this end has nothing to do until a signal arrives - it
 * only has to exist first, or the offer would land with nowhere to go.
 */
function openLink(session: RemoteSessionResponse, set: Setter): void {
  link = new ScreenLink(false, {
    iceServers: session.iceServers,
    send: (data) => send({ type: 'rtc.signal', data }),
    onTrack: (track) => {
      set(track ? { track, status: 'live' } : { track: null });
      if (track) startClipboardSync();
    },
    // Only arrives when the machine put something on it, which it only does for
    // a session granted `REMOTE_AUDIO` on a platform that can capture loopback.
    onAudio: (track) => set({ audioTrack: track }),
    onFailed: (reason) => set({ status: 'ended', endedReason: reason, track: null }),
  });
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
  const bridge = window.betweenus;
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
