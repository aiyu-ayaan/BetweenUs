/**
 * The peer connection a remote-desktop session's screen travels over.
 *
 * One connection, one direction: the agent sends a display, the controller
 * watches it. That is simpler than a call's mesh and is treated as such - there
 * is no perfect negotiation here, because the agent is always the one with
 * something to send and therefore always the one that offers.
 *
 * Three things travel on it, and they were three separate features until they
 * turned out to be one: the screen, the machine's own sound
 * (`REMOTE_AUDIO`), and files (`REMOTE_FILE_TRANSFER`). All three go
 * peer to peer for the same reason - a Cloudflare Tunnel carries neither UDP
 * nor a gigabyte, and a gateway that relayed either would be a hop in a path
 * that is not supposed to have one. The messages that *ask* for a file still go
 * through the gateway, because a permission nothing checks is not a permission.
 *
 * `remote-gateway` relays the offer, the answer and the ICE candidates over the
 * `/ws/remote` socket both ends already hold, so this needs no signalling of
 * its own. The picture then goes directly between the two machines and never
 * touches the gateway or the tunnel in front of it - which is the only shape
 * that works through a Cloudflare Tunnel without opening a port.
 *
 * What this does NOT have, and a call does: a fingerprint signed with a key the
 * server has never seen. The two machines in a remote session share no such
 * secret, so the gateway relays their fingerprints unverified. The screen is
 * still end-to-end encrypted - DTLS-SRTP between the two of them, with no
 * server holding a decodable frame, which is better than the SFU design managed
 * - but a *malicious* gateway could substitute a fingerprint and sit in the
 * middle. Closing that needs a key agreed between agent and controller without
 * the gateway learning it; see "Known limits" in development/E2EE.md.
 */
import type { IceServer, RemoteSignal } from '@betweenus/shared-types';
import { serialize } from './signal-queue';
import {
  PLAYOUT_DELAY,
  patchVideoBandwidth,
  sortPreferredVideoCodecs,
  type SharePublish,
} from './share-quality';

export interface ScreenLinkOptions {
  iceServers: IceServer[];
  /** Handed to the gateway, which relays it to the other end of this session. */
  send: (signal: RemoteSignal) => void;
  /** Controller side only: the agent's screen has arrived. */
  onTrack?: (track: MediaStreamTrack | null) => void;
  /** Controller side only: the machine's own sound, when the session may hear it. */
  onAudio?: (track: MediaStreamTrack | null) => void;
  /** A chunk of a file arriving on the data channel. Bytes and nothing else. */
  onData?: (data: ArrayBuffer) => void;
  /** Either side: the connection is not coming back. */
  onFailed?: (reason: string) => void;
}

/**
 * How much may sit in the data channel's send buffer before the sender waits.
 *
 * A `send` that is never checked buffers the whole file in the browser and then
 * dies, because a data channel accepts writes far faster than the network
 * drains them. Eight megabytes is enough to keep a fast link saturated and
 * small enough that a cancel is felt within a second on a slow one.
 */
const SEND_BUFFER_HIGH = 8 * 1024 * 1024;
const SEND_BUFFER_LOW = 1 * 1024 * 1024;

export class ScreenLink {
  private readonly pc: RTCPeerConnection;
  private sender: RTCRtpSender | null = null;
  private transceiver: RTCRtpTransceiver | null = null;
  /** The machine's own sound. One transceiver whether or not anything is on it. */
  private audioSender: RTCRtpSender | null = null;
  /** Files, and only files. See `remote-transfer.ts` for what travels on it. */
  private channel: RTCDataChannel | null = null;
  private closed = false;
  /** Signals from the far end, applied strictly one at a time. See `accept`. */
  private readonly queue = serialize();

