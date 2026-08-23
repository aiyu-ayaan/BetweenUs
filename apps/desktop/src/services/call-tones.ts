/**
 * The two notes that say somebody arrived, and the two that say they left.
 *
 * A voice channel with no sound of its own is one where you have to be looking
 * at the tile list to know who is in it - which is exactly when nobody is
 * looking at it, because the whole point of a voice channel is that the window
 * is behind something else. Discord answers this with a short rising chirp on
 * join and a falling one on leave, and the direction is the entire message: you
 * do not have to learn what the sound means to know which way it went.
 *
 * Synthesised rather than shipped. Two sine notes with a soft envelope is what
 * the file would have contained, an oscillator is ten lines, and this way there
 * is no asset to bundle, no fetch to fail, and nothing that can go missing from
 * an Electron package. It also means the tone can be built at the volume and
 * pitch chosen here rather than at whatever a downloaded file was mastered to.
 *
 * The envelope matters more than the notes. A sine that starts and stops
 * abruptly is a click at each end - the discontinuity is a broadband transient,
 * which is a worse sound than the tone itself - so every note fades in and out
 * over a few milliseconds.
 */

/** What happened, and therefore which way the two notes go. */
export type CallTone = 'join' | 'leave';

/**
 * A perfect fourth, up or down. Not a chord and not a tune: two notes far
 * enough apart to be told apart through a game, a film, or a laptop speaker,
 * and low enough not to be shrill on a headset.
 */
const NOTES: Record<CallTone, [number, number]> = {
  // Up: somebody is here.
  join: [523.25, 698.46],
  // Down: somebody is gone. The same two notes the other way round, so the pair
  // is recognisably one pair rather than two unrelated sounds.
  leave: [698.46, 523.25],
};

/** Seconds. Long enough to have a pitch, short enough not to be a ringtone. */
const NOTE_SECONDS = 0.09;
/** The fade at each end of a note, which is what stops it clicking. */
const FADE_SECONDS = 0.012;
/** Quiet on purpose: this plays over a conversation, not instead of one. */
const PEAK_GAIN = 0.14;

/**
 * One context for the life of the window, created on the first tone rather than
 * at import. A browser refuses to start an AudioContext before the page has been
 * interacted with, and one created too early is stuck suspended.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  // Suspended is the normal state after a tab has been in the background.
  void context.resume().catch(() => undefined);
  return context;
}

/**
 * Sends the tones to a chosen output device.
 *
 * Called when the setting changes, and ignored where the runtime has no
 * `setSinkId` on a context - in which case the tone plays on the system default,
 * which is the same place it played before this existed.
 */
export function setToneOutput(deviceId: string | null): void {
  const target = context as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
  if (!target?.setSinkId) return;
  void target.setSinkId(deviceId ?? '').catch(() => undefined);
}

/**
 * Plays one of the two tones. Never throws and never awaits: a call is not
 * worth failing over a sound, and nothing downstream cares when it finishes.
 */
export function playCallTone(tone: CallTone): void {
  const ctx = audio();
  if (!ctx) return;

  try {
    const [first, second] = NOTES[tone];
    // The second note starts where the first ends - overlapping them would beat
    // against each other, and a gap would make it two sounds rather than one.
    note(ctx, first, ctx.currentTime);
    note(ctx, second, ctx.currentTime + NOTE_SECONDS);
  } catch {
    // A context that was closed, a device that went away mid-call: silence is
    // the correct failure here.
  }
}

// --- The ringtone -----------------------------------------------------------

/**
 * A ring is a different sound from a tone, and not because it is louder.
 *
 * The join and leave tones are told after the fact: they say something has
 * happened, once, and then stop. A ring is a question - somebody is waiting
 * for an answer - so it has to repeat until it is answered or given up on, and
 * it has to be audible from another room, which is the whole reason anybody
 * rings anybody.
 *
 * The same two-note shape as a join, an octave of separation, three times per
 * burst, and a burst every few seconds. It stays synthesised for the same
 * reasons the tones are: nothing to bundle, nothing to fetch, nothing to go
 * missing from an Electron package.
 */
const RING_NOTES = [880, 1174.66] as const;
/** Seconds between the start of one burst and the next. A telephone's cadence. */
const RING_PERIOD_SECONDS = 3;
const RING_NOTE_SECONDS = 0.18;
/** Louder than a join tone. This one has to carry across a room. */
const RING_GAIN = 0.3;

let ringTimer: number | null = null;

/**
 * Starts ringing, and keeps ringing until [stopRinging].
 *
 * Idempotent: a second ring arriving while one is already sounding is one
 * ringtone, not two overlapping ones an octave apart.
 */
export function startRinging(): void {
  if (ringTimer !== null) return;

  const burst = (): void => {
    const ctx = audio();
    if (!ctx) return;
    try {
      // Three rises, then silence until the next burst. A continuous tone is
      // an alarm; the gap is what makes this a telephone.
      for (let index = 0; index < 3; index += 1) {
        const at = ctx.currentTime + index * RING_NOTE_SECONDS * 2;
        note(ctx, RING_NOTES[0], at, RING_NOTE_SECONDS, RING_GAIN);
        note(ctx, RING_NOTES[1], at + RING_NOTE_SECONDS, RING_NOTE_SECONDS, RING_GAIN);
      }
    } catch {
      // A closed context or a device that went away: silence is the correct
      // failure, exactly as it is for the tones.
    }
  };

  burst();
  ringTimer = window.setInterval(burst, RING_PERIOD_SECONDS * 1000);
}

/** Answered, declined, or given up on. Safe to call when nothing is ringing. */
export function stopRinging(): void {
  if (ringTimer !== null) window.clearInterval(ringTimer);
  ringTimer = null;
}

function note(
  ctx: AudioContext,
  frequency: number,
  at: number,
  seconds: number = NOTE_SECONDS,
  peak: number = PEAK_GAIN,
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, at);

  // Ramped rather than set: see the note about clicks at the top.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + FADE_SECONDS);
  gain.gain.setValueAtTime(peak, at + seconds - FADE_SECONDS);
  gain.gain.linearRampToValueAtTime(0, at + seconds);

  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + seconds);
  // Nodes are one-shot; letting them go is what keeps a long call from
  // accumulating one oscillator per arrival.
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

/**
 * Who arrived and who left, between two rosters.
 *
 * Pulled out of the store because it is the part that can be wrong in a way
 * nobody hears until there are three people in a call: a roster is a whole list
 * on every change, so "somebody joined" is a set difference and not an event.
 * One tone per change, not one per person - four people arriving together is an
 * arrival, not a fanfare.
 */
export function rosterChange(
  before: readonly string[],
  after: readonly string[],
): { joined: boolean; left: boolean } {
  const was = new Set(before);
  const is = new Set(after);
  return {
    joined: after.some((id) => !was.has(id)),
    left: before.some((id) => !is.has(id)),
  };
}
