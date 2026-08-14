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
 * - **Say what the content is.** A film and a text editor want opposite
 *   choices: one wants frames kept and resolution sacrificed, the other the
 *   reverse. Guessing gets it wrong half the time, so the picker asks.
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
  contentHint: 'text' | 'motion';
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
  /** Keep the native capture size; congestion control decides when to shrink. */
  scaleResolutionDownBy: number;
  /** A share is the call's primary visual media, not background video. */
  priority: RTCPriorityType;
  degradationPreference: RTCDegradationPreference;
  /** Preferred video codec, by MIME subtype. Ignored when unavailable. */
  videoCodec: 'H264';
  audio: false | { maxBitrate: number; stereo: boolean; dtx: boolean; red: boolean };
}

/** Full-band stereo Opus, the ceiling a soundtrack is worth. */
const MUSIC_BITRATE = 510_000;

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
  // A desktop, a document, an IDE. Sharp edges and readable text matter; resolution
  // is strictly preserved at high frame rates and generous P2P bitrate.
  detail: {
    frameRate: 60,
    contentHint: 'text',
    degradation: 'maintain-resolution',
    referenceBitrate: 20_000_000,
    minBitrate: 8_000_000,
    maxBitrate: 50_000_000,
  },
  // A film, a game, anything that moves. Pristine smoothness at 60 fps with
  // uncompressed-feel high bitrate across direct P2P connections.
  motion: {
    frameRate: 60,
    contentHint: 'motion',
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
): { capture: ShareCapture; publish: SharePublish } {
  const profile = PROFILES[intent];

  return {
    capture: {
      video: { width: size.width, height: size.height, frameRate: profile.frameRate },
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
      maxFramerate: profile.frameRate,
      maxBitrate: bitrateFor(intent, size),
      scaleResolutionDownBy: 1,
      priority: 'high',
      degradationPreference: profile.degradation,
      // Hardware-encoded on any Windows machine with a GPU from this decade,
      // which is what makes 1080p60 possible without melting the CPU. VP9 looks
      // better per bit and is encoded in software; that trade is the wrong way
      // round when the point is latency.
      videoCodec: 'H264',
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
 * Patches SDP with explicit video bandwidth limits (`b=AS`, `b=TIAS`) and
 * codec bitrate hints (`x-google-min-bitrate`, `x-google-start-bitrate`,
 * `x-google-max-bitrate`).
 *
 * WebRTC's default Bandwidth Estimation (BWE) starts sending video at ~300 kbps
 * and ramps up painfully slowly over many seconds. In a direct P2P connection,
 * these SDP attributes signal high initial and maximum bitrate capabilities
 * immediately, eliminating blurry start-up artifacts and unlocking full quality.
 */
export function patchVideoBandwidth(sdp: string, publish?: SharePublish | null): string {
  const bitrate = publish?.maxBitrate ?? 50_000_000;
  const maxKbps = Math.round(bitrate / 1000);
  const minKbps = Math.max(1000, Math.round(maxKbps * 0.25));
  const startKbps = Math.max(minKbps, Math.round(maxKbps * 0.6));
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
      if (match[1]) pts.push(match[1]);
    }

    for (const pt of pts) {
      const fmtpRegex = new RegExp(`^a=fmtp:${pt}\\s+(.+)$`, 'm');
      const hints = `x-google-min-bitrate=${minKbps};x-google-max-bitrate=${maxKbps};x-google-start-bitrate=${startKbps}`;
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
 * Sorts video codecs to prefer H.264 High Profile (profile-level-id 6400..)
 * with packetization-mode=1, which provides superior image sharpness and CABAC
 * compression efficiency over baseline profile.
 */
export function sortPreferredVideoCodecs(
  codecs: RTCRtpCodecCapability[],
  preferred: SharePublish['videoCodec'],
): RTCRtpCodecCapability[] {
  const target = preferred.toLowerCase();
  const matched = codecs.filter((c) => c.mimeType.toLowerCase().endsWith(`/${target}`));
  const others = codecs.filter((c) => !c.mimeType.toLowerCase().endsWith(`/${target}`));

  // If H.264, prioritize High Profile (6400..) over Baseline (4200.. / 42e0..)
  if (target === 'h264') {
    matched.sort((a, b) => {
      const aFmtp = (a.sdpFmtpLine ?? '').toLowerCase();
      const bFmtp = (b.sdpFmtpLine ?? '').toLowerCase();
      const aHigh = aFmtp.includes('profile-level-id=6400') ? 2 : 0;
      const bHigh = bFmtp.includes('profile-level-id=6400') ? 2 : 0;
      const aPacket = aFmtp.includes('packetization-mode=1') ? 1 : 0;
      const bPacket = bFmtp.includes('packetization-mode=1') ? 1 : 0;
      return bHigh + bPacket - (aHigh + aPacket);
    });
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
