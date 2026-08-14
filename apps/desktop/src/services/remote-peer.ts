/**
 * The peer connection a remote-desktop session's screen travels over.
 *
 * One connection, one direction: the agent sends a display, the controller
 * watches it. That is simpler than a call's mesh and is treated as such - there
 * is no perfect negotiation here, because the agent is always the one with
 * something to send and therefore always the one that offers.
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
import type { IceServer, RemoteSignal } from '@nexora/shared-types';
import { PLAYOUT_DELAY, type SharePublish } from './share-quality';

export interface ScreenLinkOptions {
  iceServers: IceServer[];
  /** Handed to the gateway, which relays it to the other end of this session. */
  send: (signal: RemoteSignal) => void;
  /** Controller side only: the agent's screen has arrived. */
  onTrack?: (track: MediaStreamTrack | null) => void;
  /** Either side: the connection is not coming back. */
  onFailed?: (reason: string) => void;
}

export class ScreenLink {
  private readonly pc: RTCPeerConnection;
  private sender: RTCRtpSender | null = null;
  private transceiver: RTCRtpTransceiver | null = null;
  private closed = false;

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

    this.pc.ontrack = (event) => {
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

  /**
   * Puts a display on the wire, or swaps the one already there.
   *
   * `replaceTrack` rather than a new transceiver, so switching monitors does
   * not renegotiate and the controller's picture does not go black while it
   * does.
   */
  async setDisplay(track: MediaStreamTrack | null, publish?: SharePublish): Promise<void> {
    if (!this.sender) return;
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

  /** Hardware H.264 where it exists, which is what makes 1080p60 affordable. */
  private preferCodec(codec: SharePublish['videoCodec']): void {
    if (!this.transceiver?.setCodecPreferences) return;
    try {
      const supported = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
      const wanted = supported.filter((entry) =>
        entry.mimeType.toLowerCase().endsWith(`/${codec.toLowerCase()}`),
      );
      if (wanted.length === 0) return;
      this.transceiver.setCodecPreferences([
        ...wanted,
        ...supported.filter((entry) => !wanted.includes(entry)),
      ]);
    } catch {
      // An optimisation; the session works without it.
    }
  }

  private async offer(): Promise<void> {
    if (this.closed) return;
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      const sdp = this.pc.localDescription?.sdp;
      if (sdp) this.options.send({ kind: 'offer', sdp });
    } catch (error) {
      console.warn('[remote-peer] could not offer the screen', error);
    }
  }

  /** A signal relayed from the other end of this session. */
  async accept(signal: RemoteSignal): Promise<void> {
    if (this.closed) return;
    try {
      if (signal.kind === 'ice') {
        await this.pc.addIceCandidate(signal.candidate).catch(() => undefined);
        return;
      }

      await this.pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });

      if (signal.kind === 'offer') {
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        const sdp = this.pc.localDescription?.sdp;
        if (sdp) this.options.send({ kind: 'answer', sdp });
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
    this.sender = null;
    this.transceiver = null;
    this.pc.close();
  }
}
