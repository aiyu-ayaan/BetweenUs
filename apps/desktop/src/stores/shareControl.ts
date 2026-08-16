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
 * So the whole exchange rides the peers' own data channels, directly between
 * the two clients, and the only authority is the person sharing clicking yes.
 * That is the right authority: it is their machine, they are sitting at it, and
 * they can see what is being done with it. Nothing here can start without them,
 * and one click ends it.
 *
 * What keeps it honest:
 *
 * - A data channel has exactly two ends. A message on the connection to a peer
 *   came from that peer and from nobody else - there is no server in between
 *   that could have written it, and the peer's identity came from the roster
 *   `call-service` built from authenticated sockets.
 * - Input is applied only from the one identity control was granted to, only
 *   while a screen is still being shared, and only when that share is a whole
 *   display - a window can be dragged between monitors, so there is no fraction
 *   of a screen to map a click onto, and control of one is refused.
 * - Control ends when the share ends, when the call does, when that person
 *   leaves, when either side presses the button, and when the person driving
 *   presses Escape.
 *
 * Pointers are the other half. Several people watch a share and any of them may
 * be pointing at something; each sends where their cursor is over the picture,
 * everyone draws everyone else's with a name on it, and a pointer that goes
 * quiet disappears. Only one person can drive, but everybody can point.
 */
import { create } from 'zustand';
import type { CallPeer } from '@nexora/shared-types';
import type { Mesh } from '../services/mesh';
// Circular by design and safe: the voice store attaches this one, and this one
// only reads it from inside a function, long after both modules have loaded.
import { useVoiceStore } from './voice';

/**
 * Mouse moves are sampled; the far end does not need 500 events a second.
 *
 * ponytail: one reliable, ordered data channel carries pointers, mouse moves
 * and grants alike, where the SFU build could mark the cosmetic ones lossy. At
 * these rates it does not matter; a second unordered channel is the fix if a
 * bad link ever makes pointers lag behind the picture.
 */
const MOVE_INTERVAL_MS = 25;
/** Pointers are cosmetic, so they are sent less often. */
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
  | { k: 'key'; a: 'down' | 'up'; key: string; code: string; mods?: string[] }
  | { k: 'p'; x: number; y: number }
  | { k: 'p.off' };

/** What actually crosses the channel, so a stray message is easy to ignore. */
interface Envelope {
  topic: string;
  message: Wire;
}

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

  /** Called by the voice store when a call comes and goes. */
  attach: (mesh: Mesh) => void;
  detach: () => void;
  /** Called by the voice store for every data-channel message. */
  receive: (from: CallPeer, payload: unknown) => void;
  /** Called by the voice store when the roster changes. */
  peersChanged: (peers: CallPeer[]) => void;

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
  /** `modifiers` is what was held at the moment of the press - see keyboard.ts. */
  sendKey: (action: 'down' | 'up', key: string, code: string, modifiers?: string[]) => void;
}

let mesh: Mesh | null = null;
let lastMoveAt = 0;
let lastPointerAt = 0;
let sweeper: number | null = null;
/** Who this client asked, so an unsolicited "yes" from anyone else is ignored. */
let asked: string | null = null;

function publish(message: Wire, to?: string[]): void {
  mesh?.sendData({ topic: TOPIC, message } satisfies Envelope, to);
}

