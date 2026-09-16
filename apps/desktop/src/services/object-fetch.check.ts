/**
 * The object-fetch queue, checked.
 *
 * The bug this guards is not subtle once it is out: a slot that a failed fetch
 * keeps is a slot nothing gets back, and four of those is a channel that never
 * loads another picture for as long as the window is open.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import {
  OBJECT_CONCURRENCY,
  OBJECT_RETRIES,
  objectSlot,
  objectsInFlight,
  retryDelayMs,
  worthRetrying,
} from './object-fetch';

// --- What is worth asking again ---------------------------------------------

// The gateway's "not now".
assert.equal(worthRetrying(503, 0), true);
assert.equal(worthRetrying(429, 0), true);
// A file that is gone, or one this account may not have: asking again is rude
// and the answer will not change.
assert.equal(worthRetrying(404, 0), false);
assert.equal(worthRetrying(403, 0), false);
assert.equal(worthRetrying(401, 0), false);
// Even a 503 stops being worth asking about eventually.
assert.equal(worthRetrying(503, OBJECT_RETRIES), false);

// --- The backoff ------------------------------------------------------------

// Doubling, so the last try is well clear of the window that refused the first.
assert.equal(retryDelayMs(0, 0), 250);
assert.equal(retryDelayMs(1, 0), 500);
assert.equal(retryDelayMs(2, 0), 1000);
// The jitter only ever adds, so a retry never lands sooner than the backoff.
assert.equal(retryDelayMs(0, 1), 500);
assert.ok(retryDelayMs(0, 0.5) > retryDelayMs(0, 0));

// --- The queue --------------------------------------------------------------

async function main(): Promise<void> {
  let peak = 0;
  let done = 0;

  const job = async (): Promise<void> => {
    peak = Math.max(peak, objectsInFlight());
    await new Promise((resolve) => setTimeout(resolve, 5));
    done += 1;
  };

  await Promise.all(Array.from({ length: 12 }, () => objectSlot(job)));
  assert.equal(done, 12, 'every queued fetch runs');
  assert.ok(peak <= OBJECT_CONCURRENCY, `never more than ${OBJECT_CONCURRENCY} at once, saw ${peak}`);
  assert.equal(objectsInFlight(), 0, 'the queue empties');

  // A job that throws must hand its slot back. Without this the fourth 404 in
  // a channel is the last object that channel ever fetches.
  await Promise.allSettled(
    Array.from({ length: OBJECT_CONCURRENCY }, () =>
      objectSlot(() => Promise.reject(new Error('gone'))),
    ),
  );
  assert.equal(objectsInFlight(), 0, 'a failed fetch releases its slot');

  // And the queue still works afterwards.
  await objectSlot(async () => undefined);
  assert.equal(objectsInFlight(), 0);
}

void main();
