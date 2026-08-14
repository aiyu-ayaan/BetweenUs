/**
 * The peer connections a call is made of.
 *
 * There is no media server. Everyone in a call holds one `RTCPeerConnection`
 * per other participant - a full mesh - and voice, video and screen share go
 * directly between the two machines. `call-service` introduces the peers over
 * `/ws/call` and then has nothing further to do with the call; see
 * `call.gateway.ts` for the other half.
 *
 * Four things here are worth understanding before changing any of it.
 *
 * ## Fixed transceiver slots
 *
 * Every connection is built with exactly four transceivers, always in the same
 * order: microphone, camera, screen, screen audio. They are created empty and
 * stay for the life of the connection; turning a device on is `replaceTrack` on
 * a sender that already exists.
 *
 * That buys two things. Media that arrives can be identified by which slot it
 * came in on, with no side-channel to race against - the alternative is
 * announcing "the track you are about to receive is my screen" over the data
 * channel and hoping it lands first. And toggling a microphone, a camera or a
 * share never renegotiates: after the initial exchange, a call this size
 * usually never sends another offer.
 *
 * Both sides create the same four in the same order, so the m-lines match up by
 * position and each side's slot *n* is the other's slot *n*.
 *
 * ## Perfect negotiation
 *
 * Either side may find it needs to offer, and if both do at once the connection
 * would break. The standard answer is that one peer is "polite": it rolls back
 * its own offer when one arrives mid-flight, and the impolite peer's offer
 * wins. Politeness is decided by comparing peer ids, which both sides can do
 * without agreeing anything.
 *
 * ## The fingerprint signature
 *
 * An offer carries the DTLS fingerprint the far side will trust, and the offer
 * travels through `call-service`. A malicious signalling server could put its
 * own fingerprint in each direction and sit in the middle of a connection both
 * ends believe is direct - which would undo the whole point of not having a
 * server in the path.
 *
 * So each peer sends `HMAC-SHA256(channel key, its own fingerprint)` beside the
 * SDP, and the receiver recomputes it before accepting. The channel key is the
 * one the channel's messages are encrypted with; the server has never held it
 * and cannot produce the signature for a fingerprint of its own. A signal that
 * does not verify is dropped, and the peer connection is never established.
 *
 * ## Nothing here throws into the UI
 *
 * A peer that fails is one tile, not the call. Failures are reported through
 * `onPeerFailed` and the rest of the mesh carries on.
 */
import type {
  CallPeer,
  CallSignal,
  ClientCallEvent,
  IceCandidatePayload,
  IceServer,
  ServerCallEvent,
} from '@nexora/shared-types';
import { wsUrl } from './endpoint';
import { PLAYOUT_DELAY, type SharePublish } from './share-quality';
import type { MicEncoding } from './voice-quality';

/** What a slot carries. The order is the transceiver order and is load-bearing. */
export const SLOTS = ['mic', 'camera', 'screen', 'screenAudio'] as const;
export type Slot = (typeof SLOTS)[number];

const SLOT_KIND: Record<Slot, 'audio' | 'video'> = {
  mic: 'audio',
  camera: 'video',
  screen: 'video',
  screenAudio: 'audio',
};

/** How often remote audio levels are read, for the speaking ring. */
const SPEAKING_POLL_MS = 200;

/**
 * Audio level above which somebody counts as speaking.
 *
 * `getSynchronizationSources` reports 0..1, roughly linear in amplitude. This
 * is about -40 dBFS: below a voice, above the residue a suppressor leaves.
 */
const SPEAKING_LEVEL = 0.01;

