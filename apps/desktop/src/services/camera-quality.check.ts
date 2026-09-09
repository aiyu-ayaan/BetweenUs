/**
 * Self-check for the camera encoder settings.
 *
 * Run with `pnpm --filter @betweenus/desktop check`. Everything here is
 * invisible on the machine that sets it: a camera published at the wrong
 * ceiling looks fine locally and soft to everybody else, which is the failure
 * `video: true` shipped for as long as it did.
 */
import assert from 'node:assert/strict';
import {
  CAMERA_FRAME_RATE,
  DEFAULT_CAMERA_SETTINGS,
  cameraBitrateFor,
  cameraOptions,
  sizeFor,
  type CameraSettings,
} from './camera-quality';
import { BITRATE_RANGE } from './share-quality';

const SD = { width: 640, height: 360 };
const HD = { width: 1280, height: 720 };
const FHD = { width: 1920, height: 1080 };

const settings = (over: Partial<CameraSettings> = {}): CameraSettings => ({
  ...DEFAULT_CAMERA_SETTINGS,
  ...over,
});

// --- The ladder -------------------------------------------------------------

assert.deepEqual(sizeFor('360p'), SD);
assert.deepEqual(sizeFor('720p'), HD);
assert.deepEqual(sizeFor('1080p'), FHD);
// `auto` is a real size, not a missing one. A camera asked for `undefined`
// opens at whatever the browser felt like, which is the bug being fixed.
assert.deepEqual(sizeFor('auto'), HD);

// --- The bitrate ------------------------------------------------------------

// The reference size gets the reference number.
assert.equal(cameraBitrateFor(FHD), 4_000_000);

// More pixels, more bitrate. The guarded bug is a 1080p camera sent through a
// pipe sized for 360p.
assert.ok(cameraBitrateFor(FHD) > cameraBitrateFor(HD));
assert.ok(cameraBitrateFor(HD) > cameraBitrateFor(SD));

// Both ends hold. A postage-stamp capture must not fall to a bitrate that makes
// a face blocky, and a camera claiming an absurd size must not be handed a
// ceiling no encoder will honour.
assert.equal(cameraBitrateFor({ width: 2, height: 2 }), 600_000);
assert.equal(cameraBitrateFor({ width: 7680, height: 4320 }), 8_000_000);

// A camera is worth far less per pixel than a screen full of text. If this ever
// inverts, one of the two reference numbers has been edited without the other.
assert.ok(cameraBitrateFor(FHD) < 20_000_000);

// --- Capture constraints ----------------------------------------------------

const auto = cameraOptions(settings());
assert.equal(auto.capture.width.ideal, 1280);
assert.equal(auto.capture.height.ideal, 720);
assert.equal(auto.capture.frameRate.ideal, CAMERA_FRAME_RATE);
// No device chosen means no device constraint at all - not `deviceId: null`,
// which is a constraint asking for a camera called "null".
assert.equal(auto.capture.deviceId, undefined);

// A chosen device is `exact`. Anything weaker is advisory, and Chromium's
// advice is to open the system default - which is "changing the camera does not
// change the camera".
const pinned = cameraOptions(settings({ deviceId: 'webcam' }));
assert.deepEqual(pinned.capture.deviceId, { exact: 'webcam' });

// A camera that can only manage 24 fps should hand back 24, not refuse to open,
// so the frame rate is never `exact`.
assert.ok('ideal' in auto.capture.frameRate);
// And 60 is never volunteered: it costs the bitrate twice and looks no better
// on a face.
assert.equal(auto.capture.frameRate.max, CAMERA_FRAME_RATE);

// --- Publish parameters -----------------------------------------------------

// The camera's trade is the opposite of the share's, and this assertion is the
// one that catches somebody "unifying" the two modules later.
assert.equal(auto.publish.degradationPreference, 'balanced');
assert.equal(auto.publish.contentHint, 'motion');
assert.equal(auto.publish.scaleResolutionDownBy, 1);
assert.equal(auto.publish.videoCodec, 'H264');

// --- Granted size wins over asked size --------------------------------------

// Ask for 1080p, be handed 720p: publish at 720p's ceiling, not 1080p's.
const downgraded = cameraOptions(settings({ quality: '1080p' }), HD);
assert.equal(downgraded.publish.maxBitrate, cameraBitrateFor(HD));
// The capture still asks for what was chosen; only the ceiling follows reality.
assert.equal(downgraded.capture.width.ideal, 1920);

// Ask for 360p, be handed 1080p (a camera with one format): the ceiling has to
// follow up as well as down, or the picture is soft for no reason at all.
const upgraded = cameraOptions(settings({ quality: '360p' }), FHD);
assert.equal(upgraded.publish.maxBitrate, cameraBitrateFor(FHD));

// --- Overrides --------------------------------------------------------------

const manual = cameraOptions(settings({ maxBitrate: 12_000_000 }));
assert.equal(manual.publish.maxBitrate, 12_000_000);

// A typed number is clamped to what an encoder will actually honour.
assert.equal(
  cameraOptions(settings({ maxBitrate: 1 })).publish.maxBitrate,
  BITRATE_RANGE.min,
);
assert.equal(
  cameraOptions(settings({ maxBitrate: 999_000_000 })).publish.maxBitrate,
  BITRATE_RANGE.max,
);

// An override beats the derived value even when the granted size is known -
// the whole point of it is the link the ladder cannot see.
assert.equal(
  cameraOptions(settings({ maxBitrate: 2_000_000 }), FHD).publish.maxBitrate,
  2_000_000,
);

// A chosen frame rate reaches both halves. Setting the capture without the
// sender means an encoder still ceilinged at 30 while 60 frames arrive at it.
const smooth = cameraOptions(settings({ frameRate: 60 }));
assert.equal(smooth.capture.frameRate.ideal, 60);
assert.equal(smooth.publish.maxFramerate, 60);
assert.equal(smooth.capture.frameRate.max, 60);

// A named codec is honoured; `auto` resolves to the one with a hardware encoder.
assert.equal(cameraOptions(settings({ videoCodec: 'AV1' })).publish.videoCodec, 'AV1');
assert.equal(cameraOptions(settings({ videoCodec: 'auto' })).publish.videoCodec, 'H264');

// --- Defaults ---------------------------------------------------------------

// Mirroring is a preview decision and must never be a capture or publish one:
// text held up to a camera would arrive backwards for everybody.
assert.equal(DEFAULT_CAMERA_SETTINGS.mirror, true);
assert.equal('mirror' in auto.capture, false);
assert.equal('mirror' in auto.publish, false);

console.log('camera-quality.check.ts: ok');
