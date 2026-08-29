/**
 * When to try a broken link again, and when to stop trying.
 *
 * The web and Electron clients had none of this: one `restartIce()` the moment
 * ICE said `failed`, and then the peer was dropped out of the mesh for good.
 * Nothing re-adds a link, so a single bad moment on either end - a wifi
 * handover, a laptop lid, a candidate pair that lost a race - ended that pair
 * for the rest of the call, and the only cure was leaving and rejoining. That
 * is the "have to drop and join a few times" everybody was doing.
 *
 * Android already had a policy for exactly this, in `CallRecovery.kt`, and this
 * is that policy in TypeScript. It is deliberately a straight port rather than
 * a second opinion: two clients that disagree about how long to wait before an
 * ICE restart are two clients that restart on top of each other, and a
 * renegotiation racing another renegotiation is worse than either alone. Every
 * number here is a trade between two failures that both look like a bug: giving
 * up on a link that would have come back, and pretending for a minute that a
 * call is still alive when it is not.
 *
 * Pure, so it can be reasoned about - and checked - without a call. See
 * `call-recovery.check.ts`.
 */

/**
 * How long a `disconnected` link is left alone before anything is done.
 *
 * ICE recovers by itself surprisingly often - a lost packet or two on a
 * handover puts a connection here and it climbs out unaided within a couple of
 * seconds. Restarting immediately would throw away a link that was about to be
 * fine, and an ICE restart is not free: it is a renegotiation, and on a bad
 * network it is a renegotiation over the network that is bad.
 */
export const GRACE_MS = 4_000;

/** How many ICE restarts one link gets before it is declared lost. */
export const MAX_ATTEMPTS = 4;

/**
 * The longest a link may spend not carrying media before it is given up on,
 * whatever the attempt count says.
 *
 * Half a minute of a frozen tile is already longer than anybody waits before
 * saying "I think you've frozen" - past that it is kinder to say so than to
 * keep a hopeful spinner up.
 */
export const DEADLINE_MS = 30_000;

/**
 * How long the whole call survives with no signalling.
 *
 * Longer than one link's deadline on purpose: the socket reconnects itself and
 * rejoins, and a train tunnel is a real thing that ends. But a call whose
 * switchboard has been unreachable for this long is a call nobody else can see
 * this device in - the roster dropped it long ago - so keeping the microphone
 * open is a lie told to its owner.
 */
export const SIGNALLING_DEADLINE_MS = 45_000;

/**
 * Which side restarts ICE.
 *
 * The impolite one, and only it. An ICE restart has to become an offer to do
 * anything at all, and only the impolite side offers unprompted - that is the
 * whole of the perfect-negotiation rule this call already follows. The polite
 * side calling `restartIce()` marks its connection as wanting a renegotiation
 * that the impolite side will discard as glare, which looks like a recovery
 * attempt in a log and is not one.
 *
 * So the polite side waits. If the impolite side is alive it will offer; if it
 * is not, the roster is what says so.
 */
export function restarts(polite: boolean): boolean {
  return !polite;
}

/**
 * How long to wait before attempt `attempt`, counting from one.
 *
 * Backed off, because the reason the first restart failed is usually that the
 * network is still bad, and four restarts inside a second is four
 * renegotiations that all fail together. Capped so the last attempt still
 * happens inside `DEADLINE_MS`.
 */
export function backoffMs(attempt: number): number {
  if (attempt <= 1) return 0;
  if (attempt === 2) return 2_000;
  if (attempt === 3) return 4_000;
  return 8_000;
}

/**
 * Whether a link that has been down for `downForMs` across `attempts` restarts
 * should be given up on.
 *
 * Either bound is enough. The attempt count catches a link that is failing fast
 * and repeatedly; the deadline catches one that is failing slowly, or that
 * never reports a failure at all and simply sits in `disconnected`.
 */
export function spent(attempts: number, downForMs: number): boolean {
  return attempts >= MAX_ATTEMPTS || downForMs >= DEADLINE_MS;
}

/**
 * How long to wait before the nth attempt at reopening the signalling socket.
 *
 * The gateway holds a departed peer's seat for a grace window (see
 * `resumeHeldSeat` in `call.gateway.ts`), so a socket that comes back quickly
 * rejoins the call it was already in and nobody else is told anything happened.
 * That window is the thing worth racing, which is why the first retry is
 * immediate; after that it backs off, because a server that refused once will
 * usually refuse again a second later.
 *
 * Capped below `SIGNALLING_DEADLINE_MS` so the last attempt lands inside it.
 */
export function signallingBackoffMs(attempt: number): number {
  if (attempt <= 1) return 0;
  return Math.min(1_000 * 2 ** (attempt - 2), 8_000);
}
