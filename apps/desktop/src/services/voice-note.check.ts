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
import {
  MAX_SECONDS,
  MIN_SECONDS,
  extensionFor,
  formatDuration,
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

console.log('voice-note: ok');
