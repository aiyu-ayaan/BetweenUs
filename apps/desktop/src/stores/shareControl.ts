/**
 * Giving somebody the mouse on a screen you are sharing in a call.
 *
 * This is not a remote-desktop session and it deliberately does not become one.
 * A remote session is a standing arrangement: the machine is enrolled, a grant
 * was written down beforehand, and a gateway enforces it. What happens in a
 * call is the opposite - two people are already talking, one of them is showing
 * the other a problem, and "here, you do it" should not need an administrator.
 * Teams calls it giving control, and the shape is the same one.
 *
 * So the whole exchange rides the room's own data channel, between the two
 * clients, and the only authority is the person sharing clicking yes. That is
 * the right authority: it is their machine, they are sitting at it, and they
 * can see what is being done with it. Nothing here can start without them, and
 * one click ends it.
 *
 * What keeps it honest:
 *
 * - LiveKit says who sent a packet, and that identity comes from a token
 *   call-service signed. A participant cannot claim to be someone else.
 * - Input is applied only from the one identity control was granted to, only
 *   while a screen is still being shared, and only when that share is a whole
 *   display - a window can be dragged between monitors, so there is no fraction
 *   of a screen to map a click onto, and control of one is refused.
 * - Control ends when the share ends, when the room does, when that person
 *   leaves, when either side presses the button, and when the person driving
 *   presses Escape.
 *
 * Pointers are the other half. Several people watch a share and any of them may
 * be pointing at something; each sends where their cursor is over the picture,
 * everyone draws everyone else's with a name on it, and a pointer that goes
 * quiet disappears. Only one person can drive, but everybody can point.
 */
import { create } from 'zustand';
import { RoomEvent, type Participant, type RemoteParticipant, type Room } from 'livekit-client';
// Circular by design and safe: the voice store attaches this one, and this one
// only reads it from inside a function, long after both modules have loaded.
import { useVoiceStore } from './voice';

/** Mouse moves are sampled; the far end does not need 500 events a second. */
const MOVE_INTERVAL_MS = 25;
/** Pointers are cosmetic, so they are sent less often and dropped when late. */
const POINTER_INTERVAL_MS = 60;
/** A pointer nobody has heard from in this long has left the picture. */
const POINTER_STALE_MS = 4_000;

const TOPIC = 'nexora.share';

interface Person {
  identity: string;
  name: string;
}

/** A cursor to draw, in fractions of the shared screen. */
export interface SharePointer {
  identity: string;
  name: string;
  x: number;
  y: number;
  at: number;
}

type Wire =
  | { k: 'ask' }
  | { k: 'grant' }
  | { k: 'deny'; why: string }
  | { k: 'revoke' }
  | {
      k: 'm';
      a: 'move' | 'down' | 'up' | 'wheel';
      x: number;
      y: number;
      b?: 'left' | 'right' | 'middle';
      d?: number;
    }
  | { k: 'key'; a: 'down' | 'up'; key: string; code: string }
  | { k: 'p'; x: number; y: number }
  | { k: 'p.off' };

interface ShareControlState {
  /** Sharer side: people who have asked and have not been answered. */
  requests: Person[];
  /** Sharer side: who is driving this machine right now. */
  controller: Person | null;
  /** Viewer side: waiting for an answer. */
  asking: boolean;
  /** Viewer side: the identity whose screen this client is driving. */
  driving: string | null;
  /** Viewer side: why the last ask was turned down. */
  refusal: string | null;
  /** Everyone: identity -> where their cursor is over the share. */
  pointers: Record<string, SharePointer>;

  /** Called by the voice store when a room comes and goes. */
  attach: (room: Room) => void;
  detach: () => void;

  ask: (sharer: Person) => void;
  answer: (identity: string, granted: boolean) => void;
  /** Sharer takes it back, or the driver hands it over - same wire, same end. */
  stop: () => void;

  sendPointer: (x: number, y: number) => void;
  clearPointer: () => void;
  sendMouse: (
    action: 'move' | 'down' | 'up' | 'wheel',
    x: number,
    y: number,
    button?: 'left' | 'right' | 'middle',
    deltaY?: number,
  ) => void;
  sendKey: (action: 'down' | 'up', key: string, code: string) => void;
}

