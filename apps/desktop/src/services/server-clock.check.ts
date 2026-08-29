/** Run with `tsx src/services/server-clock.check.ts`. The clock the client trusts. */
import assert from 'node:assert/strict';
import {
  CLOCK_SAMPLES,
  CLOCK_WARNING_MS,
  clockIsWrong,
  deviceSkewMs,
  sampleServerClock,
  serverNow,
  skewWording,
  useServerClock,
} from './server-clock';

const reset = (): void => useServerClock.getState().reset();

// --- an unmeasured clock -----------------------------------------------------

reset();
// Zero offset is what an unmeasured clock is worth, and is also the right
// answer for the overwhelming majority of machines, which keep time.
assert.equal(useServerClock.getState().offsetMs, 0);
assert.ok(Math.abs(serverNow() - Date.now()) < 50);
assert.equal(clockIsWrong(0), false);

// A reply with no usable `Date` header teaches nothing rather than something
// wrong: a proxy that strips it, or writes nonsense into it, must not be able
// to move this client's idea of the time.
sampleServerClock(Date.now(), Date.now(), null);
sampleServerClock(Date.now(), Date.now(), 'not a date');
assert.equal(useServerClock.getState().offsetMs, 0);

// --- a device an hour behind -------------------------------------------------

reset();
const hour = 60 * 60 * 1000;
const sent = 1_000_000;
// The reply came back 200ms later, and the server stamped it an hour ahead of
// this machine: the estimate is the midpoint of the round trip, so the offset
// is the hour plus the 100ms the reply spent in flight.
sampleServerClock(sent, sent + 200, new Date(sent + hour + 100).toUTCString());
const offset = useServerClock.getState().offsetMs;
assert.ok(Math.abs(offset - hour) < 1000, `expected about an hour, got ${offset}`);
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
sampleServerClock(0, 8_000, new Date(2_000).toUTCString());
sampleServerClock(0, 100, new Date(1_000_050).toUTCString());
assert.ok(
  Math.abs(useServerClock.getState().offsetMs - 1_000_000) < 200,
  'the fastest round trip decides',
);

// Only the last few measurements are kept, so a clock corrected an hour ago
// stops being held against the machine.
reset();
for (let i = 0; i < CLOCK_SAMPLES + 4; i += 1) sampleServerClock(0, 100, new Date(50).toUTCString());
assert.equal(useServerClock.getState().samples.length, CLOCK_SAMPLES);

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
