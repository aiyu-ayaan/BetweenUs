/**
 * One encoder for a share, however many people are watching it.
 *
 * A mesh sends the share over one connection per viewer, and a WebRTC sender
 * encodes for itself: five viewers were five encoders, each turning the same
 * pixels into the same H.264. On a machine with a GPU encoder that is a GPU
 * session each, against a driver limit; on one without, it is a CPU core
 * each. Measured on a laptop with only OpenH264, 1080p30 of a desktop with
 * scrolling text: 1.70 cores for three viewers and 3.89 for five, against 0.69
 * and 0.73 through this.
 *
 * Discord avoids it by encoding once and letting a media server copy the
 * stream to everybody. Nothing here relays media through a server, so the copy
 * happens on the sharer's machine instead, after encoding:
 *
 * - **The producer** is one ordinary sender that encodes the capture, on a
 *   connection that loops back inside this renderer and carries nothing - its
 *   encoded frames are taken off it by an encoded transform and dropped.
 * - **Each pooled link's** screen sender encodes a 16x16 picture that changes
 *   one pixel a frame, ticked once per shared frame. Its transform sends each
 *   of those frames out with the next shared frame in its place. Everything
 *   after the encoder is the link's own and stays per viewer: RTP, pacing,
 *   congestion control, retransmission, encryption.
 *
 * Both transforms run in `share-pool.worker.ts`. A link that asks for a
 * keyframe gets one from the producer, by switching its encoding off and on -
 * the only way to ask a sender for a keyframe from this side that Chromium
 * has. A link that cannot keep up with the shared bitrate is taken out and
 * goes back to encoding for itself, where the ladder in `share-quality.ts`
 * fits it to its own connection; one slow viewer never lowers everybody
 * else's picture.
 *
 * H.264 only. Its packetiser finds the frame boundaries in the bitstream
 * itself, so a shared frame survives being carried under another frame's
 * metadata; VP8's payload descriptor is built from that metadata and does not.
 */
import { sortPreferredVideoCodecs, type SharePublish } from './share-quality';
import type { PoolWorkerEvent } from './share-pool.worker';

/** Viewers before pooling is worth it: for one, the producer is pure overhead. */
export const POOL_MIN_VIEWERS = 2;

/** The shortest gap between two forced keyframes; every request inside it is the same one. */
const KEY_SPACING_MS = 250;

/** Codecs that are support, not pictures; the producer may use them. */
const REPAIR = new Set(['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec-03']);

/** One link, as the pool decides who is in it. */
export interface PoolCandidate {
  id: string;
  /** Joined the share - an unwatched link encodes nothing either way. */
  watched: boolean;
  /** Through a TURN relay: held to its own lower ceiling, so not shared. */
  relayed: boolean;
  /** Negotiated an H.264 the producer's frames can be sent as. */
  compatible: boolean;
  /** Fell behind the shared bitrate this share; encodes for itself until it ends. */
  evicted: boolean;
}

/**
 * Who is pooled.
 *
 * Pooling starts at `POOL_MIN_VIEWERS` eligible links and, once started, stays
 * on while any are left: dropping out of it when the second viewer leaves and
 * back in when they return is two switches, each a keyframe for everybody.
 */
export function poolMembers(
  candidates: readonly PoolCandidate[],
  active: boolean,
): { active: boolean; members: Set<string> } {
  const eligible = candidates.filter((c) => c.watched && !c.relayed && c.compatible && !c.evicted);
  const on = active ? eligible.length > 0 : eligible.length >= POOL_MIN_VIEWERS;
  return { active: on, members: new Set(on ? eligible.map((c) => c.id) : []) };
}

/**
 * Whether a link's negotiated codec can carry the producer's frames.
 *
 * Both H.264 with `packetization-mode=1`, and the same profile byte: a stream
 * encoded in High is not what a link that agreed on Constrained Baseline told
 * its decoder to expect.
 */
export function canCarry(
  producer: { mimeType: string; sdpFmtpLine?: string } | null,
  link: { mimeType: string; sdpFmtpLine?: string } | null,
): boolean {
  if (!producer || !link) return false;
  if (producer.mimeType.toLowerCase() !== 'video/h264') return false;
  if (link.mimeType.toLowerCase() !== 'video/h264') return false;
  const mode = (fmtp?: string): boolean => /packetization-mode=1/.test(fmtp ?? '');
  if (!mode(producer.sdpFmtpLine) || !mode(link.sdpFmtpLine)) return false;
  const profile = (fmtp?: string): string | null =>
    /profile-level-id=([0-9a-f]{2})/i.exec(fmtp ?? '')?.[1]?.toLowerCase() ?? null;
  const ours = profile(producer.sdpFmtpLine);
  return ours !== null && ours === profile(link.sdpFmtpLine);
}