export interface MeshEvents {
  /** A track arrived, or went away (`track: null`), on one peer's slot. */
  onTrack: (peerId: string, slot: Slot, track: MediaStreamTrack | null) => void;
  /** The roster changed. Always the full list, so a consumer needs no diffing. */
  onPeers: (peers: CallPeer[]) => void;
  /** Identities currently speaking, local included. */
  onSpeaking: (speaking: Set<string>) => void;
  /** A message on a peer's data channel. */
  onData: (peer: CallPeer, payload: unknown) => void;
  /**
   * One peer is in trouble, but the call is not over.
   *
   * This exists because the first version of this file logged every negotiation
   * failure to the console and nowhere else, so a call where nothing connected
   * looked exactly like a call that was working - two tiles, no media, no
   * message. A failure the person in the call cannot see is a failure nobody
   * can report.
   */
  onProblem: (message: string) => void;
  /** The call cannot continue - the socket died, or the server refused. */
  onFatal: (message: string) => void;
}

interface MeshOptions extends MeshEvents {
  channelId: string;
  token: string;
  iceServers: IceServer[];
  /** The channel key, used only to sign and verify DTLS fingerprints. */
  channelKey: string;
}

/**
 * The DTLS fingerprint out of an SDP blob.
 *
 * There is one per session in everything Chromium produces. Taking the first
 * and requiring it to exist is deliberate: an SDP with no fingerprint cannot be
 * verified, and accepting it unverified would be the hole this closes.
 */
export function fingerprintOf(sdp: string): string | null {
  const match = /^a=fingerprint:(\S+)\s+(\S+)/m.exec(sdp);
  return match ? `${match[1]} ${match[2]}` : null;
}

/** `HMAC-SHA256(channel key, fingerprint)`, base64. */
export async function signFingerprint(channelKey: string, fingerprint: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(fingerprint));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Whether `proof` is the signature of this SDP's fingerprint.
 *
 * Never throws: a malformed SDP, a missing fingerprint and a wrong signature
 * are all the same answer - do not connect to this.
 */
export async function verifyFingerprint(
  channelKey: string,
  sdp: string,
  proof: string,
): Promise<boolean> {
  try {
    const fingerprint = fingerprintOf(sdp);
    if (!fingerprint) return false;
    const expected = await signFingerprint(channelKey, fingerprint);
    // Both are base64 of the same length, so a plain comparison leaks only
    // whether they matched - which the caller is about to act on anyway.
    return expected === proof;
  } catch {
    return false;
  }
}

/**
 * Opus options live in the SDP's `fmtp` line and cannot be changed on a live
 * sender, so they are patched into the local description before it is set.
 *
 * `stereo`/`sprop-stereo` are what make a music-mode microphone or a film's
 * soundtrack arrive in two channels at all - without them the far end decodes
 * mono however many channels were captured. `usedtx` is the opposite: it saves
 * bandwidth in a conversation and deletes the quiet parts of music.
 */
export function patchOpus(sdp: string, options: MicEncoding): string {
  const payload = /^a=rtpmap:(\d+)\s+opus\/48000/im.exec(sdp)?.[1];
  if (!payload) return sdp;

  const wanted = [
    `stereo=${options.stereo ? 1 : 0}`,
    `sprop-stereo=${options.stereo ? 1 : 0}`,
    `usedtx=${options.dtx ? 1 : 0}`,
    `maxaveragebitrate=${options.maxBitrate}`,
  ].join(';');

  const line = new RegExp(`^a=fmtp:${payload} (.*)$`, 'm');
  return line.test(sdp)
    ? sdp.replace(line, (_match, existing: string) => `a=fmtp:${payload} ${existing};${wanted}`)
    : sdp.replace(
        new RegExp(`^(a=rtpmap:${payload} opus/48000.*)$`, 'im'),
        `$1\r\na=fmtp:${payload} ${wanted}`,
      );
}

/**
 * One peer connection, and everything that hangs off it.
 *
 * `ponytail`: the four slots are hard-coded rather than negotiated. A fifth
 * kind of media means adding a slot here and shipping both sides together;
 * per-connection negotiation is the upgrade path if that ever stops being
 * acceptable.
 */
