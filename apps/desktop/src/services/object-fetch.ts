/**
 * The queue in front of every stored-object fetch.
 *
 * The gateway rate-limits `/api/v1/uploads` to the `api` zone - 20r/s with a
 * burst of 20, per address (infrastructure/nginx/nginx.conf) - and a channel
 * full of photo albums asks for every tile the moment it renders. Thirty
 * parallel GETs from one machine means the overflow comes back 503, and the
 * client turned each of those into "this file could not be opened" and left it
 * there for the life of the row. That is what a grid with file icons scattered
 * among the photos was, and what a moment that never loaded was too: not a
 * broken picture, a refused request nobody asked again for.
 *
 * So: a queue rather than a stampede, and a retry rather than a verdict. Lives
 * in its own module because the arithmetic below is worth a check, and because
 * the phone has the same queue in `BetweenUsApi.fetchObject` for the same
 * reason - the two have to stay recognisably the same shape.
 */

/**
 * How many objects may be in flight at once.
 *
 * Four keeps a fast connection busy and stays well inside the burst even with
 * a second window open on the same address.
 */
export const OBJECT_CONCURRENCY = 4;

/** How many times a refused fetch is asked again before it is a failure. */
export const OBJECT_RETRIES = 3;

/** Refusals worth asking again about: a full queue, not a missing file. */
export const OBJECT_RETRY_STATUSES = new Set([429, 502, 503, 504]);

/** Whether this reply is the gateway saying "not now" rather than "no". */
export function worthRetrying(status: number, attempt: number): boolean {
  return attempt < OBJECT_RETRIES && OBJECT_RETRY_STATUSES.has(status);
}

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * Doubling, so the third try is on the far side of the gateway's window rather
 * than inside the same one. The jitter matters as much as the backoff: without
 * it a screenful of tiles retries in lockstep and rebuilds the very burst that
 * refused them.
 */
export function retryDelayMs(attempt: number, jitter = Math.random()): number {
  return 250 * 2 ** attempt + jitter * 250;
}

let inFlight = 0;
const waiting: Array<() => void> = [];

/** Runs `job` holding one of the [OBJECT_CONCURRENCY] slots. */
export async function objectSlot<T>(job: () => Promise<T>): Promise<T> {
  if (inFlight >= OBJECT_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight += 1;
  try {
    return await job();
  } finally {
    inFlight -= 1;
    // Released whatever the job did, including throwing: a slot a failed fetch
    // kept is a slot nothing gets back, and four of those is a chat that never
    // loads another picture.
    waiting.shift()?.();
  }
}

/** How many jobs are running right now. For the check, and for nothing else. */
export function objectsInFlight(): number {
  return inFlight;
}