/** What the producer is sending, for the connection panel. */
export interface ProducerReading {
  width: number | null;
  height: number | null;
  framesPerSecond: number | null;
  implementation: string | null;
  powerEfficient: boolean | null;
  limitedBy: 'bandwidth' | 'cpu' | 'other' | null;
}

interface Producer {
  send: RTCPeerConnection;
  receive: RTCPeerConnection;
  sender: RTCRtpSender;
}

/**
 * The producer, the carrier and the worker for one call.
 *
 * The worker lives as long as the call. Every link's screen sender carries the
 * pool's transform from before it first negotiates - Chromium sends frames
 * past a transform attached later, and goes silent when one is taken off - so
 * the transform is there for the life of the connection, passing the link's
 * own frames through whenever it is not pooled.
 */
export class SharePool {
  private worker: Worker | null = null;
  private producer: Producer | null = null;
  private carrier: CanvasCaptureMediaStreamTrack | null = null;
  private carrierPixel: CanvasRenderingContext2D | null = null;
  private flip = false;
  private nextId = 1;
  private readonly ids = new WeakMap<RTCRtpSender, number>();
  /** The other way round, for a stall the worker reports by id. */
  private readonly senders = new Map<number, RTCRtpSender>();
  private keyInFlight = false;
  private keyQueued = false;
  private lastKeyAt = 0;
  private closed = false;
  /**
   * The producer's `setParameters` calls, one at a time. Two in flight read the
   * same parameters and the second is refused as stale - which, for the
   * keyframe switch, would leave the encoder off.
   */
  private configuring: Promise<void> = Promise.resolve();

  constructor(private readonly events: { onStalled: (sender: RTCRtpSender) => void }) {}

  /**
   * Whether this runtime has what pooling needs.
   *
   * Chromium only, which is the desktop app and Chrome or Edge on the web. The
   * standard transform exists in Firefox and Safari too, but what this relies
   * on beyond it - a transform taking only before negotiation, a keyframe from
   * switching an encoding off and on, a carried H.264 frame packetised from its
   * own bitstream - was measured on Chromium's WebRTC and nowhere else. Its
   * own `createEncodedStreams` is the marker.
   */
  static supported(): boolean {
    return (
      typeof RTCRtpScriptTransform !== 'undefined' &&
      typeof RTCRtpSender !== 'undefined' &&
      'createEncodedStreams' in RTCRtpSender.prototype &&
      typeof Worker !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function'
    );
  }

  /** Whether a share is being encoded by the producer right now. */
  get running(): boolean {
    return this.producer !== null;
  }

