/**
 * Measures the video encoder this machine really has, before a share starts.
 *
 * Asking the platform is not enough - see "Which encoder, measured" in
 * `share-quality.ts`. This is the measuring half: a synthetic moving picture,
 * drawn on a canvas at the share's own size and rate, sent through a real
 * sender on a connection that loops back inside this renderer. For a second
 * after it settles, the sender's `outbound-rtp` statistics say which encoder
 * it got and how many of the frames it was offered it encoded. `measuredKind`
 * turns that into the answer.
 *
 * It costs about a second and a half of encoding once per codec, size and
 * rate, and the reading is kept for the rest of the session - the encoder a
 * machine has does not change while the app is running. Anything that goes
 * wrong is no reading, which leaves the answer to the platform's own claim
 * exactly as it was before this existed.
 */
import type { EncoderKind } from './call-stats';
import { encoderKind } from './call-stats';
import { measuredKind, type EncoderReading, type SharePublish, type ShareSize } from './share-quality';

/** From the first encoded frame until the encoder has settled. */
const WARMUP_MS = 400;
/** The window the cadence is read over. */
const MEASURE_MS = 1_000;
/** How often the sender's statistics are read while waiting. */
const POLL_MS = 100;
/** The whole probe, warm-up included, before it gives up with no answer. */
const DEADLINE_MS = 4_000;

/** Codecs that are support, not pictures; kept on the list so the sender can use them. */
const REPAIR = new Set(['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03']);

/** Readings already taken this session, by codec, size and rate. */
const measured = new Map<string, EncoderReading>();

/**
 * The encoder a share will be budgeted for: measured where it can be, and
 * the platform's own claim where the measurement could not say.
 */
export async function probeShareEncoder(
  codec: SharePublish['videoCodec'],
  size: ShareSize,
  frameRate: number,
  bitrate: number,
): Promise<EncoderKind | null> {
  const [reading, advertised] = await Promise.all([
    measureEncoder(codec, size, frameRate, bitrate),
    advertisedEncoder(codec, size, frameRate, bitrate),
  ]);
  return measuredKind(reading, advertised);
}

/**
 * What Media Capabilities says about encoding this for WebRTC: `powerEfficient`
 * is the same question `powerEfficientEncoder` answers on a live sender. Null
 * when the API is missing or will not say.
 */
async function advertisedEncoder(
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

/** One codec, measured once per session at this size and rate. */
export async function measureEncoder(
  codec: SharePublish['videoCodec'],
  size: ShareSize,
  frameRate: number,
  bitrate: number,
): Promise<EncoderReading | null> {
  const key = `${codec}:${size.width}x${size.height}@${frameRate}`;
  const known = measured.get(key);
  if (known) return known;

  const probe = startProbe(codec, size, frameRate, bitrate);
  if (!probe) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DEADLINE_MS);
  });
  try {
    const reading = await Promise.race([probe.reading, late]);
    // Only an answer is remembered. A probe that ran out of time may have
    // been starved by something else for that one second, and the next share
    // asks again rather than living with it.
    if (reading) measured.set(key, reading);
    return reading;
  } finally {
    if (timer) clearTimeout(timer);
    probe.stop();
  }
}

interface Sample {
  at: number;
  framesEncoded: number;
  implementation: string | null;
  powerEfficient: boolean | null;
  width: number | null;
}

/**
 * Opens the loopback and starts reading it. Every resource it opens is closed
 * by `stop`, however the probe ends.
 */
function startProbe(
  codec: SharePublish['videoCodec'],
  size: ShareSize,
  frameRate: number,
  bitrate: number,
): { reading: Promise<EncoderReading | null>; stop: () => void } | null {
  if (typeof RTCPeerConnection === 'undefined' || typeof document === 'undefined') return null;

  const all = RTCRtpSender.getCapabilities?.('video')?.codecs ?? [];
  const wanted = all.filter((c) => c.mimeType.toLowerCase() === `video/${codec.toLowerCase()}`);
  if (wanted.length === 0) return null;
  const preferences = [...wanted, ...all.filter((c) => REPAIR.has(c.mimeType.toLowerCase()))];

  const picture = new MovingPicture(size, frameRate);
  const sender = new RTCPeerConnection();
  const receiver = new RTCPeerConnection();
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    picture.stop();
    sender.close();
    receiver.close();
  };

  const reading = (async (): Promise<EncoderReading | null> => {
    sender.onicecandidate = (event) => {
      if (event.candidate) void receiver.addIceCandidate(event.candidate).catch(() => undefined);
    };
    receiver.onicecandidate = (event) => {
      if (event.candidate) void sender.addIceCandidate(event.candidate).catch(() => undefined);
    };

    const transceiver = sender.addTransceiver(picture.track, {
      direction: 'sendonly',
      sendEncodings: [{ maxBitrate: bitrate, maxFramerate: frameRate }],
    });
    transceiver.setCodecPreferences(preferences);

    const offer = await sender.createOffer();
    await sender.setLocalDescription({ type: 'offer', sdp: pinBitrate(offer.sdp ?? '', bitrate) });
    await receiver.setRemoteDescription(sender.localDescription!);
    const answer = await receiver.createAnswer();
    await receiver.setLocalDescription({ type: 'answer', sdp: pinBitrate(answer.sdp ?? '', bitrate) });
    await sender.setRemoteDescription(receiver.localDescription!);

    // Held at full size, so an encoder that cannot keep up shows it by
    // dropping frames rather than by quietly shrinking the picture.
    const parameters = transceiver.sender.getParameters();
    parameters.degradationPreference = 'maintain-resolution';
    await transceiver.sender.setParameters(parameters).catch(() => undefined);

    picture.start();

    let first: Sample | null = null;
    let start: Sample | null = null;
    let startOffered = 0;
    while (!stopped) {
      await sleep(POLL_MS);
      const now = await sample(transceiver.sender);
      if (!now || now.framesEncoded === 0) continue;
      if (!first) {
        first = now;
        continue;
      }
      if (!start) {
        if (now.at - first.at < WARMUP_MS) continue;
        start = now;
        startOffered = picture.drawn;
        continue;
      }
      if (now.at - start.at < MEASURE_MS) continue;

      const encoded = now.framesEncoded - start.framesEncoded;
      const offered = Math.max(1, picture.drawn - startOffered);
      return {
        kind: encoderKind(now.implementation, now.powerEfficient),
        cadence: encoded / offered,
        scaled: now.width !== null && now.width < size.width * 0.9,
      };
    }
    return null;
  })().catch(() => null);

  return { reading, stop };
}