  /**
   * `sending` is what makes this the agent's end. It decides who offers and
   * which direction the one video transceiver points, and both ends have to
   * agree - which they do, because only one of them has a screen.
   */
  constructor(
    private readonly sending: boolean,
    private readonly options: ScreenLinkOptions,
  ) {
    this.pc = new RTCPeerConnection({
      iceServers: options.iceServers,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
    });

    // One transceiver, created up front on both sides so the m-lines match
    // without either end waiting for the other.
    this.transceiver = this.pc.addTransceiver('video', {
      direction: sending ? 'sendonly' : 'recvonly',
    });
    if (sending) this.sender = this.transceiver.sender;

    // An audio transceiver and a data channel exist for every session, whether
    // or not this one may use them. Both are cheap when empty and neither can
    // be added later without renegotiating, and a renegotiation part way
    // through a session is a black picture on the controller's screen for as
    // long as it takes. Permission decides what is *put* on them, which is
    // checked on the machine and again at the gateway - not whether they are
    // there.
    const audio = this.pc.addTransceiver('audio', {
      direction: sending ? 'sendonly' : 'recvonly',
    });
    if (sending) this.audioSender = audio.sender;

    // Negotiated, with an id both ends agree on up front, so neither has to
    // wait for `ondatachannel` and no second offer is needed to open it.
    this.channel = this.pc.createDataChannel('remote', {
      negotiated: true,
      id: 0,
      ordered: true,
    });
    this.channel.binaryType = 'arraybuffer';
    this.channel.bufferedAmountLowThreshold = SEND_BUFFER_LOW;
    this.channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) this.options.onData?.(event.data);
    };

    this.pc.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        this.options.onAudio?.(event.track);
        event.track.onended = () => this.options.onAudio?.(null);
        return;
      }
      // A desktop somebody is driving gets the smallest jitter buffer that
      // Chromium will accept. The default third of a second is the difference
      // between a usable session and an unusable one.
      (event.receiver as RTCRtpReceiver & { playoutDelayHint?: number }).playoutDelayHint =
        PLAYOUT_DELAY.driving;
      this.options.onTrack?.(event.track);
      event.track.onended = () => this.options.onTrack?.(null);
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.options.send({
        kind: 'ice',
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        },
      });
    };

    // Only the sending end offers, so there is no glare to resolve. This still
    // fires on the receiving end when the remote description arrives; ignoring
    // it there is deliberate.
    this.pc.onnegotiationneeded = () => {
      if (this.sending) void this.offer();
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed') this.pc.restartIce();
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed' && !this.closed) {
        this.options.onFailed?.('The connection to the other machine failed');
      }
    };
  }

  private publish: SharePublish | null = null;

  /**
   * Puts a display on the wire, or swaps the one already there.
   *
   * `replaceTrack` rather than a new transceiver, so switching monitors does
   * not renegotiate and the controller's picture does not go black while it
   * does.
   */
  async setDisplay(track: MediaStreamTrack | null, publish?: SharePublish): Promise<void> {
    if (!this.sender) return;
    this.publish = publish ?? null;
    await this.sender.replaceTrack(track).catch(() => undefined);
    if (!track || !publish) return;

    // The same encoder settings a screen share in a call uses: a remote desktop
    // is the 'detail' case of the same problem. `share-quality.ts` says why.
    try {
      const parameters = this.sender.getParameters();
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}];
      }
      const first = parameters.encodings[0];
      if (first) {
        first.maxBitrate = publish.maxBitrate;
        first.maxFramerate = publish.maxFramerate;
      }
      parameters.degradationPreference = publish.degradationPreference;
      await this.sender.setParameters(parameters);
    } catch {
      // A missing ceiling is a worse picture, not a dead session.
    }

    this.preferCodec(publish.videoCodec);
  }

  /**
   * Puts the machine's own sound on the wire, or takes it off.
   *
   * `replaceTrack` on a transceiver that has been there since the connection
   * was built, so turning audio on part way through a session costs nothing and
   * renegotiates nothing.
   */
  async setAudio(track: MediaStreamTrack | null): Promise<void> {
    if (!this.audioSender) return;
    await this.audioSender.replaceTrack(track).catch(() => undefined);
  }

  /** True once the data channel will accept a write. */
  get dataReady(): boolean {
    return this.channel?.readyState === 'open';
  }

  /**
   * Writes one chunk of a file, waiting when the buffer is full.
   *
   * The wait is the whole point: `send` never blocks and never fails on a slow
   * link, it just grows a buffer inside the browser until the tab dies. This
   * resolves when the chunk is queued and the queue is short enough to queue
   * another - so a caller that awaits it in a loop is paced by the network.
   */
  async sendBytes(chunk: Uint8Array<ArrayBuffer>): Promise<void> {
    const channel = this.channel;
    if (!channel || channel.readyState !== 'open') {
      throw new Error('The link to the machine is not open');
    }

    channel.send(chunk);
    if (channel.bufferedAmount < SEND_BUFFER_HIGH) return;

    await new Promise<void>((resolve, reject) => {
      const done = (): void => {
        channel.removeEventListener('bufferedamountlow', onLow);
        channel.removeEventListener('close', onClose);
      };
      const onLow = (): void => {
        done();
        resolve();
      };
      const onClose = (): void => {
        done();
        reject(new Error('The link to the machine closed'));
      };
      channel.addEventListener('bufferedamountlow', onLow);
      channel.addEventListener('close', onClose);
    });
  }

  /** Hardware H.264 where it exists, which is what makes 1080p60/4K affordable. */
  private preferCodec(codec: SharePublish['videoCodec']): void {
    if (!this.transceiver?.setCodecPreferences) return;
    try {
      const supported = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
      const sorted = sortPreferredVideoCodecs(supported, codec);
      this.transceiver.setCodecPreferences(sorted);
    } catch {
      // An optimisation; the session works without it.
    }
  }

  private async offer(): Promise<void> {
    if (this.closed) return;
    try {
      const offer = await this.pc.createOffer();
      let sdp = offer.sdp;
      if (sdp && this.publish) {
        sdp = patchVideoBandwidth(sdp, this.publish);
      }
      await this.pc.setLocalDescription({ type: 'offer', sdp: sdp ?? offer.sdp });
      const localSdp = this.pc.localDescription?.sdp;
      if (localSdp) this.options.send({ kind: 'offer', sdp: localSdp });
    } catch (error) {
      console.warn('[remote-peer] could not offer the screen', error);
    }
  }

  /**
   * A signal relayed from the other end of this session, queued behind the ones
   * already being applied.
   *
   * Same reason as `mesh.ts`: `accept` is async, the socket does not wait for
   * it, and the body is a critical section over `this.pc`. Two descriptions
   * arriving together - which switching the shared screen produces, since it
   * renegotiates - interleaved at the awaits, and the second reached
   * `setLocalDescription` after the first had already driven the connection to
   * `stable`, which throws.
   */
  accept(signal: RemoteSignal): Promise<void> {
    return this.queue(() => this.apply(signal));
  }

  private async apply(signal: RemoteSignal): Promise<void> {
    if (this.closed) return;
    try {
      if (signal.kind === 'ice') {
        await this.pc.addIceCandidate(signal.candidate).catch(() => undefined);
        return;
      }

      await this.pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });

      if (signal.kind === 'offer') {
        const answer = await this.pc.createAnswer();
        let sdp = answer.sdp;
        if (sdp && this.publish) {
          sdp = patchVideoBandwidth(sdp, this.publish);
        }
        await this.pc.setLocalDescription({ type: 'answer', sdp: sdp ?? answer.sdp });
        const localSdp = this.pc.localDescription?.sdp;
        if (localSdp) this.options.send({ kind: 'answer', sdp: localSdp });
      }
    } catch (error) {
      console.warn('[remote-peer] could not accept a signal', error);
    }
  }

  close(): void {
    this.closed = true;
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
    this.sender = null;
    this.audioSender = null;
    this.transceiver = null;
    this.pc.close();
  }
}
