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
  MIN_HEALTHY_ERLE_DB,
  echoAdvice,
  echoCancellerFailing,
} from './call-stats';
import {
  formatCallDuration,
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
  echoReturnLossEnhancementDb: null,
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
  sendWidth: null,
  sendHeight: null,
  sendLimitedBy: null,
  connected: true,
  transport: null,
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

// Nothing is holding the send side down, which is not the same as "there is no
// send side": both read as null and the panel shows neither.
assert.equal(second.sendLimitedBy, null);

// A share being shrunk before it leaves. The picture on the wire is a quarter
// of the one being captured, and the reason is the whole point of the reading.
const throttled = toStats(
  'p1',
  'Ann',
  sample({ at: 2_000, sendWidth: 960, sendHeight: 540, sendLimitedBy: 'bandwidth' }),
  sample({ at: 1_000 }),
);
assert.equal(throttled.sendWidth, 960);
assert.equal(throttled.sendHeight, 540);
assert.equal(throttled.sendLimitedBy, 'bandwidth');

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
// A link with no path carries nothing whatever the microphone does, so it is
// no evidence about the microphone. This is the pair of contradictory notices:
// "could not be reached" and "nobody can hear you, try another input" on screen
// at once, where only the first is true and only the second looks fixable.
const unreachable: LinkStats[] = [{ ...silent, connected: false }];
assert.equal(notBeingHeard(true, unreachable, 9), false);
// One live link that is not hearing us still fires, even next to a dead one:
// the dead link is ignored, not counted as a vote either way.
assert.equal(notBeingHeard(true, [...unreachable, silent], 9), true);
// ... and a live link that is hearing us still settles it.
assert.equal(notBeingHeard(true, [...unreachable, second], 9), false);

// Health warnings fire where a person would notice, and not before.
assert.equal(healthWarning([second]), null);
const lossy = { ...second, lossPercent: 12 };
assert.match(healthWarning([lossy]) ?? '', /12%/);
assert.match(healthWarning([lossy]) ?? '', /Ann/);
const slow = { ...second, roundTripMs: 420 };
assert.match(healthWarning([slow]) ?? '', /420 ms/);
// Loss is the louder complaint when both are true: it is what breaks speech.
assert.match(healthWarning([{ ...lossy, roundTripMs: 420 }]) ?? '', /%/);

// --- The call clock --------------------------------------------------------

assert.equal(formatCallDuration(0), '00:00');
assert.equal(formatCallDuration(9), '00:09');
assert.equal(formatCallDuration(59), '00:59');
// The minute rolls over, which is the boundary a modulo gets wrong.
assert.equal(formatCallDuration(60), '01:00');
assert.equal(formatCallDuration(61), '01:01');
assert.equal(formatCallDuration(599), '09:59');
assert.equal(formatCallDuration(3599), '59:59');
// The hour appears and the minutes keep their padding; the hour does not get
// any, because "01:02:03" on a two-hour call is a leading zero for nothing.
assert.equal(formatCallDuration(3600), '1:00:00');
assert.equal(formatCallDuration(3661), '1:01:01');
assert.equal(formatCallDuration(36000), '10:00:00');
// A fraction of a second is not a second yet.
assert.equal(formatCallDuration(0.9), '00:00');
assert.equal(formatCallDuration(59.99), '00:59');
// A clock that ran backwards, and a number that is not one. Both read as zero
// rather than as "-1:-1" on somebody's screen.
assert.equal(formatCallDuration(-5), '00:00');
assert.equal(formatCallDuration(Number.NaN), '00:00');

console.log('call-stats check ok');


// --- Is echo cancellation actually working? --------------------------------
//
// The one reading that separates "there is echo" from "the canceller is
// subtracting the wrong signal". Before this existed the only way to tell was
// to ask somebody on the call whether they could hear themselves.

// A converged canceller removes 20-40 dB; single digits mean it is running and
// subtracting the wrong signal, which is what a non-default output device does.
assert.equal(echoCancellerFailing(true, 30), false);
assert.equal(echoCancellerFailing(true, 0), true);
assert.equal(echoCancellerFailing(true, MIN_HEALTHY_ERLE_DB - 0.1), true);
assert.equal(echoCancellerFailing(true, MIN_HEALTHY_ERLE_DB), false);

// Echo cancellation switched off is a choice, not a fault - hi-fi mode turns it
// off deliberately - so it must never raise the warning.
assert.equal(echoCancellerFailing(false, 0), false);

// A browser that does not report the statistic must not produce a permanent
// warning on a machine that has no echo at all.
assert.equal(echoCancellerFailing(true, null), false);

// The advice names the output device when that is the likely cause, because
// "switch your speakers back" is the only version of this a person can act on.
assert.match(echoAdvice(true), /output device/i);
assert.match(echoAdvice(false), /[Hh]eadphones/);
