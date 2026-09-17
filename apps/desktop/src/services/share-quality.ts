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
  return {
    width: { ideal: capture.video.width, max: capture.video.width },
    height: { ideal: capture.video.height, max: capture.video.height },
    frameRate: { ideal: capture.video.frameRate, max: capture.video.frameRate },
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
 * Both profiles hold the frame rate, and the reason is the bug this replaced.
 *
 * There are only two of these preferences worth having and each one, alone, is
 * a way for a share to collapse. `maintain-framerate` lets WebRTC's own adapter
 * spend pixels in 1.5x, 2x, 3x, 4x steps off a bandwidth estimate it is still
 * finding, so a 1440p share walked down to 480p within seconds and stayed - and
 * that is why this said `maintain-resolution` instead. But `maintain-resolution`
 * has no floor under the thing it gives up: it holds 1920x1080 and drops frames
 * as far as it takes, which on a 405 kbps link is *1080p at 2 fps*. A slideshow
 * at full size is not a better failure than a small sharp picture, it is a
 * worse one, and it is the one people actually reported.
 *
 * The axis being held was never the problem. The problem was that nothing chose
 * what to give up on the *other* axis, so whichever one WebRTC was left to pick
 * it picked without limit. `adaptShare` chooses it now, from the estimate the
 * congestion controller has already made: the resolution is whatever that
 * bitrate can carry at a watchable frame rate, computed before the encoder is
 * asked. With a budget in hand, holding frames is safe - WebRTC's adapter is
 * only a backstop for a budget that came out optimistic, instead of being the
 * whole policy.
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
    degradation: 'maintain-framerate',
    referenceBitrate: 20_000_000,
    minBitrate: 8_000_000,
    maxBitrate: 50_000_000,
  },
  // A film, a game, anything that moves.
  motion: {
    frameRate: 60,
    contentHint: 'detail',
    degradation: 'maintain-framerate',
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

  return {
    capture: {
      video: { width: captured.width, height: captured.height, frameRate },
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
    },
  };
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

// --- The frame-rate ladder --------------------------------------------------
//
// Everything above this line is a ceiling decided before the share starts, off
// the display's size and the machine's guess about itself. None of it can know
// what the link turned out to carry, and a ceiling is not a plan for missing
// it: the encoder is handed 1080p60 and 20 Mbit, the link delivers 400 kbit,
// and what happens next is whatever `degradationPreference` says - which used
// to be 1080p at 2 fps.
//
// So this is the half that was missing. The congestion controller has already
// measured the link; `availableOutgoingBitrate` is that measurement. Given a
// number of bits per second and a frame rate worth holding, the resolution that
// fits in it is arithmetic, and it is far better arithmetic than an encoder
// discovering the same thing by failing.

/**
 * Frame rates a share will hold, best first.
 *
 * 24 is the floor because it is the rate film has used for a century: below it
 * motion stops reading as motion and starts reading as a slideshow, which is
 * the failure being fixed, just slower. Nothing between these is worth a step -
 * the difference between 30 and 24 is a decision, the difference between 30 and
 * 28 is noise.
 */
export const FRAME_TIERS = [60, 30, 24] as const;

/**
 * Bits per pixel per frame an H.264 screen encode needs to look clean.
 *
 * Calibrated, not derived: 1080p60 that people call good measures around
 * 10 Mbit, and 10e6 / (1920*1080 * 60) is 0.080. It is the one number here that
 * is a property of the encoder rather than of arithmetic, so it is the knob to
 * turn if shares come out consistently softer or consistently more expensive
 * than they should - screen content with large flat areas beats it easily, and
 * a full-screen film is the case that does not.
 */
const BITS_PER_PIXEL_FRAME = 0.08;

/**
 * The smallest picture worth giving up a frame rate tier to keep.
 *
 * Above this, holding 60 fps is worth the pixels it costs. Below it, the share
 * has become a postage stamp and the next tier down buys back 40% of each edge,
 * which is the better trade. There is no floor under the *last* tier: at 24 fps
 * the picture shrinks as far as the link demands, because the alternative is
 * the frame rate collapsing instead.
 */
const FLOOR_HEIGHT = 540;

/** Consecutive readings of sustained headroom before a share climbs back up. */
const CLIMB_TICKS = 5;

/**
 * Scale changes smaller than this are not changes.
 *
 * `availableOutgoingBitrate` wobbles by a few percent every second on a link
 * with nothing wrong with it, and re-encoding at 2.9x instead of 3.0x is a
 * keyframe and a visible hitch bought for nothing.
 */
const SCALE_DEADBAND = 0.15;

export interface ShareAdaptation {
  frameRate: number;
  scaleResolutionDownBy: number;
}

/**
 * What to encode, given what the link says it can carry.
 *
 * The highest frame rate whose affordable resolution still clears
 * [FLOOR_HEIGHT], and the scale factor that puts the picture inside the budget
 * at that rate. Pure, so the ladder is a table that can be checked rather than
 * behaviour that has to be reproduced on a bad hotel connection.
 *
 * `available` of `null` means nothing has been measured yet, and the answer is
 * then the full capture at the full rate. That is deliberate and it is not
 * optimism: the estimator only measures what is actually sent, so a share that
 * starts small to be safe is a share that reports a small link, and it never
 * grows. Starting at full size and stepping down off a real reading is the only
 * order that converges.
 */
export function adaptShare(publish: SharePublish, available: number | null): ShareAdaptation {
  const wanted = publish.maxFramerate;
  if (available === null || available <= 0) {
    return { frameRate: wanted, scaleResolutionDownBy: publish.scaleResolutionDownBy };
  }

  // The link's own reading, held to the share's ceiling: an estimate above what
  // this share will ever send is headroom, not permission to send more.
  const budget = Math.min(available, publish.maxBitrate);
  const pixels = Math.max(1, publish.captured.width * publish.captured.height);

  // Tiers above what somebody asked for are not on offer. A 30 fps override is
  // a decision about this machine or this connection, and a ladder that climbs
  // past it is a setting that does nothing.
  const tiers = FRAME_TIERS.filter((tier) => tier <= wanted);
  const ladder: readonly number[] = tiers.length > 0 ? tiers : [wanted];

  for (const [index, tier] of ladder.entries()) {
    const affordable = budget / (tier * BITS_PER_PIXEL_FRAME);
    // Linear on each edge, so the pixel ratio is the square of it.
    const scale = Math.sqrt(pixels / affordable);
    if (scale <= 1) return { frameRate: tier, scaleResolutionDownBy: 1 };

    // The last tier has nothing below it to fall to, so it takes whatever
    // shrink the link demands.
    const last = index === ladder.length - 1;
    if (last || publish.captured.height / scale >= FLOOR_HEIGHT) {
      // Two decimals: `scaleResolutionDownBy` is a float, and quoting fifteen
      // of them makes every reading a different value to compare against.
      return { frameRate: tier, scaleResolutionDownBy: Math.round(scale * 100) / 100 };
    }
  }

  // Unreachable - the last tier always returns - but a ladder that fell through
  // silently would be a share with no settings at all.
  return { frameRate: ladder[ladder.length - 1] ?? wanted, scaleResolutionDownBy: 1 };
}

/**
 * One link's position on the ladder, over time.
 *
 * [adaptShare] answers "what fits right now", which is not the same question as
 * "what should change". Applied straight, a per-second reading re-encodes the
 * share every second: the estimate wobbles, the scale follows it, and every
 * change is a keyframe. And applied symmetrically it is worse than that - a
 * link that dips for one second would drag the share down and a share that was
 * dragged down reports a smaller estimate, which is a ratchet that only ever
 * tightens.
 *
 * So the two directions are not symmetric, on purpose:
 *
 * - **Down immediately.** A link that cannot carry the picture is already
 *   dropping frames. Waiting to be sure is five more seconds of the thing being
 *   fixed.
 * - **Up slowly.** [CLIMB_TICKS] consecutive readings with room, because the
 *   estimate rises through probing and the first rise is the probe, not the
 *   link.
 *
 * The run-length shape is [FrameBudget]'s in `camera-effects.ts`, for the same
 * reason: a thing that flips between two states is worse than either state.
 */
export class ShareLadder {
  private current: ShareAdaptation | null = null;
  private climbing = 0;

  /** The current rung, or null before the first reading. */
  get position(): ShareAdaptation | null {
    return this.current;
  }

  /**
   * One reading. Returns what to apply, or null when nothing should change -
   * which is most ticks, and is the difference between this and a `setParameters`
   * call a second forever.
   */
  step(publish: SharePublish, available: number | null): ShareAdaptation | null {
    const next = adaptShare(publish, available);
    const now = this.current;
    if (!now) {
      this.current = next;
      return next;
    }

    const scaleDelta = next.scaleResolutionDownBy - now.scaleResolutionDownBy;
    const worse = next.frameRate < now.frameRate || scaleDelta > SCALE_DEADBAND;
    const better = next.frameRate > now.frameRate || scaleDelta < -SCALE_DEADBAND;

    if (worse) {
      this.climbing = 0;
      this.current = next;
      return next;
    }
    if (!better) {
      // Inside the deadband: the reading agrees with where the share already
      // is, and a run of agreement is not a run of headroom.
      this.climbing = 0;
      return null;
    }
    if (++this.climbing < CLIMB_TICKS) return null;

    this.climbing = 0;
    this.current = next;
    return next;
  }

  /** A new capture is a new ladder: the size every rung was computed against changed. */
  reset(): void {
    this.current = null;
    this.climbing = 0;
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