class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly channel: RTCDataChannel;

  private readonly senders = new Map<Slot, RTCRtpSender>();
  private readonly transceivers = new Map<Slot, RTCRtpTransceiver>();
  /** Perfect negotiation bookkeeping. */
  private makingOffer = false;
  private ignoreOffer = false;
  private readonly polite: boolean;
  private micEncoding: MicEncoding | null = null;
  private closed = false;
  /**
   * Candidates that arrived before there was a remote description to attach
   * them to.
   *
   * This is not an edge case, it is the normal path: both peers offer at once,
   * so each one's candidates start arriving while the other is still resolving
   * the glare. `addIceCandidate` rejects with `InvalidStateError` until
   * `setRemoteDescription` has run, and a candidate dropped there is dropped
   * for good - which is a connection that negotiates fine and then never
   * carries a packet.
   */
  private readonly pendingCandidates: IceCandidatePayload[] = [];

  constructor(
    readonly peer: CallPeer,
    selfPeerId: string,
    iceServers: IceServer[],
    private readonly channelKey: string,
    private readonly send: (signal: CallSignal) => void,
    private readonly events: {
      onTrack: (slot: Slot, track: MediaStreamTrack | null) => void;
      onData: (payload: unknown) => void;
      onFailed: () => void;
      /** Something went wrong that the person in the call should be told about. */
      onProblem: (message: string) => void;
    },
  ) {
    // Whoever has the larger peer id yields. Both sides compute this from the
    // same two strings, so they always disagree - which is the point.
    this.polite = selfPeerId > peer.peerId;

    this.pc = new RTCPeerConnection({
      iceServers,
      // A direct path whenever there is one. Never 'relay': forcing everybody
      // through a TURN server would spend bandwidth on the calls that were
      // going to work anyway, which is most of them.
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
    });

    // The four slots, in order, on both sides. Created before anything is
    // negotiated, so the m-lines line up by position.
    for (const slot of SLOTS) {
      const transceiver = this.pc.addTransceiver(SLOT_KIND[slot], { direction: 'sendrecv' });
      this.transceivers.set(slot, transceiver);
      this.senders.set(slot, transceiver.sender);
    }

    // Negotiated on both sides with a fixed id, so neither has to wait for the
    // other's `ondatachannel` and there is no race about who opens it.
    this.channel = this.pc.createDataChannel('nexora.share', { negotiated: true, id: 0 });
    this.channel.onmessage = (event) => {
      try {
        this.events.onData(JSON.parse(String(event.data)));
      } catch {
        // A peer sending something unparseable is not this call's problem.
      }
    };

    this.pc.ontrack = (event) => {
      const slot = this.slotOf(event.transceiver);
      if (!slot) return;

      if (slot === 'screen') {
        // A jitter buffer left alone is a third of a second between moving the
        // mouse and seeing it move.
        this.setPlayoutDelay(event.receiver, PLAYOUT_DELAY.watching);
      }

      this.events.onTrack(slot, event.track);
      // A remote track that ends is a device switched off at the far end. The
      // slot stays; what was in it does not.
      event.track.onended = () => this.events.onTrack(slot, null);
      event.track.onmute = () => this.events.onTrack(slot, null);
      event.track.onunmute = () => this.events.onTrack(slot, event.track);
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.send({
        kind: 'ice',
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        },
      });
    };

    this.pc.onnegotiationneeded = () => {
      void this.offer();
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed') {
        // One restart, then give up on this peer. A mesh with one dead link is
        // a call with one silent tile, not a call that ends.
        this.pc.restartIce();
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed' && !this.closed) this.events.onFailed();
    };
  }

  /**
   * Applies everything that arrived too early. Called immediately after a
   * remote description lands, which is the first moment these are legal.
   */
  private async flushCandidates(): Promise<void> {
    const queued = this.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn('[mesh] queued ICE candidate rejected', error);
      }
    }
  }

  private slotOf(transceiver: RTCRtpTransceiver): Slot | null {
    for (const [slot, candidate] of this.transceivers) {
      if (candidate === transceiver) return slot;
    }
    return null;
  }

  /**
   * `playoutDelayHint` is Chromium's and is not in the DOM types. Absent
   * elsewhere, where the default buffer is what a viewer gets.
   */
  private setPlayoutDelay(receiver: RTCRtpReceiver, seconds: number): void {
    (receiver as RTCRtpReceiver & { playoutDelayHint?: number }).playoutDelayHint = seconds;
  }

  /** Asks for less buffering on the screen, for whoever is driving it. */
  setDriving(driving: boolean): void {
    const receiver = this.transceivers.get('screen')?.receiver;
    if (receiver) {
      this.setPlayoutDelay(receiver, driving ? PLAYOUT_DELAY.driving : PLAYOUT_DELAY.watching);
    }
  }

  private async offer(): Promise<void> {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      await this.setLocalDescription('offer');
      await this.sendDescription();
    } catch (error) {
      this.fail('could not offer', error);
    } finally {
      this.makingOffer = false;
    }
  }

  /**
   * Sets the local description, with the Opus options patched in when they will
   * be accepted.
   *
   * The patch is a preference, not a requirement: `stereo` and `usedtx` are
   * only settable in the SDP, and Chromium has grown steadily stricter about
   * accepting an SDP it did not write. So the munged one is tried first and the
   * untouched one is the fallback - a mono call is a call, and a rejected
   * description is silence.
   */
  private async setLocalDescription(type: 'offer' | 'answer'): Promise<void> {
    const description =
      type === 'offer' ? await this.pc.createOffer() : await this.pc.createAnswer();

    if (this.micEncoding && description.sdp) {
      try {
        await this.pc.setLocalDescription({
          type: description.type,
          sdp: patchOpus(description.sdp, this.micEncoding),
        });
        return;
      } catch (error) {
        console.warn('[mesh] Opus options refused, continuing without them', error);
      }
    }

    await this.pc.setLocalDescription(description);
  }

  /** One place for "this peer is not going to work, and here is why". */
  private fail(what: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[mesh] ${what} (${this.peer.username}/${this.peer.peerId}):`, error);
    this.events.onProblem(`${this.peer.username}: ${what} - ${reason}`);
  }

  private async sendDescription(): Promise<void> {
    const description = this.pc.localDescription;
    if (!description?.sdp) return;

    const fingerprint = fingerprintOf(description.sdp);
    if (!fingerprint) {
      // Nothing to sign means nothing the far end can verify. Sending it anyway
      // would be handing them a connection they have to trust blindly.
      this.fail('no DTLS fingerprint to sign, so nothing was sent', new Error('no fingerprint'));
      return;
    }

    this.send({
      kind: description.type === 'offer' ? 'offer' : 'answer',
      sdp: description.sdp,
      fingerprintProof: await signFingerprint(this.channelKey, fingerprint),
    });
  }

  /** The perfect-negotiation receive path, verbatim from the WebRTC spec's shape. */
  async accept(signal: CallSignal): Promise<void> {
    if (this.closed) return;

    try {
      if (signal.kind === 'ice') {
        // Held rather than applied when there is nothing to apply them to yet.
        // See `pendingCandidates`: dropping these is a call that connects and
        // then stays silent.
        if (!this.pc.remoteDescription) {
          this.pendingCandidates.push(signal.candidate);
          return;
        }
        try {
          await this.pc.addIceCandidate(signal.candidate);
        } catch (error) {
          // A candidate arriving during a rolled-back offer is expected and
          // harmless; anything else is worth a line but not the call.
          if (!this.ignoreOffer) console.warn('[mesh] ICE candidate rejected', error);
        }
        return;
      }

      // The check that makes the relay untrusted. A server that swapped the
      // fingerprint cannot produce this, so the connection is never made.
      if (!(await verifyFingerprint(this.channelKey, signal.sdp, signal.fingerprintProof))) {
        console.error(
          '[mesh] refusing a peer whose DTLS fingerprint is not signed with the channel key',
          this.peer.peerId,
        );
        // Said out loud rather than left as a tile that never carries anything.
        // The honest cause is almost always the two devices holding different
        // channel-key epochs, not an attack - but the connection is refused
        // either way, because the two cases look identical from here.
        this.events.onProblem(
          `${this.peer.username}: refused - their media key does not match this channel's`,
        );
        this.events.onFailed();
        return;
      }

      const offerCollision =
        signal.kind === 'offer' &&
        (this.makingOffer || this.pc.signalingState !== 'stable');

      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      await this.pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
      await this.flushCandidates();

      if (signal.kind === 'offer') {
        await this.setLocalDescription('answer');
        await this.sendDescription();
      }
    } catch (error) {
      this.fail(`could not accept an ${signal.kind}`, error);
    }
  }

  /**
   * Puts a track on a slot, or takes it off with `null`.
   *
   * `replaceTrack` on an existing sender does not renegotiate, which is what
   * makes toggling a microphone free.
   */
  async setTrack(slot: Slot, track: MediaStreamTrack | null): Promise<void> {
    const sender = this.senders.get(slot);
    if (!sender) return;
    await sender.replaceTrack(track).catch(() => undefined);
  }

  /** Bitrate and degradation on a live sender; no renegotiation. */
  async tune(
    slot: Slot,
    encoding: { maxBitrate?: number; maxFramerate?: number },
    degradation?: RTCDegradationPreference,
  ): Promise<void> {
    const sender = this.senders.get(slot);
    if (!sender) return;

    try {
      const parameters = sender.getParameters();
      // A sender that has not negotiated yet has no encodings to change.
      if (!parameters.encodings || parameters.encodings.length === 0) {
        parameters.encodings = [{}];
      }
      const first = parameters.encodings[0];
      if (first) {
        if (encoding.maxBitrate !== undefined) first.maxBitrate = encoding.maxBitrate;
        if (encoding.maxFramerate !== undefined) first.maxFramerate = encoding.maxFramerate;
      }
      if (degradation) parameters.degradationPreference = degradation;
      await sender.setParameters(parameters);
    } catch (error) {
      // Losing a bitrate ceiling is a worse picture, not a broken call.
      console.warn('[mesh] could not tune', slot, error);
    }
  }

  /** Remembered so every future offer and answer carries the same Opus options. */
  setMicEncoding(encoding: MicEncoding): void {
    this.micEncoding = encoding;
  }

  /**
   * Asks for H.264 on the screen slot, where hardware encoding is what makes
   * 1080p60 possible. Ignored where the codec is unavailable.
   */
  preferShareCodec(codec: SharePublish['videoCodec']): void {
    const transceiver = this.transceivers.get('screen');
    if (!transceiver?.setCodecPreferences) return;

    try {
      const supported = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
      const wanted = supported.filter((entry) =>
        entry.mimeType.toLowerCase().endsWith(`/${codec.toLowerCase()}`),
      );
      if (wanted.length === 0) return;
      const rest = supported.filter((entry) => !wanted.includes(entry));
      transceiver.setCodecPreferences([...wanted, ...rest]);
    } catch {
      // Codec preferences are an optimisation; the call works without them.
    }
  }

  /** Audio levels this peer is producing right now, 0..1. */
  audioLevel(): number {
    let loudest = 0;
    for (const slot of ['mic', 'screenAudio'] as const) {
      const receiver = this.transceivers.get(slot)?.receiver;
      if (!receiver?.getSynchronizationSources) continue;
      for (const source of receiver.getSynchronizationSources()) {
        loudest = Math.max(loudest, source.audioLevel ?? 0);
      }
    }
    return loudest;
  }

  send_(payload: unknown): void {
    if (this.channel.readyState !== 'open') return;
    try {
      this.channel.send(JSON.stringify(payload));
    } catch {
      // A full or closing channel drops a pointer update. Nothing to do.
    }
  }

  close(): void {
    this.closed = true;
    this.channel.onmessage = null;
    this.pc.ontrack = null;
    this.pc.onicecandidate = null;
    this.pc.onnegotiationneeded = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    try {
      this.channel.close();
    } catch {
      // Already gone.
    }
    this.pc.close();
  }
}