let room: Room | null = null;
let lastMoveAt = 0;
let lastPointerAt = 0;
let sweeper: number | null = null;
/** Who this client asked, so an unsolicited "yes" from anyone else is ignored. */
let asked: string | null = null;
type DataHandler = (
  payload: Uint8Array,
  participant?: RemoteParticipant,
  kind?: unknown,
  topic?: string,
) => void;
let onData: DataHandler | null = null;
let onGone: ((participant: RemoteParticipant) => void) | null = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function publish(message: Wire, to: string[] | undefined, reliable: boolean): void {
  if (!room) return;
  void room.localParticipant
    .publishData(encoder.encode(JSON.stringify(message)), {
      reliable,
      topic: TOPIC,
      ...(to ? { destinationIdentities: to } : {}),
    })
    .catch(() => undefined);
}

const nameOf = (participant: Participant): string => participant.name || participant.identity;

export const useShareControlStore = create<ShareControlState>((set, get) => ({
  requests: [],
  controller: null,
  asking: false,
  driving: null,
  refusal: null,
  pointers: {},

  attach: (next) => {
    get().detach();
    room = next;

    onData = (payload, participant, _kind, topic) => {
      if (topic !== TOPIC || !participant) return;
      let message: Wire;
      try {
        message = JSON.parse(decoder.decode(payload)) as Wire;
      } catch {
        return;
      }
      onMessage(message, participant, set, get);
    };
    next.on(RoomEvent.DataReceived, onData);

    // Somebody who leaves cannot still be driving, and their cursor should not
    // be left on screen.
    onGone = (participant) => {
      const identity = participant.identity;
      set((state) => {
        const pointers = { ...state.pointers };
        delete pointers[identity];
        return {
          pointers,
          requests: state.requests.filter((person) => person.identity !== identity),
          controller: state.controller?.identity === identity ? null : state.controller,
          driving: state.driving === identity ? null : state.driving,
          asking: state.driving === identity ? false : state.asking,
        };
      });
      if (get().controller === null) window.nexora?.remoteTarget(null);
    };
    next.on(RoomEvent.ParticipantDisconnected, onGone);

    // A cursor that stopped arriving has left the picture; nothing sends a
    // farewell when a window closes.
    sweeper = window.setInterval(() => {
      const cutoff = Date.now() - POINTER_STALE_MS;
      const pointers = Object.fromEntries(
        Object.entries(get().pointers).filter(([, pointer]) => pointer.at > cutoff),
      );
      if (Object.keys(pointers).length !== Object.keys(get().pointers).length) set({ pointers });
    }, 1_000);
  },

  detach: () => {
    if (sweeper !== null) window.clearInterval(sweeper);
    sweeper = null;
    // Taken off the old room rather than left on it: a room that is replaced
    // rather than disconnected would otherwise keep feeding this store.
    if (room && onData) room.off(RoomEvent.DataReceived, onData);
    if (room && onGone) room.off(RoomEvent.ParticipantDisconnected, onGone);
    onData = null;
    onGone = null;
    room = null;
    asked = null;
    window.nexora?.remoteTarget(null);
    set({
      requests: [],
      controller: null,
      asking: false,
      driving: null,
      refusal: null,
      pointers: {},
    });
  },

  ask: (sharer) => {
    asked = sharer.identity;
    set({ asking: true, refusal: null, driving: null });
    publish({ k: 'ask' }, [sharer.identity], true);
  },

  answer: (identity, granted) => {
    const request = get().requests.find((person) => person.identity === identity);
    set((state) => ({ requests: state.requests.filter((person) => person.identity !== identity) }));
    if (!request) return;

    if (!granted) {
      publish({ k: 'deny', why: 'declined' }, [identity], true);
      return;
    }

    // The share can have stopped between the ask and the answer, and granting
    // control of a screen nobody is sending would be a grant with no picture
    // over it - the one situation where somebody is driving blind.
    const refusal = whyControlIsImpossible();
    if (refusal) {
      publish({ k: 'deny', why: refusal }, [identity], true);
      return;
    }

    // Whatever was being controlled before is not any more: one driver.
    const previous = get().controller;
    if (previous && previous.identity !== identity) {
      publish({ k: 'revoke' }, [previous.identity], true);
    }

    // Input arrives as a fraction of the shared display, so the main process
    // has to be told which display that is before the first event lands.
    // ponytail: one target for the whole process, so a machine that is in a
    // remote session *and* handing control out in a call has the later of the
    // two win. Per-session targets are the fix if that ever matters.
    const displayId = sharedDisplayId();
    window.nexora?.remoteTarget(displayId);
    set({ controller: request });
    publish({ k: 'grant' }, [identity], true);
  },

  stop: () => {
    const { controller, driving } = get();
    if (controller) {
      publish({ k: 'revoke' }, [controller.identity], true);
      window.nexora?.remoteTarget(null);
      set({ controller: null });
    }
    if (driving) {
      publish({ k: 'revoke' }, [driving], true);
      asked = null;
      set({ driving: null, asking: false });
    }
  },

  sendPointer: (x, y) => {
    const now = Date.now();
    if (now - lastPointerAt < POINTER_INTERVAL_MS) return;
    lastPointerAt = now;
    publish({ k: 'p', x, y }, undefined, false);
  },

  clearPointer: () => publish({ k: 'p.off' }, undefined, false),

  sendMouse: (action, x, y, button, deltaY) => {
    const target = get().driving;
    if (!target) return;
    if (action === 'move') {
      const now = Date.now();
      if (now - lastMoveAt < MOVE_INTERVAL_MS) return;
      lastMoveAt = now;
    }
    publish({ k: 'm', a: action, x, y, b: button, d: deltaY }, [target], action !== 'move');
  },

  sendKey: (action, key, code) => {
    const target = get().driving;
    if (!target) return;
    publish({ k: 'key', a: action, key, code }, [target], true);
  },
}));

