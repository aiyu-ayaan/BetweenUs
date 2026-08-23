/**
 * Self-check for the ring cooldown.
 *
 * Both directions are silent failures. Too permissive and there is no brake on
 * the one push in this app that is allowed to wake a phone past its owner's
 * preferences; too strict and ringing somebody back after they missed the call
 * quietly does nothing, with no error anywhere to say why.
 *
 * Run with `pnpm --filter @betweenus/call-service check`.
 */
import assert from 'node:assert/strict';
import { RING_COOLDOWN_MS, ringIsAllowed, ringKey } from './ring-cooldown';

const now = 1_700_000_000_000;

// Never rung before is always allowed, or nobody could ever ring anybody.
assert.equal(ringIsAllowed(undefined, now), true);

// Twice in a row is the thing being stopped.
assert.equal(ringIsAllowed(now, now), false);
assert.equal(ringIsAllowed(now - 1, now), false);
assert.equal(ringIsAllowed(now - (RING_COOLDOWN_MS - 1), now), false);

// The boundary is allowed rather than refused: a cooldown that has elapsed has
// elapsed, and an off-by-one here is a ring that fails for no visible reason.
assert.equal(ringIsAllowed(now - RING_COOLDOWN_MS, now), true);
assert.equal(ringIsAllowed(now - RING_COOLDOWN_MS * 2, now), true);

// A clock that went backwards - an NTP correction between two rings - must not
// unlock the cooldown. `now - lastRingAt` is negative there, which is less than
// the window, which is refused.
assert.equal(ringIsAllowed(now + 60_000, now), false);

// Direction matters: A ringing B is not B ringing A, so a missed call can be
// returned immediately.
assert.notEqual(ringKey('ana', 'ben'), ringKey('ben', 'ana'));
assert.equal(ringKey('ana', 'ben'), ringKey('ana', 'ben'));

console.log('call-service ring cooldown self-check passed');
