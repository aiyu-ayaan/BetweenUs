/**
 * What a voice roster's remaining lifetime means.
 *
 * Redis answers `PTTL` with three different kinds of thing and only one of them
 * is a duration, so the reading is written out here rather than as three magic
 * numbers inside a loop - and checked, because getting -1 and -2 the wrong way
 * round deletes every live call instead of every dead one.
 */
export type VoiceLifetime =
  /** The key is gone: nothing refreshed it, so nobody is in that call. */
  | 'gone'
  /** No expiry at all - a roster written before rosters had one. */
  | 'adopt'
  /** Counting down, and being refreshed. Leave it alone. */
  | 'live';

export function voiceLifetime(pttlMs: number): VoiceLifetime {
  if (pttlMs === -2) return 'gone';
  if (pttlMs === -1) return 'adopt';
  return 'live';
}
