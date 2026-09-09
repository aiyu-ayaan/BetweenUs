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
  openVideoCapture,
  realDevices,
} from './audio-devices';

const device = (deviceId: string, kind: MediaDeviceKind): MediaDeviceInfo =>
  ({ deviceId, kind, label: deviceId, groupId: '' }) as MediaDeviceInfo;

const headset = device('headset', 'audioinput');
const webcamMic = device('webcam', 'audioinput');
const speakers = device('speakers', 'audiooutput');
const webcam = device('webcam-hd', 'videoinput');
const laptopCam = device('laptop-lid', 'videoinput');

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

// --- Cameras use the same two rules ----------------------------------------
//
// `enumerateDevices` returns every kind at once, so these are the same
// functions, asked about `videoinput`. Checked rather than assumed, because the
// kind used to be hard-coded inside `captureIsStale` and a camera asking it a
// question would have been silently answered about microphones.

assert.equal(chosenIsMissing([webcam, laptopCam], 'videoinput', 'webcam-hd'), false);
assert.equal(chosenIsMissing([laptopCam], 'videoinput', 'webcam-hd'), true);
// A microphone list says nothing about whether a camera is plugged in - which
// is exactly what a hard-coded 'audioinput' would have concluded.
assert.equal(chosenIsMissing([headset, webcamMic], 'videoinput', 'webcam-hd'), false);

// Following the system default: any change is worth recapturing for.
assert.equal(captureIsStale(null, 'laptop-lid', [webcam, laptopCam], 'videoinput'), true);
// On the camera that was asked for: nothing to do.
assert.equal(captureIsStale('webcam-hd', 'webcam-hd', [webcam, laptopCam], 'videoinput'), false);
// The chosen camera came back and the capture is still on the fallback.
assert.equal(captureIsStale('webcam-hd', 'laptop-lid', [webcam, laptopCam], 'videoinput'), true);
// Chosen and still absent: recapturing would land on the same fallback.
assert.equal(captureIsStale('webcam-hd', 'laptop-lid', [laptopCam], 'videoinput'), false);
// Without the kind it still answers about microphones, which is what every
// existing caller means by it.
assert.equal(captureIsStale('headset', 'headset', [headset, webcamMic]), false);

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

// --- A camera gives up the least it can ------------------------------------
//
// Two ways to be refused and they want opposite retries: keep the size and drop
// the camera, or keep the camera and drop the size. Collapsing both to
// `video: true` throws away the working half of the request, which is why this
// is asked rather than guessed.

const askedVideo: MediaTrackConstraints[] = [];

function fakeVideoMedia(fail: (attempt: number) => Error | null): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: (constraints: MediaStreamConstraints) => {
          askedVideo.push(constraints.video as MediaTrackConstraints);
          const error = fail(askedVideo.length);
          return error ? Promise.reject(error) : Promise.resolve('stream' as unknown as MediaStream);
        },
      },
    },
  });
}

const overconstrained = (constraint: string): Error =>
  Object.assign(new Error('OverconstrainedError'), { name: 'OverconstrainedError', constraint });

const FULL = {
  deviceId: { exact: 'webcam-hd' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

// The camera is gone: keep the size, drop the device, land on the default.
askedVideo.length = 0;
fakeVideoMedia((attempt) => (attempt === 1 ? overconstrained('deviceId') : null));
await openVideoCapture(FULL);
assert.equal(askedVideo.length, 2);
assert.deepEqual(
  askedVideo[1],
  { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
  'the retry drops only the camera',
);

// This camera has no such format: keep the camera somebody picked, drop the size.
askedVideo.length = 0;
fakeVideoMedia((attempt) => (attempt === 1 ? overconstrained('width') : null));
await openVideoCapture(FULL);
assert.equal(askedVideo.length, 2);
assert.deepEqual(askedVideo[1], { deviceId: { exact: 'webcam-hd' } }, 'the retry keeps the camera');

// A browser that does not say which constraint it refused is treated as the
// device case, which is the commoner one by far.
askedVideo.length = 0;
fakeVideoMedia((attempt) => (attempt === 1 ? named('OverconstrainedError') : null));
await openVideoCapture(FULL);
assert.equal(askedVideo.length, 2);
assert.equal(askedVideo[1]?.deviceId, undefined);

// A refused permission is re-thrown rather than retried into a worse error.
askedVideo.length = 0;
fakeVideoMedia(() => named('NotAllowedError'));
await assert.rejects(openVideoCapture(FULL), /NotAllowedError/);
assert.equal(askedVideo.length, 1);

// No camera named and nothing to relax: one attempt, and its failure stands.
askedVideo.length = 0;
fakeVideoMedia(() => named('NotFoundError'));
await assert.rejects(openVideoCapture({ width: { ideal: 1280 } }), /NotFoundError/);
assert.equal(askedVideo.length, 1);

console.log('audio-devices.check.ts ok');
