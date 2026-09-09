/**
 * How a camera is captured and encoded, and why `video: true` was never it.
 *
 * The microphone in this app has constraints, an encoding, a device picker and
 * a mode. The screen share has all of that plus a bitrate that scales with the
 * pixel count. The camera had one line - `getUserMedia({ video: true })` - and
 * nothing else: no device, no resolution, no frame rate, no sender parameters,
 * no codec preference. Whatever the browser guessed is what every peer
 * received, and a browser guesses conservatively because it has no idea what
 * the picture is for.
 *
 * This is the camera's half, and it is deliberately a *sibling* of
 * `share-quality.ts` rather than a mode inside it. The two want opposite
 * trades, and the share module already argues its side at length:
 *
 * - **A share holds pixels and gives up frames.** Text has to stay readable,
 *   and a slideshow of a legible terminal is worth more than a smooth blur of
 *   one. That is `maintain-resolution`, and it is right for a screen.
 * - **A camera is the other way round.** Nobody reads a face. A dropped frame
 *   is very nearly invisible and a soft face is not - but neither is worth
 *   pinning at the cost of the other, because a camera that goes choppy *and*
 *   stays sharp looks broken in a way a slightly softer one does not. So the
 *   camera asks for `balanced` and lets WebRTC spend whichever is cheaper at
 *   the moment the link tightens.
 * - **The content hint says the same thing.** A share carrying a document is
 *   `text`; a face is `motion`, always, and there is no second answer to offer.
 *
 * What *is* genuinely shared is imported rather than copied: the override
 * shape, the bitrate ends, the frame-rate list and the codec ranking are not
 * screen-specific, and a second copy of a codec ranking is a second chance to
 * get it wrong once.
 *
 * The pure part is here, with a self-check, for the same reason the share's is:
 * the arithmetic decides whether a 1080p camera is sent through a 360p-sized
 * pipe, and that is invisible until somebody else is looking at it.
 */

import {
  BITRATE_RANGE,
  NO_OVERRIDE,
  type CodecChoice,
  type QualityOverride,
} from './share-quality';

export interface CameraSize {
  width: number;
  height: number;
}

/**
 * What to ask the camera for.
 *
 * Not a quality slider in the sense the share's intent is not one - here it
 * genuinely is a size, because a camera has no equivalent of "what is on the
 * screen" to infer from. `auto` is the honest default rather than a fifth
 * size: see `LADDER`.
 */
export type CameraQuality = 'auto' | '360p' | '720p' | '1080p';

/**
 * This machine's camera. Stored beside the microphone's settings and for the
 * same reason: which webcam is on this desk, and what this uplink can carry,
 * are properties of where somebody is sitting rather than of their account.
 */
export interface CameraSettings extends QualityOverride {
  /** `null` is the system default camera, which is what most people want. */
  deviceId: string | null;
  quality: CameraQuality;
  /**
   * Mirror the *local preview* only.
   *
   * Never the sent picture. Seeing yourself un-mirrored is disconcerting -
   * every video app mirrors the self-view - but mirroring what is sent means
   * everybody else reads your writing backwards, and text held up to a camera
   * is the one thing a camera is used for that is not a face.
   */
  mirror: boolean;
  /**
   * Which filter is on the camera, by name - see `FILTERS` in
   * `camera-effects.ts`.
   *
   * A name rather than the filter string itself, because the strings are tuned
   * and a profile in local storage must not pin somebody to last month's
   * values. An unknown name resolves to no filter at all.
   */
  filter: string;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  ...NO_OVERRIDE,
  deviceId: null,
  quality: 'auto',
  mirror: true,
  filter: 'none',
};

/** The `getUserMedia({ video })` half. */
export interface CameraCapture {
  width: { ideal: number };
  height: { ideal: number };
  frameRate: { ideal: number; max: number };
  deviceId?: { exact: string };
}

/**
 * How a camera is encoded once it is on a sender. Applied in `mesh.ts`, the
 * same way `SharePublish` is.
 */
export interface CameraPublish {
  maxBitrate: number;
  maxFramerate: number;
  /** Send what was captured; congestion control still shrinks it when it must. */
  scaleResolutionDownBy: number;
  degradationPreference: RTCDegradationPreference;
  videoCodec: Exclude<CodecChoice, 'auto'>;
  contentHint: 'motion';
}

/**
 * The sizes worth offering, and what `auto` resolves to.
 *
 * A fixed ladder rather than a read of `getCapabilities()`. The capability list
 * is reported optimistically by several drivers - a webcam that advertises 4K
 * and delivers a 5 fps slideshow of it is a common enough failure that
 * believing the advertisement is worse than ignoring it - and every number here
 * is an `ideal` anyway, so a camera that cannot manage one lands on its nearest
 * real format rather than failing.
 *
 * `auto` is 720p because it is the size a webcam is actually good at: the
 * sensor in a laptop lid is a 720p sensor with an interpolated 1080p mode, and
 * asking for the larger one buys upscaled noise at twice the bitrate. Somebody
 * with a real camera can say `1080p` and get it.
 */
