/**
 * Away-from-keyboard, decided by the client.
 *
 * A status was only ever what somebody picked, so "online" meant "signed in at
 * some point today" and the dot said nothing. Every other chat app answers this
 * the same way: after a while with no input, the person is idle, and the moment
 * they touch anything they are not.
 *
 * The decision is a pure function and the plumbing around it is deliberately
 * dull, because the two ways of getting it wrong are both quiet - a status that
 * never comes back from idle, and a chosen status that the client overwrites.
 */
import type { ActiveStatus } from '@betweenus/shared-types';

/**
 * Ten minutes, which is what Discord and Slack use. Long enough that reading a
 * long message does not make you disappear, short enough to mean something.
 */
export const IDLE_AFTER_SECONDS = 600;

/** How often the idle source is asked. A poll is cheap; an event does not exist. */
const POLL_MS = 30_000;

/** A browser tab counts these as somebody being there. */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
  'focus',
] as const;

/**
 * What to report, given what the person chose and how long the machine has been
 * untouched.
 *
 * Only `online` is ever changed automatically. Someone who picked do-not-disturb
 * or invisible said something deliberate about how they want to appear, and an
 * idle timer is not entitled to an opinion about it - which is also why idle
 * cannot be "corrected" back to online for them.
 *
 * Being in a call counts as being there whatever the keyboard says: listening
 * to somebody talk for twenty minutes is the most present a person gets, and
 * going idle in the middle of it is the bug every version of this feature
 * ships with first.
 */
export function autoStatus(
  chosen: ActiveStatus,
  idleSeconds: number,
  inCall: boolean,
  threshold: number = IDLE_AFTER_SECONDS,
): ActiveStatus {
  if (chosen !== 'online') return chosen;
  if (inCall) return 'online';
  return idleSeconds >= threshold ? 'idle' : 'online';
}

/**
 * Seconds since this machine was last touched.
 *
 * The desktop asks the operating system, which is the only source that knows
 * about the window the person is actually working in. A browser tab has no
 * such thing and falls back to its own events, which is weaker in one specific
 * way - a tab left open while its user works in another *application* looks
 * idle - and that is the honest answer a tab can give.
 */
export function createIdleSource(): { seconds: () => Promise<number>; stop: () => void } {
  const bridge = window.betweenus;
  if (bridge?.systemIdleSeconds) {
    return { seconds: () => bridge.systemIdleSeconds().catch(() => 0), stop: () => undefined };
  }

  let lastActivity = Date.now();
  const touched = (): void => {
    lastActivity = Date.now();
  };
  const visibility = (): void => {
    if (document.visibilityState === 'visible') touched();
  };

  for (const name of ACTIVITY_EVENTS) {
    window.addEventListener(name, touched, { passive: true });
  }
  document.addEventListener('visibilitychange', visibility);

  return {
    seconds: () => Promise.resolve(Math.floor((Date.now() - lastActivity) / 1000)),
    stop: () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touched);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}

let timer: number | null = null;
let source: ReturnType<typeof createIdleSource> | null = null;

/**
 * Starts watching, and keeps watching until `stopIdleWatch`. Safe to call twice;
 * the second call is a no-op rather than a second timer.
 *
 * `report` is handed the status to appear as, every poll. It is the store's job
 * to notice that nothing changed and send nothing, so that this stays a
 * function about time and not about sockets.
 */
export function startIdleWatch(
  report: (status: ActiveStatus) => void,
  chosen: () => ActiveStatus,
  inCall: () => boolean,
): void {
  if (timer !== null) return;
  source = createIdleSource();

  const tick = (): void => {
    void source?.seconds().then((seconds) => {
      report(autoStatus(chosen(), seconds, inCall()));
    });
  };

  timer = window.setInterval(tick, POLL_MS);
  tick();
}

export function stopIdleWatch(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  source?.stop();
  source = null;
}