type Setter = (
  partial:
    | Partial<ShareControlState>
    | ((state: ShareControlState) => Partial<ShareControlState>),
) => void;

function onMessage(
  message: Wire,
  from: Participant,
  set: Setter,
  get: () => ShareControlState,
): void {
  const identity = from.identity;

  switch (message.k) {
    case 'p':
      set((state) => ({
        pointers: {
          ...state.pointers,
          [identity]: { identity, name: nameOf(from), x: message.x, y: message.y, at: Date.now() },
        },
      }));
      return;

    case 'p.off':
      set((state) => {
        const pointers = { ...state.pointers };
        delete pointers[identity];
        return { pointers };
      });
      return;

    // Somebody wants the mouse. Nothing is granted here - it goes in front of
    // the person sharing, and stays there until they answer.
    case 'ask': {
      const refusal = whyControlIsImpossible();
      if (refusal) {
        publish({ k: 'deny', why: refusal }, [identity], true);
        return;
      }
      set((state) =>
        state.requests.some((person) => person.identity === identity)
          ? {}
          : { requests: [...state.requests, { identity, name: nameOf(from) }] },
      );
      return;
    }

    // Only from the person who was asked. An unsolicited "yes" is somebody
    // else's client being strange, and acting on it would point this window's
    // keyboard at a machine nobody offered.
    case 'grant':
      if (asked !== identity) return;
      asked = null;
      set({ driving: identity, asking: false, refusal: null });
      return;

    case 'deny':
      if (asked !== identity) return;
      asked = null;
      set({ asking: false, driving: null, refusal: message.why });
      return;

    // Sent by either side: the sharer taking it back, or the driver letting go.
    case 'revoke':
      if (get().controller?.identity === identity) {
        window.nexora?.remoteTarget(null);
        set({ controller: null });
      }
      if (get().driving === identity) set({ driving: null, asking: false });
      return;

    case 'm': {
      if (!mayDrive(identity, get)) return;
      window.nexora?.remoteMouse({
        action: message.a,
        x: message.x,
        y: message.y,
        button: message.b,
        deltaY: message.d,
      });
      return;
    }

    case 'key': {
      if (!mayDrive(identity, get)) return;
      window.nexora?.remoteKey({ action: message.a, key: message.key, code: message.code });
      return;
    }

    default:
      return;
  }
}

/**
 * The check that matters, applied to every single input event rather than once
 * at the grant: the sender has to be the one person control was given to, and
 * the screen has to still be being shared. A grant that outlived its share
 * would be a way to keep driving a machine nobody is watching.
 */
function mayDrive(identity: string, get: () => ShareControlState): boolean {
  return get().controller?.identity === identity && sharedDisplayId() !== null;
}

/**
 * Which display this client is sharing, or null when it is sharing a window or
 * nothing at all.
 */
function sharedDisplayId(): string | null {
  const { screenEnabled, sharedDisplayId: displayId } = useVoiceStore.getState();
  return screenEnabled ? displayId : null;
}

function whyControlIsImpossible(): string | null {
  const { screenEnabled, sharedDisplayId: displayId } = useVoiceStore.getState();
  if (!screenEnabled) return 'they are not sharing a screen';
  if (!displayId) return 'a window is being shared, not a whole screen';
  if (window.nexora?.platform !== 'win32') return 'control is not supported on that machine';
  return null;
}
