/**
 * How a screen is encoded, and why the defaults were never going to do.
 *
 * An out-of-the-box screen share is 1080p15 at about 3 Mbps, VP8, and the
 * receiver's jitter buffer wherever the browser feels like
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
 * - **One layer.** Simulcast exists so a server can forward a small stream to a
 *   weak viewer; the cost is that the encoder divides its budget between
 *   layers. There is no server to do the choosing any more, so there is nothing
 *   to choose between: one encoding, and congestion control adapts it.
 * - **Hardware H.264.** Parsec encodes on the GPU. H.264 is the one codec with
 *   a hardware encoder on essentially every Windows machine, so it is the one
 *   that can do 1080p60 without setting a laptop on fire. VP9 or AV1 would look
 *   better per bit; they would also be encoded in software, which costs the
 *   latency this is trying to buy.
 * - **Do not buffer.** A receiver's jitter buffer is where a third of a second
 *   goes. `RTCRtpReceiver.playoutDelayHint` asks for a smaller one - near zero
 *   when somebody is driving, a couple of frames when they are watching.
 * - **Never spend the resolution.** Parsec does not scale the picture down; it
 *   holds the pixels and lets quantisation, and then the frame rate, take the
 *   hit. Both profiles here do the same, because a quarter-size picture
 *   stretched back up is the one failure a viewer cannot un-see. What the
 *   content changes is the bitrate it is worth and the soundtrack it carries,
 *   not whether the pixels survive.
 *
 * The pure part is here, with a self-check, because the arithmetic is what
 * decides whether a 4K share is sent through a 1080p-sized pipe.
 */

import type { EncoderKind } from './call-stats';

/**
 * Constraints for `getDisplayMedia`.
 *
 * `restrictOwnAudio` is Electron's, and is not in the DOM types; the rest are
 * ordinary audio constraints applied to the system-audio track.
 */
export interface ShareCapture {
  video: { width: number; height: number; frameRate: number };
  contentHint: ShareContentHint;
  audio:
    | false
    | (MediaTrackConstraints & { restrictOwnAudio?: boolean });
}

/**
 * How a share is encoded once it is on a sender. Applied in `mesh.ts`:
 * `maxBitrate` and `degradationPreference` on the sender's parameters, the
 * codec through `setCodecPreferences`, and the audio options in the SDP.
 */
export interface SharePublish {
  maxBitrate: number;
  maxFramerate: number;
  /**
   * The size actually being captured, which is the pixel count every number
   * here is quoted against.
   *
   * Carried on the publish rather than looked up because `adaptShare` needs it
   * and runs per link, a second at a time, long after the capture was resolved.
   * A resolution budget computed against the wrong size is the whole failure it
   * exists to prevent.
   */
  captured: ShareSize;
  /** Where the ladder starts: full size, until a reading says it cannot be. */
  scaleResolutionDownBy: number;
  /** A share is the call's primary visual media, not background video. */
  priority: RTCPriorityType;
  degradationPreference: RTCDegradationPreference;
  /**
   * Preferred video codec, by MIME subtype. Ignored when unavailable, which is
   * why a forced one is a preference and not a promise: a machine with no AV1
   * encoder gets whatever it does have rather than a failed share.
   */
  videoCodec: Exclude<CodecChoice, 'auto'>;
  audio: false | { maxBitrate: number; stereo: boolean; dtx: boolean; red: boolean };
  /**
   * What encoder this machine was expected to have when the share started -
   * `probeShareEncoder`'s answer, or null when it had none. The sender's own
   * statistics replace it once they say. See `shareBudget`.
   */
  encoder: EncoderKind | null;
  /**
   * Whether the frame rate is the app's to lower for a software encoder. False
   * once somebody has picked a frame rate by hand: they asked for that number.
   */
  adaptsToEncoder: boolean;
}

/** Full-band stereo Opus, the ceiling a soundtrack is worth. */
const MUSIC_BITRATE = 510_000;

/**
 * What is on the screen. Not a quality slider - it decides what the picture is
 * worth in bits and whether the sound is a soundtrack, and neither answer is
 * "better". Neither one gives up resolution; see `PROFILES`.
 */
export type ShareIntent = 'detail' | 'motion';

