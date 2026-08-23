/**
 * Somebody is ringing you into a call.
 *
 * A voice channel is a room you wander into. A ring is somebody standing at
 * the door of it with your name - and that difference is the whole reason this
 * store exists rather than another line in the roster: it interrupts, it makes
 * a sound, and it waits for an answer.
 *
 * Two ways in, for the same reason there are two on the phone. The presence
 * socket carries it to a client that is running, which is the one somebody is
 * most likely sitting in front of; the service worker carries it to a tab that
 * is not. Both land here, and landing twice is not two rings - see `show`.
 *
 * What it never does is join anything on its own. Answering opens a
 * microphone, and only a person may do that.
 */
import { create } from 'zustand';
import { startRinging, stopRinging } from '../services/call-tones';
import { notifyRing } from '../services/notifications';
import { useChatStore } from './chat';
import { useVoiceStore } from './voice';

export interface Ring {
  channelId: string;
  channelName: string;
  callerId: string;
  callerName: string;
  callerAvatarUrl?: string;
}

/**
 * How long it rings before it gives up, in milliseconds.
 *
 * The same 45 seconds the phone rings for, so a call that stopped ringing on
 * one device has stopped ringing on all of them. A ringer with no timeout is a
 * modal somebody comes back to an hour later and answers a call that ended.
 */
export const RING_TIMEOUT_MS = 45_000;

interface RingState {
  /** The one being shown, or null. One at a time: this is a modal, not a list. */
  incoming: Ring | null;
  show: (ring: Ring) => void;
  /** Joins the call. The only path that opens a microphone. */
  answer: () => void;
  /** Said no, or it rang out. Nothing is sent back - a ring is not a handshake. */
  dismiss: () => void;
}

let timeout: number | null = null;

function clearTimer(): void {
  if (timeout !== null) window.clearTimeout(timeout);
  timeout = null;
}

export const useRingStore = create<RingState>((set, get) => ({
  incoming: null,

  show: (ring) => {
    // Already in that call. The person ringing cannot see the roster the
    // instant they press the button, so this is a normal thing to receive
    // rather than a mistake - and a ringer over a call you are already in is a
    // way to be hung up on by accident.
    const voice = useVoiceStore.getState();
    if (voice.channelId === ring.channelId && voice.status !== 'idle') return;

    // The same ring by both roads: the socket delivered it and the service
    // worker handed the push over as well. One ring.
    if (get().incoming?.channelId === ring.channelId) return;

    clearTimer();
    set({ incoming: ring });
    startRinging();
    notifyRing(ring.channelId, ring.channelName, ring.callerName);
    timeout = window.setTimeout(() => get().dismiss(), RING_TIMEOUT_MS);
  },

  answer: () => {
    const ring = get().incoming;
    clearTimer();
    stopRinging();
    set({ incoming: null });
    if (!ring) return;

    // The channel is opened as well as joined, so answering lands somewhere
    // that shows the call rather than joining it invisibly behind whatever was
    // already on screen.
    void useChatStore.getState().selectChannel(ring.channelId);
    void useVoiceStore.getState().join(ring.channelId);
  },

  dismiss: () => {
    clearTimer();
    stopRinging();
    set({ incoming: null });
  },
}));

/**
 * Answering a call that arrived some other way silences the ringer.
 *
 * Without this, joining the channel from the sidebar while it is ringing
 * leaves the ringtone playing over the call somebody has just walked into.
 */
useVoiceStore.subscribe((state, previous) => {
  if (state.channelId === previous.channelId) return;
  const ringing = useRingStore.getState().incoming;
  if (ringing && state.channelId === ringing.channelId) useRingStore.getState().dismiss();
});
