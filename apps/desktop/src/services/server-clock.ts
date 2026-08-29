/**
 * What time the *server* thinks it is, and what to do when this machine
 * disagrees.
 *
 * A device clock belongs to whoever holds the device. It drifts on its own, it
 * is wrong outright on a machine that woke from sleep or lost its battery, and
 * it can be set to any value at all by the person using it - which is the part
 * that matters. Anything that expires (a one-time message, an invite, a grant,
 * a session) must therefore be decided by a clock that person does not own:
 *
 * - **Enforcement is the server's, always.** Nothing a client believes about
 *   the time is allowed to grant access to anything. The services already work
 *   this way - `resolveRemoteAccess` compares a grant's `expiresAt` to the
 *   database's own clock, refresh tokens and password resets to the auth
 *   service's - and any expiry added later belongs there too, not here. Winding
 *   a phone forward or back must not change what the server hands over.
 * - **What a client shows is the server's clock too.** That is what this is
 *   for: a countdown, an "Expired" label, a "Today" divider on yesterday's
 *   messages. A wrong device clock cannot open anything, but it can quietly
 *   lie to the person reading, and a chat that says a message arrived tomorrow
 *   reads as broken software rather than as a wrong clock.
 *
 * The offset is learned for free. Every HTTP response carries a `Date` header,
 * so `services/api.ts` hands one sample per request to `sampleServerClock` and
 * the estimate is NTP's: the server stamped that header somewhere between the
 * request leaving and the response arriving, so the midpoint of the round trip
 * is the best guess available, and the least-delayed sample is the one to
 * believe. `listen-sync.ts` already worked this out for keeping two players in
 * step, and `offsetOf`/`bestOffset` are that arithmetic - the same rule against
 * a different measurement, so it is imported rather than written twice.
 *
 * Android's `ServerClock.kt` is this file, case for case.
 */
import { create } from 'zustand';
import { bestOffset, type ClockSample } from './listen-sync';

/**
 * How wrong a device clock has to be before the person is told.
 *
 * Five minutes. Below it nothing on screen is misleading - a bubble a few
 * seconds out is still under the right day, and a countdown is still honest to
 * the minute - and a message about it would be noise on every laptop with a
 * lazy NTP daemon. Above it, the day dividers start naming the wrong day and
 * anything with a deadline reads wrongly, which is worth one line at the top of
 * the window.
 */
export const CLOCK_WARNING_MS = 5 * 60 * 1000;

/** How many measurements are kept when picking the least-delayed one. */
export const CLOCK_SAMPLES = 8;

interface ServerClockState {
  /** Server time minus device time, in milliseconds. Zero until measured. */
  offsetMs: number;
  samples: ClockSample[];
  sample: (sample: ClockSample) => void;
  reset: () => void;
}

export const useServerClock = create<ServerClockState>((set, get) => ({
  offsetMs: 0,
  samples: [],
  sample: (sample) => {
    const samples = [...get().samples, sample].slice(-CLOCK_SAMPLES);
    set({ samples, offsetMs: bestOffset(samples) });
  },
  reset: () => set({ samples: [], offsetMs: 0 }),
}));

/**
 * One measurement, from a response that has already arrived.
 *
 * `Date` is written to the second, so an offset read from it is quantised to
 * about half a second. That is uselessly coarse for lining up two music players
 * and entirely sufficient here, where the question is whether a clock is out by
 * minutes.
 */
export function sampleServerClock(sentAtMs: number, receivedAtMs: number, header: string | null): void {
  if (!header) return;
  const serverMs = Date.parse(header);
  if (Number.isNaN(serverMs)) return;
  useServerClock.getState().sample({ sentAtMs, receivedAtMs, serverMs });
}

/** The server's clock, as best this machine can tell. Never used to *decide*. */
export function serverNow(): number {
  return Date.now() + useServerClock.getState().offsetMs;
}

/** How far this machine's clock is from the server's; positive means ahead. */
export function deviceSkewMs(): number {
  return -useServerClock.getState().offsetMs;
}

/** Whether the device clock is wrong enough to say so. */
export function clockIsWrong(offsetMs: number): boolean {
  return Math.abs(offsetMs) >= CLOCK_WARNING_MS;
}

/** The wording for a clock that is out: which way, and roughly how far. */
export function skewWording(offsetMs: number): string {
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  const amount =
    minutes >= 2880
      ? `${Math.round(minutes / 1440)} days`
      : minutes >= 120
        ? `${Math.round(minutes / 60)} hours`
        : `${minutes} minutes`;
  const direction = offsetMs < 0 ? 'ahead of' : 'behind';
  return `This device's clock is about ${amount} ${direction} the server's. Times and dates on messages will look wrong until it is corrected.`;
}
