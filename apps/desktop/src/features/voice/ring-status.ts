/**
 * What the person who rang is told about their ring.
 *
 * Pure so the words are pinned: this line is the only thing between a caller and
 * an empty call they cannot tell from a phone that was switched off.
 */
import type { CallRingState } from '@betweenus/shared-types';

/** `answered` has no words: the person is in the call, and the call says so. */
export type VisibleRingState = Exclude<CallRingState, 'answered'>;

export function ringStatusText(state: VisibleRingState, name: string): string {
  const who = name.trim() || 'They';
  switch (state) {
    case 'ringing':
      return `Ringing ${who}…`;
    case 'declined':
      return `${who} declined the call`;
    case 'unanswered':
      return `${who} didn't answer`;
  }
}

/** Whether ringing again is something to offer: the ring is over and nobody came. */
export function canRingAgain(state: VisibleRingState): boolean {
  return state !== 'ringing';
}
