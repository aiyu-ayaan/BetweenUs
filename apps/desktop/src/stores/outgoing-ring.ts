/**
 * What became of the ring *you* sent.
 *
 * The other half of `ring.ts`, which is somebody ringing you. A caller used to
 * be told nothing, so a call to somebody who had said no looked exactly like a
 * call to a phone that was off, and they sat in an empty call unable to tell
 * which. The server now says: ringing, declined, unanswered, answered.
 *
 * One at a time, and only while the call it was sent for is the one this window
 * is in. Answered clears itself - the person is in the call, and the call says
 * so better than a line of text could.
 */
import { create } from 'zustand';
import type { CallRingState } from '@betweenus/shared-types';
import type { VisibleRingState } from '../features/voice/ring-status';
import { useVoiceStore } from './voice';

export interface OutgoingRing {
  channelId: string;
  targetId: string;
  targetName: string;
  state: VisibleRingState;
}

interface OutgoingRingStore {
  ring: OutgoingRing | null;
  apply: (event: {
    channelId: string;
    targetId: string;
    targetName: string;
    state: CallRingState;
  }) => void;
  clear: () => void;
}

export const useOutgoingRingStore = create<OutgoingRingStore>((set, get) => ({
  ring: null,

  apply: (event) => {
    // Somebody else's ring from another of this account's windows is still this
    // account's ring - but it is only worth a line in the call it was sent for.
    const voice = useVoiceStore.getState();
    if (voice.status === 'idle' || voice.channelId !== event.channelId) return;

    if (event.state === 'answered') {
      if (get().ring?.targetId === event.targetId) set({ ring: null });
      return;
    }
    set({
      ring: {
        channelId: event.channelId,
        targetId: event.targetId,
        targetName: event.targetName,
        state: event.state,
      },
    });
  },

  clear: () => set({ ring: null }),
}));

// A ring belongs to the call it was sent for. Leaving it - or the call ending -
// takes the line with it, so it cannot greet the next call.
useVoiceStore.subscribe((state, previous) => {
  if (state.status === 'idle' && previous.status !== 'idle') {
    useOutgoingRingStore.getState().clear();
  }
});