/**
 * What the encoder is told it is looking at.
 *
 * Both values are *screencast* hints, and that is the point. Chromium turns a
 * track's content hint into libwebrtc's `is_screencast`, and `is_screencast`
 * decides two things that matter more than any number in this file:
 *
 * - **Periodic ALR probing.** `VideoSendStreamImpl` enables it only for screen
 *   content. Without it, a send-side bandwidth estimate that collapsed during a
 *   bad minute has no way back up while the encoder is application-limited -
 *   the estimator only learns what the link can carry from traffic it actually
 *   sent, and a 4 fps slideshow sends nothing worth learning from. That is the
 *   whole of "it went soft and never came back": not a link that stayed bad, a
 *   link that recovered while the estimate did not.
 * - **The quality scaler.** Armed when `is_screencast` is false, and its
 *   resolution half is exactly what `maintain-resolution` is asking it not to
 *   do. Two mechanisms pulling opposite ways on the same picture.
 *
 * So `motion` - the DOM hint for a film - is the one value a screen share must
 * never carry, however well it describes the content. `detail` is the
 * photographic screencast hint and is what a film or a game gets instead.
 */
export type ShareContentHint = 'text' | 'detail';

/** Codecs worth offering by name. `auto` keeps the profile's own preference. */
export type CodecChoice = 'auto' | 'H264' | 'VP9' | 'VP8' | 'AV1';

/**
 * How tall a share may be captured, before anything is encoded.
 *
 * Everything else in this file is a ceiling on *bits*. This is a ceiling on
 * *pixels*, and it is the only one that can be spent before the encoder or the
 * link ever sees the frame - which is why it was the thing missing.
 *
 * A share used to be captured at the display's native size, whatever that was.
 * On a 1440p or 4K monitor that is a hardware encoder asked for 3.7 or 8.3
 * megapixels sixty times a second and a link asked for 60-80 Mbit, and neither
 * consumer hardware nor a home uplink has ever carried it. What comes out is
 * `qualityLimitationReason: cpu` or `bandwidth`, a frame rate in single
 * figures, and a picture that looks broken on a connection with nothing wrong
 * with it. Capturing smaller is not a worse share; it is the share the machine
 * can actually produce.
 *
 * 1080p by default because it is the size a hardware H.264 encoder does at 60
 * fps without noticing, and because everything above it is a choice somebody
 * should make deliberately on a link they know can carry it.
 */
export const DEFAULT_MAX_HEIGHT = 1080;

/**
 * The ceilings worth offering, tallest first. `null` is the display's own size,
 * which is the only honest way to say "as much as this monitor has" - a number
 * would be wrong on the next monitor.
 */
export const MAX_HEIGHTS = [null, 2160, 1440, 1080, 720] as const;

/**
 * What somebody has decided the ladder got wrong.
 *
 * Everything above this line is inferred: the bitrate is scaled from the pixel
 * count, the codec is chosen for having a hardware encoder, and congestion
 * control takes it from there. That is right on a link nobody can describe -
 * and it is exactly wrong on the one link somebody *can*. A LAN has no
 * congestion to infer from, so the estimator finds the ceiling slowly and by
 * degrading first; a metered connection has the opposite problem, and there was
 * no way to say either.
 *
 * Null means "let the ladder decide", which is what every field is until
 * somebody says otherwise. Nothing here is remembered per call: it is a
 * property of the machine and the network it is on.
 */
export interface QualityOverride {
  /** Ceiling in bits per second. */
  maxBitrate: number | null;
  /** Capture and publish rate, in frames per second. */
  frameRate: number | null;
  videoCodec: CodecChoice;
  /**
   * The tallest picture to capture, in lines, or `null` for the display's own
   * size. See [DEFAULT_MAX_HEIGHT] for why the default is not `null`.
   */
  maxHeight: number | null;
}

export const NO_OVERRIDE: QualityOverride = {
  maxBitrate: null,
  frameRate: null,
  videoCodec: 'auto',
  maxHeight: DEFAULT_MAX_HEIGHT,
};

/**
 * The usable ends of a manual bitrate, in bits per second.
 *
 * Under a megabit a screen share is not a screen share, and over a hundred is
 * past what any encoder on a consumer machine will produce - the number would
 * be accepted, ignored by the encoder, and look like a setting that does
 * nothing.
 */
export const BITRATE_RANGE = { min: 1_000_000, max: 100_000_000 } as const;

/** Frame rates worth offering. Anything between them is a slider nobody needs. */
export const FRAME_RATES = [15, 24, 30, 60] as const;

export interface ShareSize {
  width: number;
  height: number;
}

/**
 * The size to capture at: the display's own, held to whatever ceiling somebody
 * set, and never enlarged past it.
 *
 * A ceiling and not a target, in both directions. A 900p laptop panel with the
 * 1080p default captures at 900p - asking a display for more lines than it has
 * is an upscale, which costs bitrate to carry pixels that were invented. And
 * the aspect ratio is the display's, kept exactly, because a share that arrives
 * the wrong shape is the one failure nobody can look past.
 *
 * Both dimensions come back even. Every H.264 encoder in existence works in
 * 16x16 macroblocks and an odd dimension is rounded somewhere out of sight;
 * doing it here means the number this file quotes a bitrate against is the
 * number the encoder is actually given.
 */
