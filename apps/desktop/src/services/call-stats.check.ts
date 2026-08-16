/**
 * Self-check for the call statistics: `tsx src/services/call-stats.check.ts`.
 *
 * Everything here is arithmetic over counters, and counters have three edges
 * that all look like a working call until somebody reads the screen: the first
 * sample has nothing to compare against, a rebuilt connection resets the totals
 * to zero, and a division by an elapsed time of zero produces Infinity.
 */
import assert from 'node:assert/strict';
import {
  healthWarning,
  kbpsBetween,
  lossPercent,
  notBeingHeard,
  toStats,
  type LinkSample,
  type LinkStats,
} from './call-stats';

// 128 kilobytes in two seconds is 512 kbps.
assert.equal(kbpsBetween(128_000, 0, 2_000), 512);
// Nothing moved.
assert.equal(kbpsBetween(1_000, 1_000, 1_000), 0);
// No time between the samples: no answer, rather than Infinity on screen.
assert.equal(kbpsBetween(1_000, 0, 0), null);
// A counter that went backwards is a connection rebuilt underneath us.
assert.equal(kbpsBetween(10, 5_000, 1_000), null);

assert.equal(lossPercent(5, 95), 5);
assert.equal(lossPercent(0, 100), 0);
// Nothing has arrived yet, so the loss rate is not 100% - it is unknown.
assert.equal(lossPercent(0, 0), null);
// One decimal place, so a fifth of a percent does not read as zero.
assert.equal(lossPercent(1, 799), 0.1);

const sample = (patch: Partial<LinkSample>): LinkSample => ({
  at: 0,
  inboundAudioBytes: 0,
  inboundVideoBytes: 0,
  outboundAudioBytes: 0,
  outboundVideoBytes: 0,
  packetsLost: 0,
  packetsReceived: 0,
  roundTripSeconds: null,
  frameWidth: null,
  frameHeight: null,
  framesPerSecond: null,
  ...patch,
});

// The first sample of a call: rates are unknown rather than zero, and the peer
// is assumed to be hearing us until there is evidence otherwise. Reporting "you
// are not being heard" for the first second of every call would train everyone
// to ignore it.
const first = toStats('p1', 'Ann', sample({ at: 1_000 }), undefined);
assert.equal(first.downKbps, null);
assert.equal(first.upKbps, null);
assert.equal(first.sendingAudio, true);

// A second sample a second later, with audio and video both flowing.
const second = toStats(
  'p1',
  'Ann',
  sample({
    at: 2_000,
    inboundAudioBytes: 4_000,
    inboundVideoBytes: 121_000,
    outboundAudioBytes: 4_000,
    packetsLost: 2,
    packetsReceived: 198,
    roundTripSeconds: 0.042,
    frameWidth: 1920,
    frameHeight: 1080,
    framesPerSecond: 29.6,
  }),
  sample({ at: 1_000 }),
);
assert.equal(second.downKbps, 1_000);
assert.equal(second.upKbps, 32);
assert.equal(second.lossPercent, 1);
assert.equal(second.roundTripMs, 42);
assert.equal(second.framesPerSecond, 30);
assert.equal(second.sendingAudio, true);

// Outbound audio that has not moved between two samples is a microphone that
// is not on the wire, whatever the level meter says.
const silent = toStats(
  'p1',
  'Ann',
  sample({ at: 3_000, outboundAudioBytes: 4_000 }),
  sample({ at: 2_000, outboundAudioBytes: 4_000 }),
);
assert.equal(silent.sendingAudio, false);

const quiet: LinkStats[] = [silent];
const heard: LinkStats[] = [second];

// The warning needs three things at once: an intent to send, somebody to send
// to, and several samples of nothing. One quiet sample is a scheduling hiccup.
assert.equal(notBeingHeard(true, quiet, 3), true);
assert.equal(notBeingHeard(true, quiet, 1), false);
assert.equal(notBeingHeard(false, quiet, 9), false, 'a muted microphone is not a fault');
assert.equal(notBeingHeard(true, heard, 9), false);
assert.equal(notBeingHeard(true, [], 9), false, 'nobody to be heard by is not a fault');
// One peer hearing us and another not is that peer's problem, not the
// microphone's - and the microphone is what this warning is about.
assert.equal(notBeingHeard(true, [silent, second], 9), false);

// Health warnings fire where a person would notice, and not before.
assert.equal(healthWarning([second]), null);
const lossy = { ...second, lossPercent: 12 };
assert.match(healthWarning([lossy]) ?? '', /12%/);
assert.match(healthWarning([lossy]) ?? '', /Ann/);
const slow = { ...second, roundTripMs: 420 };
assert.match(healthWarning([slow]) ?? '', /420 ms/);
// Loss is the louder complaint when both are true: it is what breaks speech.
assert.match(healthWarning([{ ...lossy, roundTripMs: 420 }]) ?? '', /%/);

console.log('call-stats check ok');