  /**
   * Starts encoding a share once. Returns false where the producer cannot be
   * built, which leaves every link encoding for itself as before.
   */
  async start(track: MediaStreamTrack, publish: SharePublish): Promise<boolean> {
    this.stop();
    if (this.closed || !SharePool.supported()) return false;

    const all = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
    const h264 = sortPreferredVideoCodecs(
      all.filter((c) => c.mimeType.toLowerCase() === 'video/h264' && /packetization-mode=1/.test(c.sdpFmtpLine ?? '')),
      'H264',
    );
    if (h264.length === 0) return false;
    const preferences = [...h264, ...all.filter((c) => REPAIR.has(c.mimeType.toLowerCase()))];

    const worker = this.ensureWorker();
    const send = new RTCPeerConnection();
    const receive = new RTCPeerConnection();
    try {
      send.onicecandidate = (event) => {
        if (event.candidate) void receive.addIceCandidate(event.candidate).catch(() => undefined);
      };
      receive.onicecandidate = (event) => {
        if (event.candidate) void send.addIceCandidate(event.candidate).catch(() => undefined);
      };

      const transceiver = send.addTransceiver(track, {
        direction: 'sendonly',
        // Off until somebody is pooled: with one viewer the link encodes for
        // itself, and a producer running beside it would be a second encoder.
        sendEncodings: [{ maxBitrate: publish.maxBitrate, maxFramerate: publish.maxFramerate, active: false }],
      });
      transceiver.setCodecPreferences(preferences);
      transceiver.sender.transform = new RTCRtpScriptTransform(worker, { role: 'producer' });

      // The loopback carries nothing, so its bandwidth estimate never moves
      // off where it starts. It starts at the share's own ceiling; the
      // producer's real rate is set through `tune`.
      const kbps = Math.round(publish.maxBitrate / 1000);
      const offer = await send.createOffer();
      await send.setLocalDescription({ type: 'offer', sdp: startAt(offer.sdp ?? '', kbps) });
      await receive.setRemoteDescription(send.localDescription!);
      const answer = await receive.createAnswer();
      await receive.setLocalDescription({ type: 'answer', sdp: startAt(answer.sdp ?? '', kbps) });
      await send.setRemoteDescription(receive.localDescription!);

      this.producer = { send, receive, sender: transceiver.sender };
    } catch (error) {
      send.close();
      receive.close();
      console.warn('[share-pool] could not start the shared encoder', error);
      return false;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    this.carrierPixel = canvas.getContext('2d', { alpha: false });
    if (this.carrierPixel) {
      this.carrierPixel.fillStyle = '#202020';
      this.carrierPixel.fillRect(0, 0, 16, 16);
    }
    // Frames only on request: one per shared frame, from `onWorker`.
    this.carrier = canvas.captureStream(0).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    // A screencast hint, as the real share carries: it is what keeps periodic
    // bandwidth probing on for a link that is application-limited.
    this.carrier.contentHint = 'detail';
    return true;
  }

  /** The share has ended. Every link goes back to sending its own frames. */
  stop(): void {
    this.worker?.postMessage({ type: 'reset' });
    if (this.producer) {
      this.producer.send.close();
      this.producer.receive.close();
      this.producer = null;
    }
    this.carrier?.stop();
    this.carrier = null;
    this.carrierPixel = null;
    this.keyQueued = false;
  }

  /** The producer's negotiated codec, which every pooled link must match. */
  producerCodec(): RTCRtpCodecParameters | null {
    return this.producer?.sender.getParameters().codecs?.[0] ?? null;
  }

  /**
   * Gives a link's screen sender the pool's transform. Must be called before
   * the sender first negotiates: Chromium sends a sender's frames past a
   * transform attached any later. Until the link is pooled the transform passes
   * its own frames through untouched.
   */
  prepare(sender: RTCRtpSender): void {
    if (this.closed || this.ids.has(sender)) return;
    const id = this.nextId++;
    this.ids.set(sender, id);
    this.senders.set(id, sender);
    sender.transform = new RTCRtpScriptTransform(this.ensureWorker(), { role: 'carrier', id });
  }

  /** Whether this link can be pooled at all. See `canCarry`. */
  canCarry(sender: RTCRtpSender): boolean {
    if (!this.ids.has(sender)) return false;
    return canCarry(this.producerCodec(), sender.getParameters().codecs?.[0] ?? null);
  }

  /** Puts a link's screen sender on the shared frames. */
  async add(sender: RTCRtpSender): Promise<void> {
    const id = this.ids.get(sender);
    if (!this.producer || !this.carrier || id === undefined) return;
    // Switched before the carrier is on the sender, so the 16x16 picture is
    // never sent as itself.
    this.worker?.postMessage({ type: 'pool', id });
    await sender.replaceTrack(this.carrier).catch(() => undefined);
  }

  /** Takes a link off the shared frames and gives it its own picture back. */
  async remove(sender: RTCRtpSender, track: MediaStreamTrack | null): Promise<void> {
    const id = this.ids.get(sender);
    if (id === undefined) return;
    // The real track first, so the carrier is never sent as itself.
    await sender.replaceTrack(track).catch(() => undefined);
    this.worker?.postMessage({ type: 'own', id });
  }

  /** A link's connection has closed: its transform will not be heard from again. */
  forget(sender: RTCRtpSender): void {
    const id = this.ids.get(sender);
    if (id === undefined) return;
    this.ids.delete(sender);
    this.senders.delete(id);
    this.worker?.postMessage({ type: 'drop', id });
  }

  /**
   * The producer's encoding: the share's ceiling and the software budget's,
   * and whether it runs at all.
   */
  async tune(
    encoding: { maxBitrate: number; maxFramerate: number; scaleResolutionDownBy: number; active: boolean },
    degradation: RTCDegradationPreference,
  ): Promise<void> {
    await this.configure(async (sender) => {
      const parameters = sender.getParameters();
      const first = parameters.encodings[0];
      if (!first) return;
      first.maxBitrate = encoding.maxBitrate;
      first.maxFramerate = encoding.maxFramerate;
      first.scaleResolutionDownBy = encoding.scaleResolutionDownBy;
      first.active = encoding.active;
      parameters.degradationPreference = degradation;
      await sender.setParameters(parameters);
    });
  }

  /** Runs one change to the producer's parameters after the last has settled. */
  private configure(change: (sender: RTCRtpSender) => Promise<void>): Promise<void> {
    const run = async (): Promise<void> => {
      const sender = this.producer?.sender;
      if (!sender) return;
      try {
        await change(sender);
      } catch (error) {
        console.warn('[share-pool] could not configure the shared encoder', error);
      }
    };
    const next = this.configuring.then(run, run);
    this.configuring = next;
    return next;
  }

  /** What the producer is actually sending. */
  async reading(): Promise<ProducerReading | null> {
    const sender = this.producer?.sender;
    if (!sender) return null;
    const report = await sender.getStats().catch(() => null);
    let found: ProducerReading | null = null;
    report?.forEach((stats) => {
      const entry = stats as RTCStats & Record<string, unknown>;
      if (entry.type !== 'outbound-rtp' || entry.kind !== 'video') return;
      const reason = entry.qualityLimitationReason;
      found = {
        width: typeof entry.frameWidth === 'number' ? entry.frameWidth : null,
        height: typeof entry.frameHeight === 'number' ? entry.frameHeight : null,
        framesPerSecond: typeof entry.framesPerSecond === 'number' ? entry.framesPerSecond : null,
        implementation:
          typeof entry.encoderImplementation === 'string' ? entry.encoderImplementation : null,
        powerEfficient:
          typeof entry.powerEfficientEncoder === 'boolean' ? entry.powerEfficientEncoder : null,
        limitedBy: reason === 'bandwidth' || reason === 'cpu' || reason === 'other' ? reason : null,
      };
    });
    return found;
  }

  close(): void {
    this.closed = true;
    this.stop();
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./share-pool.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<PoolWorkerEvent>) => this.onWorker(event.data);
    }
    return this.worker;
  }

  private onWorker(event: PoolWorkerEvent): void {
    switch (event.type) {
      case 'frame':
        this.tick();
        return;
      case 'key':
        void this.forceKey();
        return;
      case 'stalled': {
        const sender = this.senders.get(event.id);
        if (sender) this.events.onStalled(sender);
        return;
      }
    }
  }

  /** One carrier frame on every pooled link: a pixel that changes, and a request. */
  private tick(): void {
    const carrier = this.carrier;
    const pixel = this.carrierPixel;
    if (!carrier || !pixel) return;
    // Nearly the same colour each time: a carrier that changed its whole
    // picture would make its encoder call every frame a scene change, and
    // every carrier keyframe reads as the far end asking for one.
    this.flip = !this.flip;
    pixel.fillStyle = this.flip ? '#212121' : '#202020';
    pixel.fillRect(0, 0, 1, 1);
    carrier.requestFrame();
  }

  /**
   * A keyframe from the producer, for whichever pooled link needs one.
   *
   * Switching the encoding off and on again restarts the encoder at a
   * keyframe within a frame or two. Requests that arrive while one is in
   * flight, or within `KEY_SPACING_MS` of the last, are the same request.
   */
  private async forceKey(): Promise<void> {
    const sender = this.producer?.sender;
    if (!sender) return;
    if (this.keyInFlight) {
      this.keyQueued = true;
      return;
    }
    const wait = this.lastKeyAt + KEY_SPACING_MS - performance.now();
    if (wait > 0) {
      if (!this.keyQueued) {
        this.keyQueued = true;
        setTimeout(() => {
          this.keyQueued = false;
          void this.forceKey();
        }, wait);
      }
      return;
    }

    this.keyInFlight = true;
    this.lastKeyAt = performance.now();
    try {
      await this.configure(async (producer) => {
        for (const active of [false, true]) {
          const parameters = producer.getParameters();
          const first = parameters.encodings[0];
          if (!first) return;
          first.active = active;
          await producer.setParameters(parameters);
        }
      });
    } finally {
      this.keyInFlight = false;
      if (this.keyQueued) {
        this.keyQueued = false;
        void this.forceKey();
      }
    }
  }
}

/**
 * The loopback's estimate starts at the share's ceiling. Only for the
 * producer's own connection, which never leaves the machine and carries
 * nothing for an estimator to learn from.
 */
function startAt(sdp: string, kbps: number): string {
  const hints = `x-google-start-bitrate=${kbps};x-google-max-bitrate=${kbps}`;
  return sdp.replace(/^a=fmtp:(\d+) (.+)$/gm, (line, _pt: string, params: string) =>
    params.includes('apt=') ? line : `${line};${hints}`,
  );
}
