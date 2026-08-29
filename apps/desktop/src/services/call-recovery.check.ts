/**
 * Self-check for the recovery policy: `tsx src/services/call-recovery.check.ts`.
 *
 * The numbers are a policy, not arithmetic, so what is checked here is the
 * relationships between them - the ones that are silently load-bearing and that
 * a well-meaning tweak to one constant would break:
 *
 *  - every attempt has to fit inside the deadline, or the attempt budget is a
 *    fiction and the deadline is the only thing that ever fires;
 *  - one side and only one side restarts, or two renegotiations race;
 *  - a call outlives one of its links, or a blip on one tile ends the call.
 *
 * It also pins the Android policy in `CallRecovery.kt`. The two clients must
 * agree: a phone that waits four seconds and a laptop that waits one restart on
 * top of each other.
 */
import assert from 'node:assert/strict';
import {
  DEADLINE_MS,
  GRACE_MS,
  MAX_ATTEMPTS,
  SIGNALLING_DEADLINE_MS,
  backoffMs,
  restarts,
  signallingBackoffMs,
  spent,
} from './call-recovery';

// --- the numbers Android holds, which this must not drift from ---

assert.equal(GRACE_MS, 4_000, 'CallRecovery.kt says 4s; both clients must wait the same');
assert.equal(MAX_ATTEMPTS, 4);
assert.equal(DEADLINE_MS, 30_000);
assert.equal(SIGNALLING_DEADLINE_MS, 45_000);
assert.deepEqual([1, 2, 3, 4, 5].map(backoffMs), [0, 2_000, 4_000, 8_000, 8_000]);

// --- one side restarts, and it is the impolite one ---

assert.equal(restarts(false), true, 'the impolite side offers, so it is the one that restarts');
assert.equal(restarts(true), false, 'a polite restart is an offer the far end discards as glare');

// --- the attempt budget actually fits inside the deadline ---

// Each pass through the loop is a backoff, a restart, and a grace period spent
// waiting to see whether it took.
const budget = Array.from({ length: MAX_ATTEMPTS }, (_, index) => backoffMs(index + 1) + GRACE_MS)
  .reduce((total, cost) => total + cost, 0);
assert.ok(
  budget <= DEADLINE_MS,
  `all ${MAX_ATTEMPTS} attempts must fit in the deadline: ${budget}ms of ${DEADLINE_MS}ms`,
);

// --- giving up needs either bound, not both ---

assert.equal(spent(0, 0), false, 'a link that just went down is not spent');
assert.equal(spent(MAX_ATTEMPTS - 1, DEADLINE_MS - 1), false, 'neither bound reached');
assert.equal(spent(MAX_ATTEMPTS, 0), true, 'out of attempts, however quickly');
assert.equal(spent(0, DEADLINE_MS), true, 'out of time, even having never managed an attempt');

// --- a call outlives one of its links ---

assert.ok(
  SIGNALLING_DEADLINE_MS > DEADLINE_MS,
  'the socket reconnects itself; one dead link must not be the end of the call',
);

// --- signalling retries race the gateway's seat-holding window ---

assert.equal(signallingBackoffMs(1), 0, 'the first retry races the held seat, so it is immediate');
assert.deepEqual([2, 3, 4, 5, 9].map(signallingBackoffMs), [1_000, 2_000, 4_000, 8_000, 8_000]);
assert.ok(
  signallingBackoffMs(99) < SIGNALLING_DEADLINE_MS,
  'a single wait must never exceed the whole call deadline',
);

console.log('call-recovery.check.ts: ok');