export const useShareControlStore = create<ShareControlState>((set, get) => ({
  requests: [],
  controller: null,
  asking: false,
  driving: null,
  refusal: null,
  pointers: {},

  attach: (next) => {
    get().detach();
    mesh = next;

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
    mesh = null;
    asked = null;
    window.nexora?.remoteTarget(null, 'call');
    set({
      requests: [],
      controller: null,
      asking: false,
      driving: null,
      refusal: null,
      pointers: {},
    });
  },

  receive: (from, payload) => {
    const envelope = payload as Envelope | null;
    if (!envelope || envelope.topic !== TOPIC || !envelope.message) return;
    onMessage(envelope.message, from, set, get);
  },

  // Somebody who leaves cannot still be driving, and their cursor should not be
  // left on screen.
  peersChanged: (peers) => {
    const present = new Set(peers.map((peer) => peer.peerId));

    set((state) => {
      const pointers = Object.fromEntries(
        Object.entries(state.pointers).filter(([identity]) => present.has(identity)),
      );
      const controllerGone = state.controller !== null && !present.has(state.controller.identity);
      const drivenGone = state.driving !== null && !present.has(state.driving);

      return {
        pointers,
        requests: state.requests.filter((person) => present.has(person.identity)),
        controller: controllerGone ? null : state.controller,
        driving: drivenGone ? null : state.driving,
        asking: drivenGone ? false : state.asking,
      };
    });

    if (get().controller === null) window.nexora?.remoteTarget(null, 'call');
  },

  ask: (sharer) => {
    asked = sharer.identity;
    set({ asking: true, refusal: null, driving: null });
    publish({ k: 'ask' }, [sharer.identity]);
  },

  answer: (identity, granted) => {
    const request = get().requests.find((person) => person.identity === identity);
    set((state) => ({ requests: state.requests.filter((person) => person.identity !== identity) }));
    if (!request) return;

    if (!granted) {
      publish({ k: 'deny', why: 'declined' }, [identity]);
      return;
    }

    // The share can have stopped between the ask and the answer, and granting
    // control of a screen nobody is sending would be a grant with no picture
    // over it - the one situation where somebody is driving blind.
    const refusal = whyControlIsImpossible();
    if (refusal) {
      publish({ k: 'deny', why: refusal }, [identity]);
      return;
    }

    // Whatever was being controlled before is not any more: one driver.
    const previous = get().controller;
    if (previous && previous.identity !== identity) {
      publish({ k: 'revoke' }, [previous.identity]);
    }

    // Input arrives as a fraction of the shared display, so the main process
    // has to be told which display that is before the first event lands. Under
    // `call`, which is its own target: a machine can be in a remote session at
    // the same time, watching a different monitor, and the two must not
    // overwrite each other.
    window.nexora?.remoteTarget(sharedDisplayId(), 'call');
    set({ controller: request });
    publish({ k: 'grant' }, [identity]);
  },

  stop: () => {
    const { controller, driving } = get();
    if (controller) {
      publish({ k: 'revoke' }, [controller.identity]);
      window.nexora?.remoteTarget(null, 'call');
      set({ controller: null });
    }
    if (driving) {
      publish({ k: 'revoke' }, [driving]);
      asked = null;
      set({ driving: null, asking: false });
    }
  },

  sendPointer: (x, y) => {
    const now = Date.now();
    if (now - lastPointerAt < POINTER_INTERVAL_MS) return;
    lastPointerAt = now;
    publish({ k: 'p', x, y });
  },

  clearPointer: () => publish({ k: 'p.off' }),

  sendMouse: (action, x, y, button, deltaY) => {
    const target = get().driving;
    if (!target) return;
    if (action === 'move') {
      const now = Date.now();
      if (now - lastMoveAt < MOVE_INTERVAL_MS) return;
      lastMoveAt = now;
    }
    publish({ k: 'm', a: action, x, y, b: button, d: deltaY }, [target]);
  },

  sendKey: (action, key, code, modifiers) => {
    const target = get().driving;
    if (!target) return;
    publish({ k: 'key', a: action, key, code, mods: modifiers }, [target]);
  },
}));

type Setter = (
  partial:
    | Partial<ShareControlState>
    | ((state: ShareControlState) => Partial<ShareControlState>),
) => void;

function onMessage(
  message: Wire,
  from: CallPeer,
  set: Setter,
  get: () => ShareControlState,
): void {
  const identity = from.peerId;
  const name = from.username || from.peerId;

  switch (message.k) {
    case 'p':
      set((state) => ({
        pointers: {
          ...state.pointers,
          [identity]: { identity, name, x: message.x, y: message.y, at: Date.now() },
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
        publish({ k: 'deny', why: refusal }, [identity]);
        return;
      }
      set((state) =>
        state.requests.some((person) => person.identity === identity)
          ? {}
          : { requests: [...state.requests, { identity, name }] },
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
        window.nexora?.remoteTarget(null, 'call');
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
        source: 'call',
      });
      return;
    }

    case 'key': {
      if (!mayDrive(identity, get)) return;
      window.nexora?.remoteKey({
        action: message.a,
        key: message.key,
        code: message.code,
        modifiers: message.mods,
        source: 'call',
      });
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