/**
 * Starts the loopback's estimate at the bitrate under test, and holds it there.
 *
 * Only for this connection, which never leaves the machine. A real share
 * starts low and climbs because a real link has to be found out; here there
 * is nothing to find, and an encoder starved of bits by a cold estimate skips
 * frames for the rate controller's sake - which would read as an encoder that
 * cannot keep up.
 */
function pinBitrate(sdp: string, bitrate: number): string {
  const kbps = Math.round(bitrate / 1000);
  const hints = `x-google-min-bitrate=${kbps};x-google-start-bitrate=${kbps};x-google-max-bitrate=${kbps}`;
  return sdp.replace(/^a=fmtp:(\d+) (.+)$/gm, (line, _pt: string, params: string) =>
    params.includes('apt=') ? line : `${line};${hints}`,
  );
}

/** The sender's `outbound-rtp`, reduced to what the probe reads. */
async function sample(sender: RTCRtpSender): Promise<Sample | null> {
  const report = await sender.getStats().catch(() => null);
  if (!report) return null;
  let found: Sample | null = null;
  report.forEach((stats) => {
    const entry = stats as RTCStats & Record<string, unknown>;
    if (entry.type !== 'outbound-rtp' || entry.kind !== 'video') return;
    found = {
      at: performance.now(),
      framesEncoded: Number(entry.framesEncoded ?? 0),
      implementation:
        typeof entry.encoderImplementation === 'string' ? entry.encoderImplementation : null,
      powerEfficient:
        typeof entry.powerEfficientEncoder === 'boolean' ? entry.powerEfficientEncoder : null,
      width: typeof entry.frameWidth === 'number' ? entry.frameWidth : null,
    };
  });
  return found;
}

/**
 * A picture with something to encode in every frame: blocks that change
 * colour, a bar that sweeps, and lines of text that scroll, so the encoder
 * sees edges and motion the way it would on a real screen. Drawn on a timer
 * rather than on animation frames, because a call window is often covered
 * while somebody picks what to share.
 */
class MovingPicture {
  readonly track: MediaStreamTrack;
  drawn = 0;
  private readonly context: CanvasRenderingContext2D | null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly size: ShareSize,
    private readonly frameRate: number,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    this.context = canvas.getContext('2d', { alpha: false });
    this.draw();
    this.track = canvas.captureStream(frameRate).getVideoTracks()[0]!;
    // A screencast hint, as the real share carries: it decides which of
    // libwebrtc's encoder settings are being measured.
    this.track.contentHint = 'detail';
  }

  start(): void {
    this.timer = setInterval(() => this.draw(), 1000 / Math.max(1, this.frameRate));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.track.stop();
  }

  private draw(): void {
    const g = this.context;
    if (!g) return;
    const { width, height } = this.size;
    const n = this.drawn++;

    const columns = 16;
    const rows = 9;
    const w = Math.ceil(width / columns);
    const h = Math.ceil(height / rows);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const hue = (x * 23 + y * 41 + n * 7) % 360;
        g.fillStyle = `hsl(${hue} 60% ${35 + ((x + y + n) % 3) * 10}%)`;
        g.fillRect(x * w, y * h, w, h);
      }
    }

    g.fillStyle = '#fff';
    g.fillRect((n * 17) % width, 0, Math.max(8, width / 40), height);

    g.fillStyle = '#111';
    g.font = `${Math.max(12, Math.round(height / 40))}px monospace`;
    const line = Math.max(14, Math.round(height / 30));
    for (let y = line - ((n * 3) % line); y < height; y += line * 3) {
      g.fillText(`frame ${n} - the quick brown fox jumps over the lazy dog ${y}`, 16, y);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