const LADDER: Record<Exclude<CameraQuality, 'auto'>, CameraSize> = {
  '360p': { width: 640, height: 360 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

const AUTO_SIZE = LADDER['720p'];

export function sizeFor(quality: CameraQuality): CameraSize {
  return quality === 'auto' ? AUTO_SIZE : LADDER[quality];
}

/** Thirty is what a webcam produces. Sixty is a webcam interpolating. */
export const CAMERA_FRAME_RATE = 30;

/** 1080p worth of pixels, the size the ceiling below is quoted against. */
const REFERENCE_PIXELS = 1920 * 1080;

/**
 * The ceiling at 1080p30, scaled by area from there.
 *
 * Well under the screen share's 20 Mbps, and deliberately: a share is a
 * megapixel of small sharp text where every edge costs bits, and a camera is a
 * face in a room, which is the single easiest thing a video encoder is ever
 * asked to do. 4 Mbps at 1080p is comfortably transparent for one; the same
 * number on a spreadsheet would not be.
 *
 * ponytail: one reference number for every camera. A face against a plain wall
 * and a face in front of a window full of moving leaves are not worth the same
 * bitrate, and only the encoder can tell them apart. If this proves too low for
 * busy scenes, `contentHint` and this constant are the two levers, in that
 * order.
 */
const REFERENCE_BITRATE = 4_000_000;

/**
 * Under this a face is blocky whatever the resolution says, and over it a
 * camera is spending bits on sensor noise. Both ends are far tighter than the
 * share's, which is the point of having separate ones.
 */
const MIN_BITRATE = 600_000;
const MAX_BITRATE = 8_000_000;

/**
 * A ceiling proportional to the pixels actually being sent.
 *
 * A ceiling and not a target, exactly as `bitrateFor` is for a share: a still
 * face spends a fraction of it and congestion control lowers it the instant the
 * link says so. Getting it wrong upwards costs nothing on a link that cannot
 * carry it; getting it wrong downwards is a permanently soft picture, which is
 * what `video: true` was.
 */
export function cameraBitrateFor(size: CameraSize): number {
  const pixels = Math.max(1, size.width * size.height);
  const scaled = Math.round((pixels / REFERENCE_PIXELS) * REFERENCE_BITRATE);
  return Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, scaled));
}

/**
 * Capture and publish options for the camera.
 *
 * `size` is the resolution actually granted, once it is known. It is optional
 * because it cannot be known before the capture exists: the first call asks for
 * the ladder's size, and the caller comes back with what `getSettings()` really
 * handed over. Asking for 1080p and publishing 720p at a 1080p ceiling is not
 * harmful, but the reverse - a 1080p capture published at a 360p ceiling -
 * is exactly the permanently soft picture this module exists to stop, and only
 * the second call can tell the difference.
 */
export function cameraOptions(
  settings: CameraSettings,
  size?: CameraSize,
): { capture: CameraCapture; publish: CameraPublish } {
  const asked = sizeFor(settings.quality);
  const real = size ?? asked;

  const frameRate = settings.frameRate ?? CAMERA_FRAME_RATE;
  // Clamped rather than trusted: a number typed into a box is the one input
  // here that has been through no arithmetic at all.
  const maxBitrate =
    settings.maxBitrate === null
      ? cameraBitrateFor(real)
      : Math.min(BITRATE_RANGE.max, Math.max(BITRATE_RANGE.min, settings.maxBitrate));

  return {
    capture: {
      width: { ideal: asked.width },
      height: { ideal: asked.height },
      // `ideal` with a `max`, never `exact`: a camera that cannot do 30 should
      // hand back 24 rather than refuse to open. The max stops a camera
      // volunteering 60, which costs the bitrate twice over and looks no better
      // on a face.
      frameRate: { ideal: frameRate, max: Math.max(frameRate, CAMERA_FRAME_RATE) },
      // `exact`, for the reason `deviceConstraint` in `voice-quality.ts` spells
      // out: a bare device id is advisory and Chromium ignores it, which is the
      // whole of "changing the camera does not change the camera". The silent
      // fallback that costs is bought back deliberately in `openVideoCapture`.
      ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}),
    },
    publish: {
      maxBitrate,
      maxFramerate: frameRate,
      scaleResolutionDownBy: 1,
      // The opposite of the share's `maintain-resolution`, and the module's
      // whole reason for existing separately. See the note at the top.
      degradationPreference: 'balanced',
      // H.264 for the same reason the share picks it: it is the one codec with
      // a hardware encoder on essentially every machine, and a camera encoded
      // in software is a laptop fan spinning up for the length of a call.
      videoCodec: settings.videoCodec === 'auto' ? 'H264' : settings.videoCodec,
      contentHint: 'motion',
    },
  };
}