export function cappedSize(native: ShareSize, maxHeight: number | null): ShareSize {
  const width = Math.max(2, Math.round(native.width));
  const height = Math.max(2, Math.round(native.height));
  if (maxHeight === null || height <= maxHeight) return { width: even(width), height: even(height) };

  const scale = maxHeight / height;
  return { width: even(Math.round(width * scale)), height: even(maxHeight) };
}

/** Down to the nearest even number, never below 2. */
function even(value: number): number {
  return Math.max(2, value - (value % 2));
}

/**
 * The `video` half of `getDisplayMedia`, from a resolved capture.
 *
 * It exists because there are two callers - a share in a call and a remote
 * session - and both used to write the constraint out by hand with a `max` of
 * `Math.max(3840, width)` beside an `ideal` of the real size. That `max` is
 * what made the ceiling above advisory: `ideal` is a preference Chromium scores
 * and is free to miss, so a 4K display asked for 1080p `ideal` / 4K `max`
 * happily hands back 4K, and the setting reads as one that does nothing. The
 * ceiling is the `max`, which is the only constraint form that is not a wish.
 *
 * A window smaller than the ceiling is unaffected: `max` never enlarges
 * anything, and `ideal` on a surface that cannot meet it is simply missed.
 */
export function captureConstraints(capture: ShareCapture): MediaTrackConstraints {
  return videoConstraints(capture.video, capture.video.frameRate);
}

/**
 * The same constraints for a size and a rate, for `applyConstraints` on a
 * capture that is already running. `applyConstraints` replaces the whole set,
 * so the size has to go with the rate or the ceiling on it is lost.
 */
export function videoConstraints(size: ShareSize, frameRate: number): MediaTrackConstraints {
  return {
    width: { ideal: size.width, max: size.width },
    height: { ideal: size.height, max: size.height },
    frameRate: { ideal: frameRate, max: frameRate },
  };
}

interface Profile {
  frameRate: number;
  contentHint: ShareContentHint;
  degradation: RTCDegradationPreference;
  /** Bitrate ceiling at 1920x1080, scaled by area from there. */
  referenceBitrate: number;
  minBitrate: number;
  maxBitrate: number;
}

/**
 * Both profiles hold the resolution, and the ladder is what spends it.
 *
 * There are only two degradation preferences worth having and each one, alone,
 * is a way for a share to collapse - this setting has now been wrong in both
 * directions, so both are written down.
 *
 * `maintain-framerate` gives up pixels and lets WebRTC's own adapter decide how
 * many, in 1.5x/2x/3x/4x steps off an estimate it is still finding. A 1440p
 * share walked down to 480p within seconds and stayed there.
 *
 * `maintain-resolution` holds the size and drops frames, with no floor: on a
 * 405 kbps link that is 1080p at 2 fps.
 *
 * The fix for the second was not the first. Asking for `maintain-framerate`
 * while `ShareLadder` was *also* scaling the picture put two independent
 * scalers on one frame, and they multiplied - a loopback share the ladder had
 * already halved to 960x540 arrived at 660x350. Two things spending the same
 * resource is worse than either one spending it badly.
 *
 * So resolution has exactly one owner. `maintain-resolution` keeps WebRTC's
 * adapter off it, and `ShareLadder` steps it down when - and only when - the
 * encoder reports it is bandwidth-limited *and* the frame rate has actually
 * collapsed. A quiet share and a healthy share both leave it alone, which is
 * why a still screen at 4 fps no longer costs anybody any pixels.
 *
 * The hint on `motion` is `detail`, not `motion`, and that is deliberate - see
 * `ShareContentHint`. `motion` is the honest description of a film and it also
 * switches off the one mechanism that lifts a collapsed bandwidth estimate back
 * up, which cost more than an accurate label was ever worth.
 */
