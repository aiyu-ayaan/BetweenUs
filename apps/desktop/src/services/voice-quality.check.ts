/**
 * Self-check for the microphone capture and encoder settings.
 *
 * Run with `pnpm --filter @nexora/desktop check`. Two things here are only
 * audible to other people: a constraint object that quietly asks for the wrong
 * processing, and a gate that chatters or eats the start of a word.
 */
import assert from 'node:assert/strict';
import { workletSource } from './mic-gate';
import {
  DEFAULT_VOICE_SETTINGS,
  GATE_CLOSED,
  GATE_RANGE,
  amplitudeToDb,
  micCapture,
  micProcessing,
  micPublish,
  stepGate,
  type VoiceSettings,
} from './voice-quality';

const clear: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
const hifi: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS, mode: 'hifi' };

// A voice gets the speech processing, and asks for the model-based suppressor
// as well - where Chromium has it, it takes over from the ordinary one; where
// it does not, an unknown constraint is ignored.
assert.deepEqual(micProcessing(clear), {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: true,
});

// Turning suppression off turns both suppressors off, not just the weak one.
assert.equal(micProcessing({ ...clear, noiseSuppression: false }).voiceIsolation, false);

// Music gets none of it, whatever the switches say - every one of them is
// destructive to anything that is not speech.
assert.deepEqual(micProcessing(hifi), {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  voiceIsolation: false,
});
assert.deepEqual(
  micProcessing({ ...hifi, echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
  micProcessing(hifi),
);

// Channel counts follow the mode; a voice in stereo is half the bitrate wasted.
assert.equal(micCapture(clear).channelCount, 1);
assert.equal(micCapture(hifi).channelCount, 2);

// No device chosen means no `deviceId` constraint at all: the system default is
// what most people want, and naming a device that has since been unplugged is
// how a join fails with "device not found".
assert.equal('deviceId' in micCapture(clear), false);
assert.equal(micCapture({ ...clear, inputDeviceId: 'usb-mic' }).deviceId, 'usb-mic');

// A processor is only attached when one is passed - a gate is optional.
assert.equal('processor' in micCapture(clear), false);
const gate = { name: 'test' } as unknown as Parameters<typeof micCapture>[1];
assert.equal(micCapture(clear, gate).processor, gate);

// Speech at Discord's bitrate, silence not transmitted; music at twice that in
// stereo, with every silence sent because a held note is one.
assert.equal(micPublish(clear).audioPreset?.maxBitrate, 64_000);
assert.equal(micPublish(clear).dtx, true);
assert.equal(micPublish(clear).forceStereo, false);
assert.equal(micPublish(hifi).audioPreset?.maxBitrate, 128_000);
assert.equal(micPublish(hifi).dtx, false);
assert.equal(micPublish(hifi).forceStereo, true);
// Loss redundancy on both: a lost packet is inaudible rather than a click.
assert.equal(micPublish(clear).red, true);
assert.equal(micPublish(hifi).red, true);

// dBFS: full scale is 0, quiet is negative, silence is floored rather than
// -Infinity (which would take the gate's arithmetic with it).
assert.equal(amplitudeToDb(1), 0);
assert.ok(amplitudeToDb(0.1) < -19 && amplitudeToDb(0.1) > -21);
assert.equal(amplitudeToDb(0), -100);
assert.ok(Number.isFinite(amplitudeToDb(0)));

// The gate opens the instant the level crosses, not a ramp later.
const threshold = -50;
assert.equal(stepGate(GATE_CLOSED, -60, threshold, 0).open, false);
const opened = stepGate(GATE_CLOSED, -40, threshold, 1);
assert.equal(opened.open, true);

// It holds through the gap between two words rather than closing in it.
assert.equal(stepGate(opened, -90, threshold, 1.2).open, true);
assert.equal(stepGate(opened, -90, threshold, 1.4).open, false);

// Hysteresis: a voice sitting on the line keeps it open instead of chattering.
const onTheLine = stepGate(opened, -53, threshold, 1.5);
assert.equal(onTheLine.open, true, 'closed within the hysteresis band');
assert.deepEqual(stepGate(onTheLine, -57, threshold, 2), { open: false, heldUntil: 1.3 });

// A closed gate is not re-opened by the hysteresis band on its own - otherwise
// room tone six decibels under the threshold would hold it open forever.
assert.equal(stepGate(GATE_CLOSED, -53, threshold, 5).open, false);

// The slider covers the useful range and the default sits inside it.
assert.ok(GATE_RANGE.minDb < GATE_RANGE.maxDb);
assert.ok(
  DEFAULT_VOICE_SETTINGS.gateThresholdDb !== null &&
    DEFAULT_VOICE_SETTINGS.gateThresholdDb > GATE_RANGE.minDb &&
    DEFAULT_VOICE_SETTINGS.gateThresholdDb < GATE_RANGE.maxDb,
);

// The worklet is assembled from these two functions' own source so the gate
// under test above is the gate on the audio thread. Compiling it here is what
// catches a build that renamed something out from under the splice.
assert.doesNotThrow(() => new Function(workletSource), 'the gate worklet is not valid JavaScript');
assert.ok(workletSource.includes('const stepGate ='));
assert.ok(workletSource.includes('const amplitudeToDb ='));

console.log('voice-quality self-check passed');
