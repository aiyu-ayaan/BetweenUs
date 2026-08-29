/**
 * The decisions in the recorder that go wrong silently.
 *
 * The file name has to end in an extension that matches the container it was
 * recorded into - a WebM called `.m4a` is a file the operating system refuses
 * to open for a reason nobody can see from inside the app - and the counter on
 * screen has to agree with the minimum length underneath it, or a recording
 * reading 0:01 is rejected as too short.
 */
import assert from 'node:assert/strict';
import { VOICE_WAVEFORM_BARS, isVoiceNote } from '@betweenus/shared-types';
import {
  MAX_SECONDS,
  MIN_SECONDS,
  extensionFor,
  formatDuration,
  toWaveform,
  voiceFileName,
} from './voice-note';

// The extension follows the container, whatever else is in the mime type.
assert.equal(extensionFor('audio/webm;codecs=opus'), 'webm');
assert.equal(extensionFor('audio/mp4;codecs=opus'), 'm4a');
assert.equal(extensionFor('audio/ogg;codecs=opus'), 'ogg');
// Anything unrecognised falls back to WebM, which is what the recorder picked
// first and what every runtime this ships on can play.
assert.equal(extensionFor('audio/something-new'), 'webm');

// A name that sorts by when it was recorded and says what it is.
const name = voiceFileName('audio/webm;codecs=opus', new Date(2026, 7, 29, 9, 5, 3));
assert.equal(name, 'voice_20260829_090503.webm');
assert.ok(/^voice_\d{8}_\d{6}\.[a-z0-9]+$/.test(name), 'every field is padded');
assert.equal(
  voiceFileName('audio/mp4', new Date(2026, 7, 29, 9, 5, 3)),
  'voice_20260829_090503.m4a',
);

// A slip of the finger is not a message; a recording walked away from is not
// an open microphone for ever.
assert.ok(MIN_SECONDS >= 1, 'a quarter-second of room tone is never what anybody meant');
assert.ok(MAX_SECONDS > MIN_SECONDS, 'the ceiling is above the floor');

// The counter, which is read at a glance and so has to be padded.
assert.equal(formatDuration(0), '0:00');
assert.equal(formatDuration(9), '0:09');
assert.equal(formatDuration(69), '1:09');
assert.equal(formatDuration(600), '10:00');
// Part-seconds round down, so the counter never shows 0:01 for a recording the
// minimum above would refuse to send.
assert.equal(formatDuration(0.9), '0:00');
assert.equal(formatDuration(-5), '0:00', 'a clock that ran backwards still reads zero');

// --- The waveform ----------------------------------------------------------
//
// Every one of these fails silently: a wrong bucket count draws a waveform of
// the wrong width, a missing normalise draws a quiet recording as silence, and
// a missing floor draws a pause as a hole that reads as a damaged file.

// Always the same number of bars, whatever it was measured from - which is
// what makes a three-second message and a three-minute one the same shape of
// thing rather than the same shape at two widths.
const short = toWaveform([0.1, 0.9]);
const long = toWaveform(Array.from({ length: 3000 }, (_, at) => (at % 7) / 7));
assert.equal(short.length, VOICE_WAVEFORM_BARS);
assert.equal(long.length, VOICE_WAVEFORM_BARS);
assert.equal(toWaveform([], 12).length, 0, 'nothing measured draws nothing');

// Normalised against the loudest bar, so a quiet recording looks like a
// recording. Microphone levels differ by an order of magnitude between
// devices, and a waveform is read as a shape, never as a measurement.
const quiet = toWaveform([0.001, 0.002, 0.004, 0.002], 4);
const loud = toWaveform([0.25, 0.5, 1, 0.5], 4);
assert.deepEqual(quiet, loud, 'the same shape at any volume is the same waveform');
assert.equal(Math.max(...loud), 1, 'the loudest bar reaches the top');

// A floor under every bar, so a pause is a line rather than a hole.
const gap = toWaveform([1, 0, 0, 1], 4);
assert.ok(Math.min(...gap) > 0, 'silence is still drawn');
assert.ok(Math.min(...gap) < 0.2, 'and is still visibly quieter than speech');

// Silence throughout normalises to nothing to divide by. A flat line is the
// honest answer; NaN is what the arithmetic gives without the guard.
const silent = toWaveform([0, 0, 0], 4);
assert.ok(silent.every((bar) => Number.isFinite(bar) && bar > 0), 'no NaN bars');

// Bars stay inside the range the renderer scales against.
for (const bar of [...short, ...long, ...quiet]) {
  assert.ok(bar > 0 && bar <= 1, `bar ${bar} is outside 0..1`);
}

// --- Which attachments get the voice treatment -----------------------------
//
// A recorded note gets a waveform bubble; a music file somebody shared gets
// its name and a download, because that is what sharing a track means.
const base = { key: 'k', url: 'u', contentType: 'audio/webm', size: 1, iv: 'i', epoch: 1 };
assert.ok(isVoiceNote({ ...base, name: 'voice_20260830_011311.webm', waveform: [0.5] }));
// Recorded before waveforms existed: recognised by the name this client gives.
assert.ok(isVoiceNote({ ...base, name: 'voice_20260830_011311.webm' }));
assert.ok(!isVoiceNote({ ...base, name: 'interview.mp3' }), 'a shared track is not a voice note');
assert.ok(
  !isVoiceNote({ ...base, name: 'voice_20260830_011311.webm', contentType: 'video/mp4' }),
  'the name alone does not make a video into a voice note',
);
// The name check must not match something merely starting with the word.
assert.ok(!isVoiceNote({ ...base, name: 'voice_memo.webm' }));

console.log('voice-note: ok');
