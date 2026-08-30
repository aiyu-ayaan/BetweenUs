/**
 * Run with `tsx src/services/audio-devices.check.ts`.
 *
 * The two pure decisions - whether a chosen device has gone, and whether a live
 * capture is now on the wrong one - and the one branch that is not pure but is
 * worth faking three lines for: the retry that opens the system default when
 * the device somebody chose is not there. Enumeration itself needs a browser.
 */
import assert from 'node:assert/strict';
import {
  captureIsStale,
  chosenIsMissing,
  openAudioCapture,
  realDevices,
} from './audio-devices';

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

// Before the microphone is granted, `enumerateDevices` answers with one empty
// entry per kind rather than with nothing. Left in, it is a list of one that is
// not your device, so every chosen device reads as unplugged - which is the
// spurious "the device you chose is not connected" and the fallback behind it.
const unasked = [device('', 'audioinput'), device('', 'audiooutput')];
assert.deepEqual(realDevices(unasked), []);
assert.equal(chosenIsMissing(unasked, 'audioinput', 'headset'), true, 'the bug this guards');
assert.equal(chosenIsMissing(realDevices(unasked), 'audioinput', 'headset'), false);

// A real list is passed through untouched.
assert.deepEqual(realDevices([headset, webcamMic]), [headset, webcamMic]);

// --- The fallback `exact` bought -------------------------------------------
//
// Naming the device with `exact` is what makes choosing one work at all, and it
// is also what turns an unplugged device into a refusal. The retry is the whole
// of that trade, so it is checked here rather than trusted: a fake
// `getUserMedia` is three lines, and the alternative is finding out in a call.

const asked: MediaTrackConstraints[] = [];

function fakeGetUserMedia(fail: (attempt: number) => Error | null): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: (constraints: MediaStreamConstraints) => {
          asked.push(constraints.audio as MediaTrackConstraints);
          const error = fail(asked.length);
          return error ? Promise.reject(error) : Promise.resolve('stream' as unknown as MediaStream);
        },
      },
    },
  });
}

const named = (name: string): Error => Object.assign(new Error(name), { name });

// The chosen device is gone: refused once, then opened on the system default
// with every other constraint intact.
asked.length = 0;
fakeGetUserMedia((attempt) => (attempt === 1 ? named('OverconstrainedError') : null));
await openAudioCapture({ deviceId: { exact: 'headset' }, noiseSuppression: true });
assert.equal(asked.length, 2);
assert.deepEqual(asked[1], { noiseSuppression: true }, 'the retry drops only the device');

// A browser that checked the hardware first says the same thing differently.
asked.length = 0;
fakeGetUserMedia((attempt) => (attempt === 1 ? named('NotFoundError') : null));
await openAudioCapture({ deviceId: { exact: 'headset' } });
assert.equal(asked.length, 2);

// A refused permission is not a missing device. Retrying it would be denied
// again and would report the wrong failure, so it is re-thrown untouched.
asked.length = 0;
fakeGetUserMedia(() => named('NotAllowedError'));
await assert.rejects(openAudioCapture({ deviceId: { exact: 'headset' } }), /NotAllowedError/);
assert.equal(asked.length, 1, 'a denied permission is asked once');

// Nothing chosen, nothing to fall back to: one attempt, and its failure stands.
asked.length = 0;
fakeGetUserMedia(() => named('NotFoundError'));
await assert.rejects(openAudioCapture({ noiseSuppression: true }), /NotFoundError/);
assert.equal(asked.length, 1, 'no device named means no second attempt');

console.log('audio-devices.check.ts ok');
