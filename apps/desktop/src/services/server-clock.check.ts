/** Run with `tsx src/services/server-clock.check.ts`. The clock the client trusts. */
import assert from 'node:assert/strict';
import {
  CLOCK_MAX_ROUND_TRIP_MS,
  CLOCK_SAMPLES,
  CLOCK_SAMPLE_TTL_MS,
  CLOCK_WARNING_MS,
  clockIsWrong,
  deviceSkewMs,
  freshSamples,
  sampleServerClock,
  serverNow,
  skewWording,
  usableSample,
  useServerClock,
} from './server-clock';

const reset = (): void => useServerClock.getState().reset();
const offsetNow = (): number => useServerClock.getState().offsetMs;

/** A reply that arrived `agoMs` ago, from a server `skewMs` ahead of this machine. */
function reply(agoMs: number, skewMs: number, roundTripMs = 100): void {
  const received = Date.now() - agoMs;
  sampleServerClock(received - roundTripMs, received, new Date(received + skewMs).toUTCString());
}

// --- an unmeasured clock -----------------------------------------------------

reset();
// Zero offset is what an unmeasured clock is worth, and is also the right
// answer for the overwhelming majority of machines, which keep time.
assert.equal(offsetNow(), 0);
assert.ok(Math.abs(serverNow() - Date.now()) < 50);
assert.equal(clockIsWrong(0), false);

// A reply with no usable `Date` header teaches nothing rather than something
// wrong: a proxy that strips it, or writes nonsense into it, must not be able
// to move this client's idea of the time.
sampleServerClock(Date.now(), Date.now(), null);
sampleServerClock(Date.now(), Date.now(), 'not a date');
assert.equal(offsetNow(), 0);

// --- a device an hour behind -------------------------------------------------

reset();
const hour = 60 * 60 * 1000;
// The reply came back 200ms later, and the server stamped it an hour ahead of
// this machine: the estimate is the midpoint of the round trip, so the offset
// is the hour plus the 100ms the reply spent in flight.
reply(0, hour, 200);
const offset = offsetNow();
// The `Date` header is written to the second, so an offset read from it is
// quantised to about that - uselessly coarse for lining up two music players,
// and entirely sufficient for a question asked in minutes.
assert.ok(Math.abs(offset - hour) < 1_500, `expected about an hour, got ${offset}`);
// Positive skew means this machine is *behind*; the wording has to agree.
assert.equal(deviceSkewMs() < 0, true);
assert.equal(clockIsWrong(offset), true);
assert.match(skewWording(offset), /behind/);
assert.match(skewWording(-offset), /ahead of/);

// --- which sample wins -------------------------------------------------------

reset();
// A slow round trip is slow because something queued, and a queue is rarely
// symmetric - so a delayed sample is biased, not merely noisy, and the
// least-delayed one is the one to believe.
reply(0, 2_000, 8_000);
reply(0, 1_000_000, 100);
assert.ok(Math.abs(offsetNow() - 1_000_000) < 1_500, 'the fastest round trip decides');

// Only the last few measurements are kept, so a clock corrected an hour ago
// stops being held against the machine.
reset();
for (let i = 0; i < CLOCK_SAMPLES + 4; i += 1) reply(0, 50);
assert.equal(useServerClock.getState().samples.length, CLOCK_SAMPLES);

// --- a round trip too slow to mean anything ----------------------------------

// The regression: the offset is the midpoint of the round trip, so it carries
// up to half of however asymmetric that trip was. An upload that took twelve
// minutes to answer would otherwise report a six-minute skew on a machine whose
// clock is exactly right - and one quiet spell later that is the best sample
// held, and the banner is up.
reset();
const slow = { sentAtMs: 0, receivedAtMs: 12 * 60 * 1000, serverMs: 0 };
assert.equal(usableSample(slow), false);
sampleServerClock(slow.sentAtMs, slow.receivedAtMs, new Date(slow.serverMs).toUTCString());
assert.equal(offsetNow(), 0, 'a twelve-minute round trip says nothing about the time');
assert.equal(useServerClock.getState().samples.length, 0);

// The edge is inclusive, and anything under it is ordinary.
assert.equal(usableSample({ sentAtMs: 0, receivedAtMs: CLOCK_MAX_ROUND_TRIP_MS, serverMs: 0 }), true);
assert.equal(usableSample({ sentAtMs: 0, receivedAtMs: CLOCK_MAX_ROUND_TRIP_MS + 1, serverMs: 0 }), false);

// A round trip that came back before it left is the clock moving under the
// measurement. It would be the "fastest" sample held - the worst one to trust.
assert.equal(usableSample({ sentAtMs: 5_000, receivedAtMs: 4_000, serverMs: 5_000 }), false);

// --- measurements expire -----------------------------------------------------

// The other half of the regression, and the one that keeps a banner up: the
// offset is the least-delayed sample held, so a fast measurement taken while
// the clock was wrong stays the best one after the clock is corrected. It is
// not merely stale - it was timed against a clock that no longer exists.
reset();
reply(CLOCK_SAMPLE_TTL_MS + 60_000, hour); // an hour out, measured long ago
assert.equal(clockIsWrong(offsetNow()), true);
reply(0, 0); // the clock is right now
assert.equal(offsetNow() < CLOCK_WARNING_MS, true, 'a corrected clock stops being wrong');
assert.equal(useServerClock.getState().samples.length, 1, 'the stale sample is gone');

// A sample from within the window is kept, so an ordinary session still has
// several to choose the least-delayed one from.
reset();
reply(CLOCK_SAMPLE_TTL_MS - 60_000, 0);
reply(0, 0);
assert.equal(useServerClock.getState().samples.length, 2);

// The pruning rule itself, in both directions: too old, and from before a clock
// that stepped backwards - both were timed on a clock that is gone.
const now = 1_000_000_000_000;
const at = (receivedAtMs: number): { sentAtMs: number; receivedAtMs: number; serverMs: number } => ({
  sentAtMs: receivedAtMs - 100,
  receivedAtMs,
  serverMs: receivedAtMs,
});
assert.deepEqual(freshSamples([at(now - CLOCK_SAMPLE_TTL_MS - 1)], now), []);
assert.deepEqual(freshSamples([at(now + 1)], now), []);
assert.deepEqual(freshSamples([at(now - CLOCK_SAMPLE_TTL_MS)], now), [at(now - CLOCK_SAMPLE_TTL_MS)]);

// --- the threshold -----------------------------------------------------------

// Under five minutes nothing on screen is misleading, and a laptop with a lazy
// NTP daemon must not be nagged about it.
assert.equal(clockIsWrong(CLOCK_WARNING_MS - 1), false);
assert.equal(clockIsWrong(-(CLOCK_WARNING_MS - 1)), false);
assert.equal(clockIsWrong(CLOCK_WARNING_MS), true);
assert.equal(clockIsWrong(-CLOCK_WARNING_MS), true);

// The wording scales, because "about 4320 minutes" is not a sentence.
assert.match(skewWording(10 * 60 * 1000), /10 minutes/);
assert.match(skewWording(5 * hour), /5 hours/);
assert.match(skewWording(3 * 24 * hour), /3 days/);

reset();
console.log('server-clock.check.ts ok');