/**
 * A call: the signalling socket, the peers, and the local tracks sent to all of
 * them.
 *
 * One instance per call. `close()` ends it and releases nothing else - the
 * tracks belong to whoever captured them.
 */
export class Mesh {
  private socket: WebSocket | null = null;
  private selfPeerId: string | null = null;
  private readonly links = new Map<string, PeerLink>();
  private readonly local = new Map<Slot, MediaStreamTrack | null>();
  private micEncoding: MicEncoding | null = null;
  private sharePublish: SharePublish | null = null;
  private speakingTimer: number | null = null;
  /** Local speaking, fed by the microphone gate rather than by statistics. */
  private localSpeaking = false;
  private lastSpeaking = '';
  private closed = false;

  constructor(private readonly options: MeshOptions) {}

  /** Opens the socket and joins. Resolves once the server has answered. */
  async join(): Promise<void> {
    const { channelId, token } = this.options;
    const socket = new WebSocket(`${wsUrl()}/ws/call?token=${encodeURIComponent(token)}`);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('The call server did not answer')),
        15_000,
      );

      socket.onopen = () => this.send({ type: 'join', channelId });

      socket.onmessage = (raw) => {
        let event: ServerCallEvent;
        try {
          event = JSON.parse(String(raw.data)) as ServerCallEvent;
        } catch {
          return;
        }

        if (event.type === 'joined') {
          window.clearTimeout(timeout);
          resolve();
        }
        if (event.type === 'error') {
          window.clearTimeout(timeout);
          reject(new Error(event.message));
        }
        void this.handle(event);
      };

      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Could not reach the call server'));
      };

      socket.onclose = () => {
        window.clearTimeout(timeout);
        // A call whose signalling is gone cannot admit anyone or recover a
        // failed peer, so it ends rather than pretending otherwise.
        if (!this.closed) this.options.onFatal('The connection to the call server was lost');
        reject(new Error('The connection to the call server was lost'));
      };
    });

    this.startSpeakingPoll();
  }

  private async handle(event: ServerCallEvent): Promise<void> {
    switch (event.type) {
      case 'ready':
        this.selfPeerId = event.peerId;
        return;

      case 'joined':
        // Everyone already here. We arrived last, so we connect outward to all
        // of them; each of them sees a `peer.joined` for us at the same moment
        // and perfect negotiation settles who actually offers.
        for (const peer of event.peers) this.link(peer);
        this.announcePeers();
        return;

      case 'peer.joined':
        this.link(event.peer);
        this.announcePeers();
        return;

      case 'peer.left': {
        this.links.get(event.peerId)?.close();
        this.links.delete(event.peerId);
        for (const slot of SLOTS) this.options.onTrack(event.peerId, slot, null);
        this.announcePeers();
        return;
      }

      case 'signal': {
        await this.links.get(event.from)?.accept(event.data);
        return;
      }

      case 'error':
        console.warn('[mesh] signalling error', event.code, event.message);
        return;

      default:
        return;
    }
  }

  private link(peer: CallPeer): PeerLink {
    const existing = this.links.get(peer.peerId);
    if (existing) return existing;

    const link = new PeerLink(
      peer,
      this.selfPeerId ?? '',
      this.options.iceServers,
      this.options.channelKey,
      (signal) => this.send({ type: 'signal', to: peer.peerId, data: signal }),
      {
        onTrack: (slot, track) => this.options.onTrack(peer.peerId, slot, track),
        onData: (payload) => this.options.onData(peer, payload),
        onFailed: () => {
          this.links.get(peer.peerId)?.close();
          this.links.delete(peer.peerId);
          for (const slot of SLOTS) this.options.onTrack(peer.peerId, slot, null);
          this.announcePeers();
        },
        onProblem: (message) => this.options.onProblem(message),
      },
    );

    if (this.micEncoding) link.setMicEncoding(this.micEncoding);
    if (this.sharePublish) link.preferShareCodec(this.sharePublish.videoCodec);
    this.links.set(peer.peerId, link);

    // Whatever this client is already sending goes onto the new connection
    // before it negotiates, so a peer joining mid-call sees the share that
    // started before they arrived.
    for (const [slot, track] of this.local) {
      if (track) void link.setTrack(slot, track);
    }
    void this.applyTuning(link);

    return link;
  }

  private announcePeers(): void {
    this.options.onPeers([...this.links.values()].map((link) => link.peer));
  }

  /** Sends (or stops sending) one kind of media to everybody. */
  async setTrack(slot: Slot, track: MediaStreamTrack | null): Promise<void> {
    this.local.set(slot, track);
    await Promise.all([...this.links.values()].map((link) => link.setTrack(slot, track)));
    if (track) await Promise.all([...this.links.values()].map((link) => this.applyTuning(link)));
  }

  private async applyTuning(link: PeerLink): Promise<void> {
    if (this.micEncoding) {
      await link.tune('mic', { maxBitrate: this.micEncoding.maxBitrate });
    }
    if (this.sharePublish) {
      await link.tune(
        'screen',
        { maxBitrate: this.sharePublish.maxBitrate, maxFramerate: this.sharePublish.maxFramerate },
        this.sharePublish.degradationPreference,
      );
      if (this.sharePublish.audio) {
        await link.tune('screenAudio', { maxBitrate: this.sharePublish.audio.maxBitrate });
      }
    }
  }

  async setMicEncoding(encoding: MicEncoding): Promise<void> {
    this.micEncoding = encoding;
    for (const link of this.links.values()) link.setMicEncoding(encoding);
    await Promise.all(
      [...this.links.values()].map((link) => link.tune('mic', { maxBitrate: encoding.maxBitrate })),
    );
  }

  async setSharePublish(publish: SharePublish | null): Promise<void> {
    this.sharePublish = publish;
    if (!publish) return;
    for (const link of this.links.values()) link.preferShareCodec(publish.videoCodec);
    await Promise.all([...this.links.values()].map((link) => this.applyTuning(link)));
  }

  /** Whether this client is driving somebody's share, which changes buffering. */
  setDriving(driving: boolean): void {
    for (const link of this.links.values()) link.setDriving(driving);
  }

  /** Fed by the microphone gate: it already measures the level on the audio thread. */
  setLocalSpeaking(speaking: boolean): void {
    this.localSpeaking = speaking;
  }

  /** Broadcasts on every peer's data channel, or to one peer. */
  sendData(payload: unknown, to?: string[]): void {
    if (to) {
      for (const peerId of to) this.links.get(peerId)?.send_(payload);
      return;
    }
    for (const link of this.links.values()) link.send_(payload);
  }

  get peers(): CallPeer[] {
    return [...this.links.values()].map((link) => link.peer);
  }

  get selfId(): string | null {
    return this.selfPeerId;
  }

  /**
   * Who is talking.
   *
   * Polled rather than event-driven because WebRTC has no "somebody started
   * speaking" event: the level is a statistic, and reading it ten times a
   * second is both cheap and faster than a person notices.
   */
  private startSpeakingPoll(): void {
    this.speakingTimer = window.setInterval(() => {
      const speaking = new Set<string>();
      if (this.localSpeaking) speaking.add('local');
      for (const link of this.links.values()) {
        if (link.audioLevel() >= SPEAKING_LEVEL) speaking.add(link.peer.peerId);
      }

      // Only when it changes: this runs five times a second and every call
      // re-renders the whole grid.
      const key = [...speaking].sort().join(',');
      if (key === this.lastSpeaking) return;
      this.lastSpeaking = key;
      this.options.onSpeaking(speaking);
    }, SPEAKING_POLL_MS);
  }

  private send(event: ClientCallEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  close(): void {
    this.closed = true;
    if (this.speakingTimer !== null) window.clearInterval(this.speakingTimer);
    this.speakingTimer = null;
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.local.clear();
    this.send({ type: 'leave' });
    this.socket?.close();
    this.socket = null;
  }
}
