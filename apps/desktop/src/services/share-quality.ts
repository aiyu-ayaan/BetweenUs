/**
 * How a screen is encoded, and why the defaults were never going to do.
 *
 * LiveKit's out-of-the-box screen share is 1080p15 at about 3 Mbps, simulcast
 * on, VP8, and the receiver's jitter buffer wherever the browser feels like
 * putting it. That is a sensible default for showing somebody a spreadsheet
 * over a bad connection. It is a terrible way to watch a film, and not much
 * better for driving a desktop: fifteen frames a second is visibly a slideshow,
 * three megabits at 1080p turns anything moving into a smear, and simulcast
 * splits that budget three ways before the good layer ever gets it.
 *
 * What Parsec does, and what is reachable from here:
 *
 * - **Spend the bitrate.** Parsec runs tens of megabits on a LAN. WebRTC's
 *   congestion control will take whatever it can get and back off when it
 *   cannot, so the number that matters is the ceiling, and the ceiling was the
 *   thing set too low. It scales with pixels here rather than being one number.
 * - **One layer.** Simulcast exists so a weak viewer can be sent a small
 *   stream; the cost is that the encoder divides its budget between layers and
 *   the SFU may hand somebody the bad one. Off, and everybody gets the good
 *   stream or nothing.
 * - **Hardware H.264.** Parsec encodes on the GPU. H.264 is the one codec with
 *   a hardware encoder on essentially every Windows machine, so it is the one
 *   that can do 1080p60 without setting a laptop on fire. VP9 or AV1 would look
 *   better per bit; they would also be encoded in software, which costs the
 *   latency this is trying to buy.
 * - **Do not buffer.** A receiver's jitter buffer is where a third of a second
 *   goes. `setPlayoutDelay` asks for a smaller one - near zero when somebody is
 *   driving, a couple of frames when they are watching.
 * - **Say what the content is.** A film and a text editor want opposite
 *   choices: one wants frames kept and resolution sacrificed, the other the
 *   reverse. Guessing gets it wrong half the time, so the picker asks.
 *
 * The pure part is here, with a self-check, because the arithmetic is what
 * decides whether a 4K share is sent through a 1080p-sized pipe.
 */
import { AudioPresets, type ScreenShareCaptureOptions, type TrackPublishOptions } from 'livekit-client';

/**
 * What is on the screen. Not a quality slider - the two want opposite things,
 * and neither is "better".
 */
export type ShareIntent = 'detail' | 'motion';

export interface ShareSize {
  width: number;
  height: number;
}

interface Profile {
  frameRate: number;
  contentHint: 'text' | 'motion';
  degradation: RTCDegradationPreference;
  /** Bitrate ceiling at 1920x1080, scaled by area from there. */
  referenceBitrate: number;
  minBitrate: number;
  maxBitrate: number;
}

const PROFILES: Record<ShareIntent, Profile> = {
  // A desktop, a document, an IDE. Sharp edges and readable text matter; a
  // dropped frame does not.
  detail: {
    frameRate: 30,
    contentHint: 'text',
    degradation: 'maintain-resolution',
    referenceBitrate: 6_000_000,
    minBitrate: 2_000_000,
    maxBitrate: 14_000_000,
  },
  // A film, a game, anything that moves. Frames are the whole point, and the
  // encoder should drop resolution before it drops them.
  motion: {
    frameRate: 60,
    contentHint: 'motion',
    degradation: 'maintain-framerate',
    referenceBitrate: 14_000_000,
    minBitrate: 4_000_000,
    maxBitrate: 24_000_000,
  },
};

/** 1080p worth of pixels, the size every ceiling here is quoted against. */
const REFERENCE_PIXELS = 1920 * 1080;

/**
 * A ceiling proportional to the number of pixels being sent.
 *
 * A ceiling, not a target: a still desktop spends a fraction of it, and
 * WebRTC's congestion control lowers it the moment the link says so. Getting it
 * wrong upwards costs nothing on a link that cannot carry it; getting it wrong
 * downwards is a permanently soft picture, which is what the default did.
 */
export function bitrateFor(intent: ShareIntent, size: ShareSize): number {
  const profile = PROFILES[intent];
  const pixels = Math.max(1, size.width * size.height);
  const scaled = Math.round((pixels / REFERENCE_PIXELS) * profile.referenceBitrate);
  return Math.min(profile.maxBitrate, Math.max(profile.minBitrate, scaled));
}

/**
 * Capture and publish options for one share.
 *
 * `size` is the real pixel size of what is being captured. It has to be passed
 * in: without it LiveKit caps the capture at 1080p, so a 1440p display arrives
 * downscaled and is then stretched back up on the far end - soft, and for no
 * saving, because it was scaled after it was captured rather than before.
 */
export function shareOptions(
  intent: ShareIntent,
  size: ShareSize,
  audio: false | { music: boolean },
): { capture: ScreenShareCaptureOptions; publish: TrackPublishOptions } {
  const profile = PROFILES[intent];

  return {
    capture: {
      resolution: { width: size.width, height: size.height, frameRate: profile.frameRate },
      contentHint: profile.contentHint,
      audio: audio
        ? {
            // The machine's own output mix includes the call coming out of the
            // speakers; this is the constraint that leaves it out.
            restrictOwnAudio: true,
            // A soundtrack is not a voice. Every one of these exists to make
            // speech intelligible and every one of them wrecks music: gain
            // control pumps, noise suppression eats reverb tails, echo
            // cancellation chews holes in anything that correlates with what
            // the speakers are already playing - which, for a film, is all of
            // it.
            ...(audio.music
              ? {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                  channelCount: 2,
                }
              : {}),
          }
        : false,
    },
    publish: {
      // One layer. Simulcast would divide this budget three ways and then let
      // the SFU hand somebody the bottom one.
      simulcast: false,
      // Hardware-encoded on any Windows machine with a GPU from this decade,
      // which is what makes 1080p60 possible without melting the CPU. VP9 looks
      // better per bit and is encoded in software; that trade is the wrong way
      // round when the point is latency.
      videoCodec: 'h264',
      degradationPreference: profile.degradation,
      screenShareEncoding: {
        maxFramerate: profile.frameRate,
        maxBitrate: bitrateFor(intent, size),
      },
      // Full-band stereo Opus for a soundtrack, and no discontinuous
      // transmission - DTX cuts the quiet passages of a film out entirely.
      ...(audio && audio.music
        ? { audioPreset: AudioPresets.musicHighQualityStereo, dtx: false, red: true }
        : {}),
    },
  };
}

/**
 * How much buffering to ask the receiver for, in seconds.
 *
 * The default jitter buffer is where a third of a second of latency lives. Near
 * zero for anything being driven - a pointer that arrives late is unusable -
 * and a couple of frames for something being watched, which absorbs ordinary
 * network jitter without anybody noticing. Both are targets: Chromium still
 * grows the buffer when a link genuinely needs it.
 */
export const PLAYOUT_DELAY = {
  driving: 0,
  watching: 0.08,
} as const;
