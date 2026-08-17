/**
 * Run with `tsx src/services/audio-devices.check.ts`.
 *
 * Only the two pure decisions are checked here: whether a chosen device has
 * gone, and whether a live capture is now on the wrong one. The enumeration
 * itself needs a browser and is not worth faking.
 */
import assert from 'node:assert/strict';
import { captureIsStale, chosenIsMissing } from './audio-devices';

const device = (deviceId: string, kind: MediaDeviceKind): MediaDeviceInfo =>
  ({ deviceId, kind, label: deviceId, groupId: '' }) as MediaDeviceInfo;

const headset = device('headset', 'audioinput');
const webcamMic = device('webcam', 'audioinput');
const speakers = device('speakers', 'audiooutput');

// Nothing chosen is never missing: the system default is always something.
assert.equal(chosenIsMissing([headset], 'audioinput', null), false);
assert.equal(chosenIsMissing([headset, webcamMic], 'audioinput', 'headset'), false);
assert.equal(chosenIsMissing([webcamMic], 'audioinput', 'headset'), true);

// An empty list is "not enumerated yet", not "your microphone is gone".
assert.equal(chosenIsMissing([], 'audioinput', 'headset'), false);
// Kinds do not answer for each other: a speaker list says nothing about a mic.
assert.equal(chosenIsMissing([speakers], 'audioinput', 'headset'), false);

// Following the system default means every change is worth recapturing for.
assert.equal(captureIsStale(null, 'webcam', [headset, webcamMic]), true);
// On the device that was asked for: nothing to do.
assert.equal(captureIsStale('headset', 'headset', [headset, webcamMic]), false);
// The chosen device came back and the capture is still on the fallback.
assert.equal(captureIsStale('headset', 'webcam', [headset, webcamMic]), true);
// Chosen and still absent: recapturing would land on the same fallback.
assert.equal(captureIsStale('headset', 'webcam', [webcamMic]), false);

console.log('audio-devices.check.ts ok');