const PROFILES: Record<ShareIntent, Profile> = {
  // A desktop, a document, an IDE. Sharp edges and readable text matter.
  detail: {
    frameRate: 60,
    contentHint: 'text',
    degradation: 'maintain-resolution',
    referenceBitrate: 20_000_000,
    minBitrate: 8_000_000,
    maxBitrate: 50_000_000,
  },
  // A film, a game, anything that moves.
  motion: {
    frameRate: 60,
    contentHint: 'detail',
    degradation: 'maintain-resolution',
    referenceBitrate: 35_000_000,
    minBitrate: 15_000_000,
    maxBitrate: 80_000_000,
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
 * `size` is the real pixel size of what is being captured. It has to be asked
 * for: the default caps a capture at 1080p, so a 1440p display arrives
 * downscaled and is then stretched back up on the far end - soft, and for no
 * saving, because it was scaled after it was captured rather than before.
 */
export function shareOptions(
  intent: ShareIntent,
  size: ShareSize,
  audio: false | { music: boolean },
  override: QualityOverride = NO_OVERRIDE,
  encoder: EncoderKind | null = null,
): { capture: ShareCapture; publish: SharePublish } {
  const profile = PROFILES[intent];
  // Clamped rather than trusted: a number typed into a box is the one input
  // here that has not been through any arithmetic at all.
  const frameRate = override.frameRate ?? profile.frameRate;
  // Before the bitrate, and that ordering is the whole point: the ceiling is
  // quoted against the pixels that are actually sent. Scaling the picture down
  // and then sizing the pipe for the picture that was not sent is how a 1080p
  // share ends up carrying a 4K share's bitrate - or, the way round that
  // actually bites, how a capped share keeps a ceiling it can never reach.
  const captured = cappedSize(size, override.maxHeight);
  const maxBitrate =
    override.maxBitrate === null
      ? bitrateFor(intent, captured)
      : Math.min(BITRATE_RANGE.max, Math.max(BITRATE_RANGE.min, override.maxBitrate));

  // Captured at the rate a software encoder will be held to, not at the rate
  // it would then throw away: every frame grabbed off the screen is a copy and
  // a colour conversion on the CPU before the encoder ever sees it. The
  // publish keeps the full rate so a sender that turns out to be hardware can
  // be given it back. See `shareBudget`.
  const adaptsToEncoder = override.frameRate === null;
  const captureRate =
    adaptsToEncoder && encoder === 'software' ? Math.min(frameRate, SOFTWARE_FRAME_RATE) : frameRate;

  return {
    capture: {
      video: { width: captured.width, height: captured.height, frameRate: captureRate },
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
      maxFramerate: frameRate,
      maxBitrate,
      captured,
      scaleResolutionDownBy: 1,
      priority: 'high',
      degradationPreference: profile.degradation,
      // Hardware-encoded on any Windows machine with a GPU from this decade,
      // which is what makes 1080p60 possible without melting the CPU. VP9 looks
      // better per bit and is encoded in software; that trade is the wrong way
      // round when the point is latency.
      videoCodec: override.videoCodec === 'auto' ? 'H264' : override.videoCodec,
      // Full-band stereo Opus for a soundtrack, and no discontinuous
      // transmission - DTX cuts the quiet passages of a film out entirely.
      audio:
        audio && audio.music
          ? { maxBitrate: MUSIC_BITRATE, stereo: true, dtx: false, red: true }
          : false,
      encoder,
      adaptsToEncoder,
    },
  };
}

// --- The software-encoder budget -------------------------------------------
//
// Every number above assumes the GPU is doing the encoding. On Windows it
// nearly always is. On Linux it very often is not: Chromium has no NVENC path
// at all, and on a PRIME laptop running on its NVIDIA card VA-API never
// reaches the Intel encoder either, so the share lands on OpenH264. Measured on
// such a laptop, a software H.264 share of scrolling text costs about 2.5x as
// much at 60 fps as at 30, and each extra viewer is another whole encoder.
//
// The ladder does not help with this. It moves when the encoder is *failing*
// - `cpu` next to a collapsed frame rate - and a software encoder on a fast
// machine does not fail, it just keeps a core busy for the whole call. So a
// share that knows its encoder is software starts inside a budget instead of
// waiting to fall over.

/** The frame rate a software encoder is held to, unless one was picked by hand. */
export const SOFTWARE_FRAME_RATE = 30;

/**
 * The height a software encoder is held to once more than one person is
 * watching, which is more than one encoder running. 720p is where OpenH264
 * costs about a third of 1080p and text is still readable.
 */
export const SOFTWARE_SHARED_HEIGHT = 720;

/** What the encoder may be asked for, before the ladder spends anything. */
export interface ShareBudget {
  frameRate: number;
  scaleResolutionDownBy: number;
}

/**
 * The budget a share is sent within, for the encoder it has and the number of
 * people it is being encoded for.
 *
 * Hardware, or not known, is no budget: the profile as asked for. Software is
 * held to `SOFTWARE_FRAME_RATE` unless the frame rate was chosen by hand, and
 * to `SOFTWARE_SHARED_HEIGHT` once two or more people have joined - resolution
 * is what makes a share worth watching, so it is only spent when the cost of
 * keeping it is multiplied.
 */
export function shareBudget(
  publish: SharePublish,
  encoder: EncoderKind | null,
  watchers: number,
): ShareBudget {
  if (encoder !== 'software' || !publish.adaptsToEncoder) {
    return { frameRate: publish.maxFramerate, scaleResolutionDownBy: 1 };
  }
  const height = publish.captured.height;
  return {
    frameRate: Math.min(publish.maxFramerate, SOFTWARE_FRAME_RATE),
    scaleResolutionDownBy:
      watchers >= 2 && height > SOFTWARE_SHARED_HEIGHT ? height / SOFTWARE_SHARED_HEIGHT : 1,
  };
}

/**
 * Whether this machine can encode a share on its GPU, asked before the capture
 * starts so a software share is captured at the rate it will be sent at.
 *
 * `powerEfficient` is the Media Capabilities answer for WebRTC, and it is the
 * same question `powerEfficientEncoder` answers on a live sender. Null when the
 * API is missing or will not say; the sender's statistics decide then.
 */
export async function probeShareEncoder(
  codec: SharePublish['videoCodec'],
  size: ShareSize,
  frameRate: number,
  bitrate: number,
): Promise<EncoderKind | null> {
  try {
    const info = await navigator.mediaCapabilities.encodingInfo({
      type: 'webrtc',
      video: {
        contentType: `video/${codec}`,
        width: size.width,
        height: size.height,
        framerate: frameRate,
        bitrate,
      },
    });
    if (!info.supported) return null;
    return info.powerEfficient ? 'hardware' : 'software';
  } catch {
    return null;
  }
}

/**
 * The most a share may ask for when TURN is in the path.
 *
 * Every other ceiling in this file is sized for a direct link between two
 * machines, where the only limits are the two uplinks and there is no third
 * party paying for anything. A relayed pair is a different problem: the media
 * goes up to the relay and back down, so one share costs the relay *twice* its
 * bitrate, and a relay is a small VM on somebody's bill rather than a fabric.
 * Pointing a 35-80 Mbit share at one does not produce a 35-80 Mbit share. It
 * produces loss, the estimator reads loss as a link that cannot carry
 * anything, and the share collapses to a slideshow - on a connection that would
 * have carried a perfectly good 8 Mbit picture all day.
 *
 * So this is the fix for "the relay is not being used properly": it was being
 * used, at a bitrate no relay was ever going to carry. 8 Mbit is well above
 * what 1080p60 H.264 needs to look clean and well inside what a modest VM can
 * forward, and it only ever applies to the links that are actually relayed -
 * in a mesh, one peer may be direct and the next one not.
 */
export const RELAY_MAX_BITRATE = 8_000_000;

/**
 * A share's ceiling for one link, given whether that link goes through a relay.
 *
 * Never raises anything: a manual ceiling below the relay limit stays where
 * somebody put it.
 */
export function ceilingFor(publish: SharePublish, relayed: boolean): number {
  return relayed ? Math.min(publish.maxBitrate, RELAY_MAX_BITRATE) : publish.maxBitrate;
}

// --- The resolution ladder -------------------------------------------------
//
// Everything above this line is a ceiling decided before the share starts. None
// of it can know what the link turned out to carry, and a ceiling is not a plan
// for missing it: the encoder is handed 1080p60 and 20 Mbit, the link delivers
// 400 kbit, and `maintain-resolution` answers by holding the size and dropping
// frames as far as it takes - 1080p at 2 fps.
//
// This is what does the answering instead, and the shape of it is the whole
// lesson of getting it wrong twice.
//
// **It does not budget.** The first version of this computed the resolution a
// measured `availableOutgoingBitrate` could carry and applied it. That is wrong
// in a way that looks right in arithmetic and is disastrous in practice,
// because *`availableOutgoingBitrate` is not the link's capacity*. It is the
// congestion controller's estimate, the estimate only grows by probing with
// real traffic, and an encoder with nothing to send never produces any. A
// static screen share - a terminal nobody is typing in - sends a few kbps, so
// the estimate sits at `START_KBPS` forever. Budgeting against it halved a
// loopback share to 960x540, and a smaller picture sends even less, so the
// estimate could never climb back out. That is a ratchet, and hysteresis does
// not save you from it: the climb needs readings of headroom, and headroom
// never appears because the content was never the thing sending.
//
// **So it reacts, and only to a failure it can see.** The encoder says why it
// is limited - `qualityLimitationReason` - and that is the one signal that
// separates "the link cannot carry this" from "there is nothing to send". The
// ladder moves only on `bandwidth`, and only when the frame rate has actually
// collapsed. On a healthy share, and on a quiet one, it does nothing at all and
// the share is exactly what the profile asked for.

/**
 * Frame rates a share will hold, best first.
 *
 * 24 is the floor because it is the rate film has used for a century: below it
 * motion stops reading as motion and starts reading as a slideshow, which is
 * the failure being fixed, just slower.
 */
export const FRAME_TIERS = [60, 30, 24] as const;

/**
 * The frame rate below which a share has stopped being a share.
 *
 * Not a target - a target would be read off a quiet screen and acted on. This
 * is the threshold for "the encoder wanted to send more and could not", and it
 * only ever gets consulted alongside a `bandwidth` limitation.
 */
const COLLAPSED_FPS = 20;

/**
 * The resolution steps the ladder walks, as `scaleResolutionDownBy`.
 *
 * Discrete, and coarse on purpose. A continuous scale computed per tick is what
 * the budgeting version did, and every recomputation is a keyframe: the steps
 * exist so a struggling share settles on one of four answers instead of
 * hunting. 1080p through these is 1080p, 720p, 540p, 360p.
 */
const SCALE_STEPS = [1, 1.5, 2, 3] as const;

/**
 * Consecutive readings before the ladder moves, in each direction.
 *
 * Down needs fewer than up. A share that has collapsed is already unwatchable,
 * so waiting is more of the bug; a share that recovered has to prove it,
 * because the estimate rises by probing and the first good reading is the probe
 * rather than the link.
 */
const SHRINK_TICKS = 2;
const CLIMB_TICKS = 6;

export interface ShareAdaptation {
  frameRate: number;
  scaleResolutionDownBy: number;
}

/** What the sender says about itself, per tick. See `ShareLadder.step`. */
export interface ShareReading {
  /** `qualityLimitationReason` on the outbound stream. */
  limitedBy: 'bandwidth' | 'cpu' | 'other' | null;
  /** `framesPerSecond` actually leaving the encoder, when it reports one. */
  framesPerSecond: number | null;
}

/**
 * Whether a reading is evidence that the link cannot carry the picture.
 *
 * Both halves are required and that is the entire point. `bandwidth` alone is
 * reported transiently on shares that are completely fine, and a low frame rate
 * alone is the normal state of a screen nobody is touching - a capturer only
 * emits a frame when pixels change, so a still terminal at 4 fps and 5 kbps is
 * not a fault, it is a correct answer that the first version of this read as
 * one.
 */
export function isStarved(reading: ShareReading): boolean {
  if (reading.limitedBy !== 'bandwidth') return false;
  if (reading.framesPerSecond === null) return false;
  return reading.framesPerSecond < COLLAPSED_FPS;
}

/**
 * Whether a reading is evidence that the *encoder*, not the link, cannot keep
 * up - a software codec on a hot laptop asked for more pixels than its CPU can
 * turn into frames sixty times a second. This wants the opposite fix from
 * `isStarved`: a share holds its pixels because that is what makes it worth
 * reading, so a CPU-bound share gives up frames first, walking `FRAME_TIERS`
 * down.
 *
 * Frames alone are not always enough. A machine that cannot encode 1080p at 24
 * fps - a software encoder on a laptop that is also decoding an 8K video, the
 * very thing being shared - is left at the floor with the encoder still handed
 * 1080p, and `maintain-resolution` answers that by dropping frames as far as it
 * takes: 1080p at 1 fps, with the ladder stopped because it had nothing left
 * to spend. So once the frame tiers are gone, the cpu axis spends pixels too,
 * on an index of its own; see `ShareLadder`.
 */
export function isCpuStarved(reading: ShareReading): boolean {
  if (reading.limitedBy !== 'cpu') return false;
  if (reading.framesPerSecond === null) return false;
  return reading.framesPerSecond < COLLAPSED_FPS;
}

/**
 * One link's position on the ladder, over time.
 *
 * Independent axes, each with its own index and its own reason to move.
 * `isStarved` (bandwidth) owns one index into `SCALE_STEPS`; `isCpuStarved`
 * (cpu) owns `FRAME_TIERS` and, once those are spent, a second index into
 * `SCALE_STEPS`. The picture is published at whichever scale index is further
 * down, so neither axis ever undoes the other's step: that is what keeps this
 * from being the two-scalers-on-one-picture bug, where two controllers fought
 * over one number.
 *
 * The cpu axis climbs back in the reverse of the order it fell - pixels first,
 * because they were spent last - and only on a reading where the encoder has
 * stopped saying `cpu` at all. A share that recovered to 25 fps at 540p while
 * still cpu-limited is exactly where it should be; climbing on it is a keyframe
 * every few seconds as it falls straight back down.
 */
export class ShareLadder {
  private step_ = 0;
  private frameStep_ = 0;
  private cpuScaleStep_ = 0;
  private starved = 0;
  private healthy = 0;
  private cpuStarved = 0;
  private cpuHealthy = 0;

  /** Where the ladder is, or null while it is at the top and has never moved. */
  get position(): ShareAdaptation | null {
    return this.step_ === 0 && this.frameStep_ === 0 && this.cpuScaleStep_ === 0
      ? null
      : { frameRate: this.frameRate, scaleResolutionDownBy: this.scale };
  }

  /** The scale to publish at: the further down of the two axes. 1 while nothing has gone wrong. */
  get scale(): number {
    return SCALE_STEPS[Math.max(this.step_, this.cpuScaleStep_)]!;
  }

  /** The frame rate to publish at. The profile's own rate while nothing has gone wrong. */
  get frameRate(): number {
    return FRAME_TIERS[this.frameStep_]!;
  }

  /**
   * One reading. Returns true when the share should be re-published, which is
   * only on a real move - a `setParameters` per second is a keyframe per second.
   */
  step(reading: ShareReading): boolean {
    if (isStarved(reading)) {
      this.healthy = 0;
      if (++this.starved < SHRINK_TICKS) return false;
      this.starved = 0;
      if (this.step_ >= SCALE_STEPS.length - 1) return false;
      this.step_ += 1;
      return true;
    }

    if (isCpuStarved(reading)) {
      this.cpuHealthy = 0;
      if (++this.cpuStarved < SHRINK_TICKS) return false;
      this.cpuStarved = 0;
      if (this.frameStep_ < FRAME_TIERS.length - 1) {
        this.frameStep_ += 1;
        return true;
      }
      if (this.cpuScaleStep_ < SCALE_STEPS.length - 1) {
        this.cpuScaleStep_ += 1;
        return true;
      }
      return false;
    }

    this.starved = 0;
    this.cpuStarved = 0;

    let moved = false;

    // Nothing to climb back from, which is the ordinary case: the ladder spends
    // almost every call at the top doing nothing.
    if (this.step_ !== 0) {
      // A quiet share is not a recovered one, but it is not a reason to stay
      // shrunk either - there is no evidence left that the link is the
      // problem, and the only way to find out is to try a bigger picture.
      if (++this.healthy >= CLIMB_TICKS) {
        this.healthy = 0;
        this.step_ -= 1;
        moved = true;
      }
    } else {
      this.healthy = 0;
    }

    if ((this.frameStep_ !== 0 || this.cpuScaleStep_ !== 0) && reading.limitedBy !== 'cpu') {
      if (++this.cpuHealthy >= CLIMB_TICKS) {
        this.cpuHealthy = 0;
        if (this.cpuScaleStep_ !== 0) this.cpuScaleStep_ -= 1;
        else this.frameStep_ -= 1;
        moved = true;
      }
    } else {
      this.cpuHealthy = 0;
    }

    return moved;
  }

  /** A new capture starts at the top; nothing is known about it yet. */
  reset(): void {
    this.step_ = 0;
    this.frameStep_ = 0;
    this.cpuScaleStep_ = 0;
    this.starved = 0;
    this.healthy = 0;
    this.cpuStarved = 0;
    this.cpuHealthy = 0;
  }
}

/**
 * Where congestion control begins, in kbps.
 *
 * WebRTC's own default is about 300 kbps, which is the several blurry seconds
 * at the start of every share. This is a fast start, not a guess at the link:
 * the estimator has to survive its first probe, and a probe the path cannot
 * absorb is answered with loss, which collapses the estimate far below where it
 * would have climbed on its own.
 */
const START_KBPS = 2_500;

/** Video payload types with no encoder behind them. See `patchVideoBandwidth`. */
const NOT_A_PICTURE = new Set(['rtx', 'red', 'ulpfec', 'flexfec-03']);

/**
 * Patches SDP with an explicit video bandwidth ceiling (`b=AS`, `b=TIAS`) and
 * codec bitrate hints (`x-google-start-bitrate`, `x-google-max-bitrate`).
 *
 * Every number here is a ceiling or a starting point. Neither is a floor, and
 * the earlier `x-google-min-bitrate` was: a quarter of the ceiling, so 12.5 Mbps
 * on the 50 Mbps default this is called with at negotiation time - a minimum
 * the encoder was told to meet on links that were never going to carry it. An
 * encoder made to meet a bitrate floor pays for it in pixels, because 640x480 at
 * 12.5 Mbps is reachable and 1920x1080 is not. Paired with a start bitrate of
 * 60% of the ceiling - 30 Mbps, blown at a link in its first second - that is a
 * share which knocks over its own estimate and then sits at 480p on a good
 * network, which is the bug this replaced.
 *
 * The real ceiling is applied per sender by `PeerLink.tune`, which needs no
 * renegotiation and so is the one that sees the share's own profile. This is
 * only here to stop the estimator crawling.
 */
export function patchVideoBandwidth(sdp: string, publish?: SharePublish | null): string {
  const bitrate = publish?.maxBitrate ?? 50_000_000;
  const maxKbps = Math.round(bitrate / 1000);
  const startKbps = Math.min(maxKbps, START_KBPS);
  const tiasBps = bitrate;

  const sections = sdp.split(/(?=m=)/g);
  const patched = sections.map((section) => {
    if (!section.startsWith('m=video')) return section;

    let mediaSection = section;

    // 1. Ensure b=AS and b=TIAS bandwidth attributes are set for the video m-line
    mediaSection = mediaSection.replace(/b=AS:\d+\r?\n/gi, '');
    mediaSection = mediaSection.replace(/b=TIAS:\d+\r?\n/gi, '');

    // Insert b= lines after c= line or directly after m= line
    const bLines = `b=AS:${maxKbps}\r\nb=TIAS:${tiasBps}\r\n`;
    if (/c=IN[^\r\n]+\r?\n/i.test(mediaSection)) {
      mediaSection = mediaSection.replace(/(c=IN[^\r\n]+\r?\n)/i, `$1${bLines}`);
    } else {
      mediaSection = mediaSection.replace(/(m=video[^\r\n]+\r?\n)/i, `$1${bLines}`);
    }

    // 2. Patch fmtp lines for all video payload types to include google bitrate hints
    const rtpmapRegex = /^a=rtpmap:(\d+)\s+(\S+)\/90000/gim;
    let match: RegExpExecArray | null;
    const pts: string[] = [];
    while ((match = rtpmapRegex.exec(mediaSection)) !== null) {
      // Only payloads that carry a picture. Retransmission and the error
      // correction codecs share the video clock rate but have no encoder to
      // hint at, and `rtx`'s format line is one parameter long - appending to
      // `apt=96` is how a whole patched description gets refused, which loses
      // the hints on the codecs that did want them.
      if (match[1] && match[2] && !NOT_A_PICTURE.has(match[2].toLowerCase())) pts.push(match[1]);
    }

    for (const pt of pts) {
      const fmtpRegex = new RegExp(`^a=fmtp:${pt}\\s+(.+)$`, 'm');
      const hints = `x-google-max-bitrate=${maxKbps};x-google-start-bitrate=${startKbps}`;
      if (fmtpRegex.test(mediaSection)) {
        mediaSection = mediaSection.replace(
          fmtpRegex,
          (_m, existing: string) => `a=fmtp:${pt} ${existing};${hints}`,
        );
      } else {
        mediaSection = mediaSection.replace(
          new RegExp(`(a=rtpmap:${pt}[^\\r\\n]+\\r?\\n)`, 'i'),
          `$1a=fmtp:${pt} ${hints}\r\n`,
        );
      }
    }

    return mediaSection;
  });

  return patched.join('');
}

/**
 * Whether an H.264 format line describes a High profile.
 *
 * `profile-level-id` is three bytes — profile_idc, constraint flags, level —
 * and `0x64` in the first is High, whatever the other two say. Matching the
 * four-character prefix `6400` reads the profile *and half the constraint
 * flags*, so it accepts High (`6400xx`) and rejects **Constrained High
 * (`640cxx`)**, which is the profile Chromium actually offers. That is a
 * preference which has never once fired: with no High profile recognised, the
 * sort fell through to packetization mode and left Constrained Baseline first,
 * so every share has been negotiating baseline — no CABAC, no 8x8 transform,
 * and text visibly softer at the same bitrate.
 *
 * Both High profiles carry the two features that matter here, so both count.
 */
function isHighProfile(fmtp: string): boolean {
  return /profile-level-id=64[0-9a-f]{4}/.test(fmtp);
}

/**
 * Sorts video codecs to prefer H.264 High profile with packetization-mode=1,
 * which is sharper per bit than baseline on exactly the content a share
 * carries. Mode 1 lets a NAL unit span packets; mode 0 caps every one of them
 * at the MTU, which fragments slices for the network's benefit rather than the
 * picture's.
 *
 * A sort and not a filter: everything stays offered, so a machine with no High
 * profile encoder gets whatever it does have rather than a failed share.
 */
export function sortPreferredVideoCodecs(
  codecs: RTCRtpCodec[],
  preferred: SharePublish['videoCodec'],
): RTCRtpCodec[] {
  const target = preferred.toLowerCase();
  const matched = codecs.filter((c) => c.mimeType.toLowerCase().endsWith(`/${target}`));
  const others = codecs.filter((c) => !c.mimeType.toLowerCase().endsWith(`/${target}`));

  if (target === 'h264') {
    const rank = (codec: RTCRtpCodec): number => {
      const fmtp = (codec.sdpFmtpLine ?? '').toLowerCase();
      return (isHighProfile(fmtp) ? 2 : 0) + (fmtp.includes('packetization-mode=1') ? 1 : 0);
    };
    matched.sort((a, b) => rank(b) - rank(a));
  }

  return [...matched, ...others];
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
