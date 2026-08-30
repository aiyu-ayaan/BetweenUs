/**
 * The peer connections a call is made of.
 *
 * There is no media server. Everyone in a call holds one `RTCPeerConnection`
 * per other participant - a full mesh - and voice, video and screen share go
 * directly between the two machines. `call-service` introduces the peers over
 * `/ws/call` and then has nothing further to do with the call; see
 * `call.gateway.ts` for the other half.
 *
 * Five things here are worth understanding before changing any of it.
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
 * Only one side creates them: the impolite one. The other adopts the four the
 * offer brings with it - see `adopt`. Both sides creating their own is the
 * shape this file had when a call connected, showed everybody, and carried no
 * media at all: two sets of four m-lines that no offer could pair up, so every
 * arriving track landed on a transceiver the receiving side did not recognise
 * and was thrown away.
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
 * ## Nothing is given up on quickly
 *
 * A link that stops carrying media is not a link that is over. It gets a grace
 * period, then backed-off ICE restarts under the policy in `call-recovery.ts`,
 * and if those are spent it is *still* left in the mesh - because nothing here
 * ever re-adds a link, so removing one is permanent, and a pair that ends up
 * unrecoverable from this side may be perfectly fine from every other. Who is
 * in a call is the roster's answer, never a link's guess.
 *
 * The signalling socket gets the same treatment. It is not in the media path,
 * so losing it stops nothing that is already connected; it reconnects quietly
 * and resumes the seat the gateway held for it, and only a loss that outlasts
 * `SIGNALLING_DEADLINE_MS` ends the call.
 *
 * ## Nothing here throws into the UI
 *
 * A peer in trouble is one tile, not the call. Trouble is reported through
 * `onProblem` and the rest of the mesh carries on.
 */
import type {
  CallLinkReport,
  CallPeer,
  CallSignal,
  ClientCallEvent,
  IceCandidatePayload,
  GameSession,
  IceServer,
  ListenSession,
  ServerCallEvent,
} from '@betweenus/shared-types';
import type { ClockSample } from './listen-sync';
import { serialize } from './signal-queue';
import { wsUrl } from './endpoint';
import { deviceId } from './e2ee';
import {
  PLAYOUT_DELAY,
  patchVideoBandwidth,
  sortPreferredVideoCodecs,
  type SharePublish,
} from './share-quality';
import type { MicEncoding } from './voice-quality';
import { toStats, type LinkSample, type LinkStats } from './call-stats';
import {
  GRACE_MS,
  SIGNALLING_DEADLINE_MS,
  backoffMs,
  restarts,
  signallingBackoffMs,
  spent,
} from './call-recovery';

/** The Listen Together half of the client protocol, so the store cannot send anything else. */
export type ListenClientEvent = Extract<ClientCallEvent, { type: `listen.${string}` }>;

/** The Play Together half, on the same terms. */
export type GameClientEvent = Extract<ClientCallEvent, { type: `game.${string}` }>;

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
 * How long an offer may go unanswered before it is sent again. See `chase`.
 *
 * Long enough that a slow answer is not chased - the far end has a key read and
 * an `adopt` to do first - and short enough that nobody sits looking at
 * "Connecting…" wondering whether to leave.
 */
const CONNECT_DEADLINE_MS = 8_000;

/** How many times an unanswered offer is sent again before giving up. */
const CONNECT_ATTEMPTS = 4;

/**
 * How many times one link is torn down and built again from nothing.
 *
 * This is the thing people were doing by hand. Without a relay there are pairs
 * of networks that cannot form a direct path at all, and there are pairs that
 * merely *did not* - a candidate that lost a race, a NAT binding that landed on
 * a port the far end had already given up on. The two are indistinguishable
 * from in here, and the only move that separates them is trying again with
 * fresh ports, which is exactly what leaving the call and rejoining did.
 *
 * An ICE restart is not that move. It reuses the connection, and a connection
 * whose ports are the problem restarts onto the same problem. Only a new
 * `RTCPeerConnection` gathers genuinely new candidates.
 *
 * Three, because each one is only reached after a whole recovery budget has
 * been spent - four ICE restarts and thirty seconds - so three rebuilds is
 * three complete, independent failures. A pair that cannot manage it in three
 * is a pair with no path, and going round again would be a spinner pretending
 * otherwise.
 *
 * ponytail: a flat cap for the life of the call rather than one that resets on
 * a good stretch. A four-hour call on a train could spend it and then have
 * nothing left; reset it from a `connected` transition if that ever happens to
 * somebody.
 */
const REBUILD_ATTEMPTS = 3;

/**
 * How long after a spent link before it is rebuilt.
 *
 * Long enough that a far end doing the same arithmetic has finished its own
 * teardown - two peers rebuilding into each other's closing connections is a
 * pair that never settles - and short enough to be over before anybody has
 * decided to leave and do it themselves.
 */
const REBUILD_DELAY_MS = 2_000;

/**
 * The shortest gap between two re-reads of the channel key for one peer.
 *
 * The re-read exists for an epoch that changed under a live call. The cooldown
 * exists so a proof that is simply wrong cannot turn every arriving description
 * into a request to the key directory.
 */
const KEY_REREAD_COOLDOWN_MS = 5_000;

/** Speaking polls per check of whether video is really arriving - so, a second. */
const VIDEO_POLL_EVERY = 5;

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
  /** A peer's data channel can send reliable application state. */
  onDataOpen?: (peer: CallPeer) => void;
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
  /**
   * Who is sharing their screen, as the gateway sees it, or null for nobody.
   *
   * One share per call: a second one replaces the first rather than joining it,
   * so the peer that was sharing hears this with somebody else's id in it and
   * stops. Arbitrated at the gateway because two people pressing the button at
   * the same moment need one answer, and a mesh has no ordering to give one.
   */
  onScreenHolder?: (peerId: string | null) => void;
  /**
   * The call's Listen Together session, or null when there is not one.
   *
   * Whole state rather than a delta, and it arrives here rather than on a data
   * channel deliberately: a data channel is per peer, so a queue sent over one
   * would be as many queues as there are peers, each with its own idea of what
   * happened first. The gateway is the only thing in a mesh that can order two
   * people pressing pause at the same moment.
   */
  onListen?: (session: ListenSession | null) => void;
  /**
   * The game being played in this call, or null when there is not one.
   *
   * Here rather than on a data channel for the reason the listening session is:
   * a data channel is per peer, so a board sent over one would be as many
   * boards as there are peers, each with its own idea of which click came
   * first. The gateway referees, and this is what it says came of a move.
   */
  onGame?: (session: GameSession | null) => void;
  /**
   * One measurement of the gateway's clock against this machine's.
   *
   * Listening together means agreeing on a position, and a position is only
   * meaningful on a clock both ends share - two laptops disagree about the time
   * by whatever their NTP daemons last settled on. See `listen-sync.ts`.
   */
  onServerTime?: (sample: ClockSample) => void;
}

interface MeshOptions extends MeshEvents {
  channelId: string;
  token: string;
  iceServers: IceServer[];
  /**
   * The channel key, used only to sign and verify DTLS fingerprints.
   *
   * A function rather than a value because the key rotates *during* a call: a
   * member who joins a channel holding none of its keys mints the next epoch
   * to get one at all, so the moment somebody new arrives everybody already in
   * the call is a generation behind them. `refresh` re-reads the directory.
   */
  channelKey: (refresh?: boolean) => Promise<string>;
}

/** Waits. The recovery loop is a sequence of waits and the WebRTC API is not. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
 * Verifies, re-reading the channel key once when the first try fails.
 *
 * The re-read is the whole point. Two people joining at the same moment, or a
 * member removed mid-call, rotate the channel's epoch underneath a connection
 * that is already open, and without this the peer holding the *newer* key is
 * refused as though it were the relay standing in the middle. Once only,
 * though: a proof that is simply wrong must not become a way to make this
 * client hammer the key directory.
 */
export async function verifyFingerprintWithRefresh(
  channelKey: (refresh?: boolean) => Promise<string>,
  sdp: string,
  proof: string,
): Promise<boolean> {
  if (await verifyFingerprint(await channelKey(), sdp, proof)) return true;
  return verifyFingerprint(await channelKey(true), sdp, proof);
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
  /**
   * Signals from this peer, applied strictly one at a time.
   *
   * `accept` is async and the socket dispatches into it without waiting, so two
   * descriptions arriving close together used to run *concurrently* and
   * interleave at every `await` inside. The state checks below read
   * `signalingState` before `verify`, which can go to the network for a fresh
   * channel key, so the second run acted on a reading the first had already
   * invalidated. See `signal-queue.ts` for the failure it produced.
   */
  private readonly queue = serialize();
  /** When the channel key was last re-read for this peer. See `verify`. */
  private keyReadAt = 0;
  /** Offers sent for a link that never got an answer. See `chase`. */
  private connectAttempts = 0;
  private connectTimer: number | null = null;
  /** Whether a recovery loop is running, so a flapping link starts only one. */
  private recovering = false;
  /** When the media stopped, so the deadline is measured from the fault. */
  private downSince: number | null = null;
  /** ICE restarts spent on this link since it last carried media. */
  private recoveryAttempts = 0;
  private readonly polite: boolean;
  private micEncoding: MicEncoding | null = null;
  private sharePublish: SharePublish | null = null;
  private closed = false;
  /**
   * What this client wants to be sending, held for the answering side: it has
   * no senders until the offer arrives, and a microphone opened before that
   * would otherwise be asked for once and never sent.
   */
  private readonly wanted = new Map<Slot, MediaStreamTrack | null>();
  /** Remembered for the same reason: the screen slot may not exist yet. */
  private shareCodec: SharePublish['videoCodec'] | null = null;
  /** Video slots that have decoded at least one frame. See `pollVideo`. */
  private readonly liveVideo = new Set<Slot>();
  /** How loud this peer is, 0..1. See `pollAudioLevel`. */
  private level = 0;
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
    private readonly channelKey: (refresh?: boolean) => Promise<string>,
    private readonly send: (signal: CallSignal) => void,
    private readonly events: {
      onTrack: (slot: Slot, track: MediaStreamTrack | null) => void;
      onData: (payload: unknown) => void;
      onDataOpen: () => void;
      /**
       * Everything this link can do by itself has been done and none of it
       * worked. Only the mesh can act on it: what is left to try is a new
       * connection, and a link cannot replace itself.
       */
      onExhausted: () => void;
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
      // Start gathering before there is anything to gather for, so the first
      // offer already carries candidates instead of trickling them behind
      // itself. One is enough with `max-bundle`: there is a single transport.
      iceCandidatePoolSize: 1,
    });

    // The four slots, in order - created by the offering side only. See
    // `adopt`: creating them on both sides is what produced nine m-lines and a
    // call where no media was ever received.
    if (!this.polite) {
      for (const slot of SLOTS) {
        const encodings: RTCRtpEncodingParameters[] =
          slot === 'screen'
            ? [
                {
                  maxBitrate: 50_000_000,
                  maxFramerate: 60,
                  priority: 'high',
                  networkPriority: 'high',
                },
              ]
            : [];
        const transceiver = this.pc.addTransceiver(SLOT_KIND[slot], {
          direction: 'sendrecv',
          sendEncodings: encodings.length > 0 ? encodings : undefined,
        });
        this.transceivers.set(slot, transceiver);
        this.senders.set(slot, transceiver.sender);
      }
      this.preferShareCodec('H264');
    }

    // Negotiated on both sides with a fixed id, so neither has to wait for the
    // other's `ondatachannel` and there is no race about who opens it.
    this.channel = this.pc.createDataChannel('betweenus.share', { negotiated: true, id: 0 });
    this.channel.onmessage = (event) => {
      try {
        this.events.onData(JSON.parse(String(event.data)));
      } catch {
        // A peer sending something unparseable is not this call's problem.
      }
    };
    this.channel.onopen = () => this.events.onDataOpen();

    this.pc.ontrack = (event) => {
      const slot = this.slotOf(event.transceiver);
      if (!slot) return;

      if (slot === 'screen') {
        // A jitter buffer left alone is a third of a second between moving the
        // mouse and seeing it move.
        this.setPlayoutDelay(event.receiver, PLAYOUT_DELAY.watching);
      }

      // Every slot produces a track whether or not anybody is sending on it,
      // so a slot is empty until something actually arrives on it - otherwise
      // a camera nobody turned on is a black rectangle where an avatar goes,
      // and a screen nobody shared is announced to the whole call.
      //
      // What "actually arrives" means differs by kind. Audio is honest: the
      // track is muted until packets come and `unmute` says when they do.
      // Video is not - a receiver unmutes on the padding Chromium sends to
      // probe for bandwidth, which is a screen share that never happened - so
      // a video slot waits for a frame to be decoded before it counts as
      // arrived (`pollVideo`), and whether it is still *on* is the peer's own
      // declared media state (`media-presence.ts`).
      if (SLOT_KIND[slot] === 'audio') {
        this.events.onTrack(slot, event.track.muted ? null : event.track);
        event.track.onmute = () => this.events.onTrack(slot, null);
        event.track.onunmute = () => this.events.onTrack(slot, event.track);
      }
      // A remote track that ends is a device switched off at the far end. The
      // slot stays; what was in it does not.
      event.track.onended = () => this.events.onTrack(slot, null);
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
      // The first offer is the impolite side's, always. The polite side has
      // nothing to describe yet - its transceivers come from that offer - and
      // an offer from here before one has arrived is the glare that used to
      // leave both ends with two sets of m-lines that never paired up.
      if (this.polite && !this.pc.remoteDescription) return;
      void this.offer();
    };

    // Recovery is driven from `connectionState` alone.
    //
    // `iceConnectionState` says nearly the same thing a beat earlier and less
    // reliably - it reaches `failed` on one transport rather than on the
    // connection - and two callbacks both starting restarts is a link
    // renegotiating on top of itself. This used to be both: a bare
    // `restartIce()` from the ICE callback that the polite side could never
    // act on, and a drop out of the mesh from this one.
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      switch (this.pc.connectionState) {
        case 'connected':
          this.stopChasing();
          this.recovered();
          return;
        // Both mean media has stopped. They differ only in how likely it is to
        // come back unaided, which is what the grace period is for:
        // `disconnected` climbs out on its own often enough to be worth
        // waiting on, `failed` never does.
        case 'disconnected':
          this.startRecovery(GRACE_MS);
          return;
        case 'failed':
          this.startRecovery(0);
          return;
        default:
          return;
      }
    };

    // An offer that is never answered fires no event at all. See `chase`.
    this.chase();
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

  /**
   * Which slot a transceiver is, by position.
   *
   * Position rather than object identity because `ontrack` fires *during*
   * `setRemoteDescription`, before the answering side has had a chance to write
   * anything down - and on that side the transceivers were created by the
   * description itself, in m-line order, which is the same order as `SLOTS`.
   */
  private slotOf(transceiver: RTCRtpTransceiver): Slot | null {
    return SLOTS[this.pc.getTransceivers().indexOf(transceiver)] ?? null;
  }

  /**
   * The answering side takes ownership of the transceivers the offer created.
   *
   * Both sides used to create their own four, and then neither offer could be
   * matched to the other's: each connection ended up with eight transceivers
   * and nine m-lines, every one of them one-directional, and every arriving
   * track on a transceiver this side had never heard of. Media was negotiated
   * and then dropped on the floor - a call that connects, shows everybody, and
   * carries nothing.
   *
   * So only the impolite side creates them, and the polite side adopts what the
   * offer brought. They arrive `recvonly`, which is the direction that would
   * make this end permanently silent, so they are flipped before the answer is
   * written - and whatever this client is already capturing goes on immediately,
   * because it was asked for while there was no sender to put it on.
   */
  private async adopt(): Promise<void> {
    if (this.transceivers.size > 0) return;

    const found = this.pc.getTransceivers();
    for (const [index, slot] of SLOTS.entries()) {
      const transceiver = found[index];
      if (!transceiver || transceiver.receiver.track?.kind !== SLOT_KIND[slot]) return;
    }

    for (const [index, slot] of SLOTS.entries()) {
      const transceiver = found[index] as RTCRtpTransceiver;
      transceiver.direction = 'sendrecv';
      this.transceivers.set(slot, transceiver);
      this.senders.set(slot, transceiver.sender);
    }

    this.preferShareCodec(this.shareCodec ?? 'H264');
    for (const [slot, track] of this.wanted) await this.setTrack(slot, track);
    if (this.micEncoding) await this.tune('mic', { maxBitrate: this.micEncoding.maxBitrate });
    if (this.sharePublish) {
      await this.tune(
        'screen',
        {
          maxBitrate: this.sharePublish.maxBitrate,
          maxFramerate: this.sharePublish.maxFramerate,
          scaleResolutionDownBy: this.sharePublish.scaleResolutionDownBy,
          priority: this.sharePublish.priority,
        },
        this.sharePublish.degradationPreference,
      );
      if (this.sharePublish.audio) {
        await this.tune('screenAudio', { maxBitrate: this.sharePublish.audio.maxBitrate });
      }
    }
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
   * Sets the local description, with the Opus and Video bandwidth options patched in
   * when they will be accepted.
   *
   * The patch is a preference, not a requirement: `stereo`, `usedtx` and video
   * bandwidth hints are settable in the SDP. So the munged one is tried first
   * and the untouched one is the fallback.
   */
  private async setLocalDescription(type: 'offer' | 'answer'): Promise<void> {
    const description =
      type === 'offer' ? await this.pc.createOffer() : await this.pc.createAnswer();

    if (description.sdp) {
      let patched = description.sdp;
      if (this.micEncoding) {
        patched = patchOpus(patched, this.micEncoding);
      }
      patched = patchVideoBandwidth(patched, this.sharePublish);

      if (patched !== description.sdp) {
        try {
          await this.pc.setLocalDescription({
            type: description.type,
            sdp: patched,
          });
          return;
        } catch (error) {
          console.warn('[mesh] Patched SDP options refused, continuing without them', error);
        }
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

  /**
   * Verifies, re-reading the channel key when it has not just been read.
   *
   * The re-read used to be allowed once per peer and then never again, which is
   * a link that can only survive one epoch change and is the likeliest way a
   * tile ends up on "Connecting…" for good. One key change is normal - somebody
   * joining a channel they hold no key for mints the next epoch - and burning
   * the only re-read on the first description means every description after it
   * is refused against a key that is known to be stale, with nothing left that
   * would ever look again.
   *
   * A cooldown keeps the property the latch was there for: a proof that is
   * simply wrong still cannot make this client hammer the key directory,
   * because a wrong proof arriving twice a second re-reads once.
   */
  private async verify(sdp: string, proof: string): Promise<boolean> {
    if (await verifyFingerprint(await this.channelKey(), sdp, proof)) return true;
    if (Date.now() - this.keyReadAt < KEY_REREAD_COOLDOWN_MS) return false;
    this.keyReadAt = Date.now();
    return verifyFingerprint(await this.channelKey(true), sdp, proof);
  }

  /**
   * Offers again when an offer was never answered.
   *
   * Nothing else does. `connectionState` only reaches `failed` once ICE has had
   * a remote description to fail against, so an offer that the far end refused
   * - a fingerprint signed with an epoch it had not caught up to, most often -
   * leaves this connection sitting in `new` with no event ever fired and no
   * recovery path to enter. That is the whole of a tile that says "Connecting…"
   * until somebody leaves the call.
   *
   * Only the impolite side, because only it may offer, and only from `new`: a
   * link that has a remote description is negotiating, and offering over the
   * top of a slow network would break the calls that were about to work.
   * Re-reading the key first is not incidental - it is the fix for the case
   * this is most often chasing.
   */
  private chase(): void {
    if (this.closed || this.polite) return;

    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      if (this.closed) return;
      if (this.pc.connectionState !== 'new') return;

      if (++this.connectAttempts > CONNECT_ATTEMPTS) {
        // Not the end. An offer that was never answered leaves this connection
        // in `new`, where no state change ever fires again - so without this
        // the link sat silent for the rest of the call and the only cure was a
        // human leaving and rejoining. That is what `onExhausted` automates.
        this.events.onExhausted();
        return;
      }

      void (async () => {
        await this.channelKey(true).catch(() => undefined);
        await this.offer();
        this.chase();
      })();
    }, CONNECT_DEADLINE_MS);
  }

  private stopChasing(): void {
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.connectAttempts = 0;
  }

  // --- recovery ---

  private connectedNow(): boolean {
    return this.pc.connectionState === 'connected';
  }

  /**
   * Media is flowing again - either it never really stopped, or a restart
   * worked.
   *
   * The counters reset, so a link that drops once an hour on a train gets the
   * full budget each time rather than spending its way to "lost" over an
   * afternoon.
   */
  private recovered(): void {
    this.downSince = null;
    this.recoveryAttempts = 0;
  }

  /**
   * Start trying, after `initialDelay`.
   *
   * Idempotent: a connection flapping between `disconnected` and `failed` calls
   * this repeatedly, and each call must not start a second loop racing the
   * first. `downSince` is set on the first call and not on the later ones, so
   * the deadline is measured from when the media stopped rather than from the
   * most recent flap - a link that flaps forever would otherwise never reach
   * it.
   */
  private startRecovery(initialDelay: number): void {
    if (this.closed || this.recovering) return;
    this.downSince ??= Date.now();
    this.recovering = true;
    void this.recover(initialDelay).finally(() => {
      this.recovering = false;
    });
  }

  private async recover(initialDelay: number): Promise<void> {
    await sleep(initialDelay);
    // The grace period is exactly the case where nothing more is needed: ICE
    // climbed out on its own while we waited.
    if (this.closed || this.connectedNow()) return;

    while (!this.closed && !this.connectedNow()) {
      if (spent(this.recoveryAttempts, Date.now() - (this.downSince ?? Date.now()))) {
        this.giveUp();
        return;
      }

      this.recoveryAttempts += 1;
      await sleep(backoffMs(this.recoveryAttempts));
      if (this.closed || this.connectedNow()) return;

      // Both halves are needed, and this is the part the old code got wrong.
      // `restartIce()` only marks the connection as wanting fresh candidates;
      // the offer is what actually asks for them. On its own it fires
      // `onnegotiationneeded`, which is exactly what the polite side is
      // written to ignore - so on that side it did nothing whatsoever.
      if (restarts(this.polite)) {
        try {
          this.pc.restartIce();
        } catch {
          // A connection closed underneath us. The loop's own guard catches it.
        }
        await this.offer();
      }

      // Long enough for a restart to have landed, short enough that every
      // attempt fits inside the deadline. See `call-recovery.check.ts`.
      await sleep(GRACE_MS);
    }
  }

  /**
   * Out of attempts, or out of time.
   *
   * The connection is left open, and the peer stays in the mesh. Who is in a
   * call is the roster's answer and never this side's guess: a peer whose
   * laptop really has gone is removed by `peer.left` a moment later, and one
   * whose link is merely unrecoverable *from here* may be perfectly present to
   * everybody else.
   *
   * Dropping the link instead - which is what this used to do the first time
   * `connectionState` reached `failed` - was permanent, because nothing in a
   * mesh ever re-adds a link. One bad moment on one pair therefore needed a
   * rejoin to clear, which is the whole of the "leave and come back a few
   * times until it works" this call had become.
   */
  private giveUp(): void {
    this.events.onExhausted();
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
      fingerprintProof: await signFingerprint(await this.channelKey(), fingerprint),
    });
  }

  /**
   * Queues one signal behind the ones already being applied to this peer.
   *
   * The whole body of `apply` is a critical section over `this.pc`: every check
   * it makes about `signalingState` is invalidated by another run touching the
   * connection, and every `await` in it is a chance for that to happen.
   */
  accept(signal: CallSignal): Promise<void> {
    return this.queue(() => this.apply(signal));
  }

  /** The perfect-negotiation receive path, verbatim from the WebRTC spec's shape. */
  private async apply(signal: CallSignal): Promise<void> {
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
      if (!(await this.verify(signal.sdp, signal.fingerprintProof))) {
        console.error(
          '[mesh] refusing a peer whose DTLS fingerprint is not signed with the channel key',
          this.peer.peerId,
        );
        // Said out loud rather than left as a tile that never carries anything.
        // The honest cause is almost always the two devices holding different
        // channel-key epochs, not an attack - but the connection is refused
        // either way, because the two cases look identical from here.
        //
        // The link is kept. Dropping it used to be permanent: nothing re-adds a
        // link, and the far end's next offer would then arrive for a peer this
        // client no longer has - so one refusal, which an epoch change makes
        // ordinary, ended that pair for the life of the call. Refusing this
        // description is all that is meant; the next one is verified afresh
        // against a key that may by then have been re-read.
        this.events.onProblem(
          `${this.peer.username}: refused - their media key does not match this channel's`,
        );
        return;
      }

      // An answer is the reply to one offer, and only the side with that offer
      // still outstanding can apply it. A second answer - which a re-offer
      // chasing a connection that never came up will produce, since each offer
      // is answered - arrives when this side is already `stable`, and applying
      // it throws "Called in wrong state: stable" at somebody who is looking at
      // a call, not at a state machine. Dropping it is right: the description
      // that settled the connection is already in place.
      if (signal.kind === 'answer' && this.pc.signalingState !== 'have-local-offer') return;

      const offerCollision =
        signal.kind === 'offer' &&
        (this.makingOffer || this.pc.signalingState !== 'stable');

      this.ignoreOffer = !this.polite && offerCollision;
      if (this.ignoreOffer) return;

      await this.pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
      await this.flushCandidates();

      if (signal.kind === 'offer') {
        // Before the answer is written: the directions it carries are the ones
        // decided here.
        await this.adopt();
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
    this.wanted.set(slot, track);
    const sender = this.senders.get(slot);
    // No sender yet means this side is still waiting for the offer that makes
    // one. `adopt` plays this back.
    if (!sender) return;
    await sender.replaceTrack(track).catch(() => undefined);
  }

  /** Bitrate and degradation on a live sender; no renegotiation. */
  async tune(
    slot: Slot,
    encoding: {
      maxBitrate?: number;
      maxFramerate?: number;
      scaleResolutionDownBy?: number;
      priority?: RTCPriorityType;
    },
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
        if (encoding.scaleResolutionDownBy !== undefined) {
          first.scaleResolutionDownBy = encoding.scaleResolutionDownBy;
        }
        if (encoding.priority !== undefined) first.priority = encoding.priority;
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

  /** Remembered so every future offer and answer carries the screen bitrate options. */
  setSharePublish(publish: SharePublish | null): void {
    this.sharePublish = publish;
  }

  /**
   * Asks for High Profile H.264 on the screen slot, where hardware encoding is what makes
   * 1080p60/4K60 possible with pristine clarity. Ignored where the codec is unavailable.
   */
  preferShareCodec(codec: SharePublish['videoCodec']): void {
    this.shareCodec = codec;
    const transceiver = this.transceivers.get('screen');
    if (!transceiver?.setCodecPreferences) return;

    try {
      const supported = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
      const sorted = sortPreferredVideoCodecs(supported, codec);
      transceiver.setCodecPreferences(sorted);
    } catch {
      // Codec preferences are an optimisation; the call works without them.
    }
  }

  /**
   * Whether a camera or a screen has ever really carried a picture.
   *
   * Nothing a video receiver *says* is trustworthy here: it unmutes on padding
   * packets, so a slot that has never carried anything looks live, and a camera
   * nobody turned on becomes a black rectangle where an avatar goes. A frame
   * decoded is proof, and that is all this decides.
   *
   * It deliberately does not decide the *other* direction. Frames stopping is
   * not sharing stopping: a screen share of a document nobody is typing in
   * decodes nothing for minutes, and treating that as the end took the stage
   * down under whoever was watching it and offered them the share again. Who is
   * still sharing is the peer's own declared media state, which arrives on the
   * data channel - see `media-presence.ts`.
   */
  async pollVideo(): Promise<void> {
    if (this.closed) return;

    const decoded = new Map<string, number>();
    (await this.pc.getStats()).forEach((report) => {
      const entry = report as RTCInboundRtpStreamStats & { mid?: string; framesDecoded?: number };
      if (entry.type === 'inbound-rtp' && entry.kind === 'video' && entry.mid) {
        decoded.set(entry.mid, entry.framesDecoded ?? 0);
      }
    });

    for (const slot of ['camera', 'screen'] as const) {
      const transceiver = this.transceivers.get(slot);
      const track = transceiver?.receiver.track;
      if (!transceiver?.mid || !track) continue;

      // Cumulative, so this only ever goes from false to true: the first frame
      // is the moment the slot is known to be real, and nothing after it is
      // evidence of an ending.
      if ((decoded.get(transceiver.mid) ?? 0) === 0) continue;
      if (this.liveVideo.has(slot)) continue;

      this.liveVideo.add(slot);
      this.events.onTrack(slot, track);
    }
  }

  /**
   * One `getStats` reduced to the numbers a person is shown.
   *
   * Everything is a running total except the frame size and rate, so the
   * arithmetic of turning it into a rate belongs to whoever holds the previous
   * sample - `call-stats.ts` - and this is only the reading.
   */
  async sample(): Promise<LinkSample> {
    const now: LinkSample = {
      at: Date.now(),
      inboundAudioBytes: 0,
      inboundVideoBytes: 0,
      outboundAudioBytes: 0,
      outboundVideoBytes: 0,
      packetsLost: 0,
      packetsReceived: 0,
      roundTripSeconds: null,
      frameWidth: null,
      frameHeight: null,
      framesPerSecond: null,
      transport: null,
    };
    if (this.closed) return now;

    const reports = await this.pc.getStats().catch(() => null);
    if (!reports) return now;

    // The candidate pair carrying the call, and every candidate by id, so
    // "direct or relayed" can be answered after the whole report is walked.
    let nominated: Record<string, unknown> | null = null;
    const candidates = new Map<string, string>();

    reports.forEach((report) => {
      const entry = report as RTCStats & Record<string, number | string | undefined>;

      if (entry.type === 'inbound-rtp') {
        const bytes = Number(entry.bytesReceived ?? 0);
        if (entry.kind === 'audio') now.inboundAudioBytes += bytes;
        else now.inboundVideoBytes += bytes;
        now.packetsLost += Number(entry.packetsLost ?? 0);
        now.packetsReceived += Number(entry.packetsReceived ?? 0);

        // The biggest picture arriving, which is the share when there is one
        // and the camera otherwise - the number somebody actually wants when
        // they ask why it looks soft.
        if (entry.kind === 'video') {
          const width = Number(entry.frameWidth ?? 0);
          const height = Number(entry.frameHeight ?? 0);
          if (width * height > (now.frameWidth ?? 0) * (now.frameHeight ?? 0)) {
            now.frameWidth = width || null;
            now.frameHeight = height || null;
            now.framesPerSecond = Number(entry.framesPerSecond ?? 0) || null;
          }
        }
        return;
      }

      if (entry.type === 'outbound-rtp') {
        const bytes = Number(entry.bytesSent ?? 0);
        if (entry.kind === 'audio') now.outboundAudioBytes += bytes;
        else now.outboundVideoBytes += bytes;
        return;
      }

      // Only the pair actually carrying the call. Chromium keeps the losers of
      // the ICE race in the report, and their round trip means nothing.
      if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated) {
        const rtt = Number(entry.currentRoundTripTime ?? Number.NaN);
        if (Number.isFinite(rtt)) now.roundTripSeconds = rtt;
        nominated = entry as Record<string, unknown>;
        return;
      }

      // Kept whatever they are, because the pair that names them is not
      // guaranteed to have been walked yet - `getStats` has no order.
      if (entry.type === 'local-candidate' || entry.type === 'remote-candidate') {
        candidates.set(String(entry.id), String(entry.candidateType ?? ''));
      }
    });

    if (nominated) {
      // Either end being a relay candidate means the media is relayed: TURN is
      // in the path once, whichever side put it there.
      const pair = nominated as Record<string, unknown>;
      const local = candidates.get(String(pair.localCandidateId ?? ''));
      const remote = candidates.get(String(pair.remoteCandidateId ?? ''));
      if (local && remote) now.transport = local === 'relay' || remote === 'relay' ? 'relay' : 'direct';
    }

    return now;
  }

  /** How loud this peer is, 0..1, as of the last `pollAudioLevel`. */
  audioLevel(): number {
    return this.level;
  }

  /**
   * Reads how loud this peer is.
   *
   * `getSynchronizationSources()` is the obvious way to ask and is why nobody
   * ever saw a speaking ring on desktop or the web: it reports a level only for
   * sources it considers current, and in Chromium it is routinely empty on a
   * connection carrying perfectly good audio - so the ring was driven by a
   * number that was almost always zero. `inbound-rtp` carries the same reading
   * and is always there; it is what the Android client has been reading, which
   * is why the ring works there and only there.
   *
   * Asynchronous, so the poll reads the previous tick's answer. 200 ms behind a
   * syllable is not something a person can see.
   */
  async pollAudioLevel(): Promise<void> {
    const receiver = this.transceivers.get('mic')?.receiver;
    if (!receiver) {
      this.level = 0;
      return;
    }

    let loudest = 0;
    for (const source of receiver.getSynchronizationSources?.() ?? []) {
      loudest = Math.max(loudest, source.audioLevel ?? 0);
    }

    if (loudest === 0) {
      const report = await receiver.getStats().catch(() => null);
      report?.forEach((entry) => {
        const stat = entry as { type?: string; kind?: string; audioLevel?: number };
        if (stat.type !== 'inbound-rtp' || stat.kind !== 'audio') return;
        loudest = Math.max(loudest, Number(stat.audioLevel ?? 0));
      });
    }

    this.level = Number.isFinite(loudest) ? loudest : 0;
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
    this.stopChasing();
    this.channel.onmessage = null;
    this.channel.onopen = null;
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
  /** The previous reading per peer, so a rate can be worked out from a total. */
  private readonly lastSamples = new Map<string, LinkSample>();
  /**
   * What the peers who have already left moved, kept because their counters go
   * with them: a closed `RTCPeerConnection` answers `getStats` with nothing, so
   * the last reading has to be taken before it is closed rather than asked for
   * at the end of the call. See `drop`.
   *
   * One entry per person rather than a running total, because the log's whole
   * point is that a mesh call is several connections and they do not behave
   * alike - the one that went through a relay is the one worth finding.
   */
  private readonly retiredLinks: CallLinkReport[] = [];
  private closed = false;
  /** The channel key as last read, shared by every link. See `channelKey`. */
  private key: Promise<string> | null = null;
  /** When the outstanding clock ping went out, or null when none is. */
  private pingSentAt: number | null = null;
  /** Whether a signalling reconnect is in flight, so a flap starts only one. */
  private reconnecting = false;
  /** Rebuilds spent per peer. See `rebuild` and `REBUILD_ATTEMPTS`. */
  private readonly rebuilds = new Map<string, number>();
  /**
   * Who the gateway last said is in this call.
   *
   * Kept apart from `links` because during a rebuild there is deliberately no
   * link for somebody who is still very much present, and that gap is exactly
   * when a `peer.left` is most likely to arrive.
   */
  private readonly peerIsExpected = new Set<string>();

  constructor(private readonly options: MeshOptions) {}

  /**
   * The key every link signs and verifies fingerprints with, read once and
   * re-read whenever somebody joins.
   *
   * This is the fix for a call that refused a newcomer with "their media key
   * does not match this channel's" and then sat on "connecting". A member who
   * joins a channel holding none of its keys mints the next epoch for itself -
   * that is the only way it gets one - and everybody already in the call is
   * still signing with the epoch they snapshotted when *they* joined. One
   * generation apart, so every fingerprint is refused, and because only the
   * impolite side offers, whichever way the refusal falls the connection is
   * never made. Re-reading the moment a peer appears puts both sides on the
   * epoch the newcomer minted, before the first offer is written.
   */
  private channelKey(refresh = false): Promise<string> {
    if (refresh || !this.key) {
      this.key = this.options.channelKey(refresh).catch((error: unknown) => {
        // Never remember a failure: the next signal asks again rather than
        // being stuck with a rejection for the rest of the call.
        this.key = null;
        throw error;
      });
    }
    return this.key;
  }

  /** Opens the socket and joins. Resolves once the server has answered. */
  async join(): Promise<void> {
    await this.openSocket();
    this.startSpeakingPoll();
  }

  /**
   * One attempt at a socket and a join. Resolves once the server has answered.
   *
   * Used for the first join and for every reconnect, because they are the same
   * thing: `call-service` issues a peer id per *device* rather than per socket,
   * so a socket that comes back inside the gateway's grace window resumes the
   * seat it had - see `resumeHeldSeat` in `call.gateway.ts`. Nobody else in the
   * call is told anything happened, and every peer connection stays up, because
   * media does not go through here.
   */
  private openSocket(): Promise<void> {
    const { channelId, token } = this.options;
    // The device goes with the token. `call-service` hangs this window's peer
    // id on it, so a signalling reconnect comes back as the same peer rather
    // than as a stranger everybody has to rebuild a connection to.
    const socket = new WebSocket(
      `${wsUrl()}/ws/call?token=${encodeURIComponent(token)}&device=${encodeURIComponent(deviceId())}`,
    );
    this.socket = socket;

    return new Promise<void>((resolve, reject) => {
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
        reject(new Error('The connection to the call server was lost'));
        // A socket this mesh has already replaced is a previous attempt
        // finishing late; its death says nothing about the live one.
        if (this.socket !== socket) return;
        if (this.closed) return;
        // `superseded` sets `closed` before the socket shuts, so reaching here
        // means the connection was lost rather than given away.
        void this.reconnect();
      };
    });
  }

  /**
   * Gets the signalling back, or ends the call saying so.
   *
   * This used to be a straight `onFatal`: the socket dropped and the call was
   * over, on a laptop that had merely changed wifi. That is the worst possible
   * reading of a lost signalling socket, because signalling is not in the media
   * path - every peer connection carries on regardless, and the only thing
   * actually missing while it is gone is the ability to admit somebody new.
   *
   * So it reconnects, quietly, for as long as `SIGNALLING_DEADLINE_MS` allows.
   * Past that the roster has long since dropped this device, so nobody else can
   * see it in the call and holding the microphone open is a lie told to its
   * owner - and then, and only then, it is fatal.
   */
  private async reconnect(): Promise<void> {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    const lostAt = Date.now();
    let attempt = 0;

    try {
      while (!this.closed && Date.now() - lostAt < SIGNALLING_DEADLINE_MS) {
        attempt += 1;
        await sleep(signallingBackoffMs(attempt));
        if (this.closed) return;
        try {
          await this.openSocket();
          return;
        } catch {
          // Whatever it was, the answer is the same: try again until the
          // deadline says the seat is gone.
        }
      }
      if (!this.closed) {
        this.options.onFatal('The connection to the call server was lost');
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private async handle(event: ServerCallEvent): Promise<void> {
    switch (event.type) {
      case 'ready':
        this.selfPeerId = event.peerId;
        return;

      case 'joined': {
        // Everyone already here. We arrived last, so we connect outward to all
        // of them; each of them sees a `peer.joined` for us at the same moment
        // and perfect negotiation settles who actually offers.
        for (const peer of event.peers) this.link(peer);
        // On a reconnect this roster is also the correction: somebody who left
        // while the socket was down sent a `peer.left` into a socket that was
        // not there to hear it, and would otherwise stay on screen as a tile
        // that never comes back. Empty on a first join, so this costs nothing.
        const present = new Set(event.peers.map((peer) => peer.peerId));
        for (const peerId of [...this.links.keys()]) {
          if (!present.has(peerId)) this.drop(peerId);
        }
        this.announcePeers();
        return;
      }

      case 'peer.joined':
        // Before the link, because the link starts negotiating immediately.
        // Somebody arriving may have just minted the epoch everyone else is
        // now behind - see `channelKey`.
        void this.channelKey(true).catch(() => {});
        this.link(event.peer);
        this.announcePeers();
        return;

      case 'peer.left':
        this.drop(event.peerId);
        return;

      case 'signal': {
        await this.links.get(event.from)?.accept(event.data);
        return;
      }

      case 'screen.holder':
        this.options.onScreenHolder?.(event.peerId);
        return;

      case 'listen.state':
        this.options.onListen?.(event.session);
        return;

      case 'game.state':
        this.options.onGame?.(event.session);
        return;

      case 'pong':
        // Only useful against the ping that asked for it: an unsolicited pong
        // has no send time to measure the round trip from, and half of an
        // unknown round trip is not an offset.
        if (typeof event.serverMs === 'number' && this.pingSentAt !== null) {
          this.options.onServerTime?.({
            sentAtMs: this.pingSentAt,
            receivedAtMs: Date.now(),
            serverMs: event.serverMs,
          });
          this.pingSentAt = null;
        }
        return;

      case 'superseded':
        // The same account joined this call somewhere else, so the server has
        // already taken this connection off the roster. Marking the mesh closed
        // first is what keeps the reason: the socket shuts straight after, and
        // `onclose` would otherwise report a lost connection over the top of it.
        this.closed = true;
        this.options.onFatal(
          'This call moved to another device - you joined it there. Rejoin here to bring it back.',
        );
        return;

      case 'error':
        console.warn('[mesh] signalling error', event.code, event.message);
        return;

      default:
        return;
    }
  }

  /**
   * Asks the gateway what time it is.
   *
   * Sent only while somebody is listening together, because that is the only
   * thing that needs a shared clock - a call has no opinion about the time, and
   * a measurement nobody reads is a message not worth sending.
   */
  sampleServerTime(): void {
    this.pingSentAt = Date.now();
    this.send({ type: 'ping' });
  }

  /** One Listen Together action, straight through. The gateway decides. */
  sendListen(event: ListenClientEvent): void {
    this.send(event);
  }

  /** One Play Together action. The gateway referees it and tells everybody. */
  sendGame(event: GameClientEvent): void {
    this.send(event);
  }

  /** This client's own peer id, once the gateway has issued one. */
  peerId(): string | null {
    return this.selfPeerId;
  }

  /** "I am about to share." The gateway decides, and tells everybody. */
  claimScreen(): void {
    this.send({ type: 'screen.claim' });
  }

  /** "I have stopped." Ignored by the gateway unless this peer is the holder. */
  releaseScreen(): void {
    this.send({ type: 'screen.release' });
  }

  private link(peer: CallPeer): PeerLink {
    this.peerIsExpected.add(peer.peerId);
    const existing = this.links.get(peer.peerId);
    if (existing) return existing;

    const link = new PeerLink(
      peer,
      this.selfPeerId ?? '',
      this.options.iceServers,
      (refresh) => this.channelKey(refresh),
      (signal) => this.send({ type: 'signal', to: peer.peerId, data: signal }),
      {
        onTrack: (slot, track) => this.options.onTrack(peer.peerId, slot, track),
        onData: (payload) => this.options.onData(peer, payload),
        onDataOpen: () => this.options.onDataOpen?.(peer),
        onExhausted: () => this.rebuild(peer),
        onProblem: (message) => this.options.onProblem(message),
      },
    );

    if (this.micEncoding) link.setMicEncoding(this.micEncoding);
    if (this.sharePublish) {
      link.setSharePublish(this.sharePublish);
      link.preferShareCodec(this.sharePublish.videoCodec);
    }
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

  /**
   * Throws one link away and builds it again from nothing.
   *
   * The automated version of what everybody was doing by hand: leaving the call
   * and rejoining until it worked. That worked because a new connection gathers
   * new candidates - new local ports, a new NAT binding, a new race to lose or
   * win - and it is the only move left once ICE restarts are spent, because a
   * restart reuses the connection whose ports were the problem.
   *
   * Only the impolite side does it, for the same reason only it offers. The
   * polite side needs no rebuild of its own: the fresh offer arrives carrying a
   * new ICE ufrag and a new DTLS fingerprint, which its existing connection
   * takes as a restart and answers. Both sides tearing down at once would be
   * two peers rebuilding into each other's closing connections.
   *
   * The peer stays in the roster throughout. Who is in a call is the gateway's
   * answer, and a link this client cannot make work says nothing about whether
   * the person is there.
   */
  private rebuild(peer: CallPeer): void {
    if (this.closed) return;

    const old = this.links.get(peer.peerId);
    // Politeness is the same comparison the link made, and it is stable for as
    // long as both peer ids are.
    if (!old || (this.selfPeerId ?? '') > peer.peerId) {
      this.options.onProblem(
        `${peer.username}: could not be reached. Your networks may not be able to connect directly.`,
      );
      return;
    }

    const spentSoFar = this.rebuilds.get(peer.peerId) ?? 0;
    if (spentSoFar >= REBUILD_ATTEMPTS) {
      this.options.onProblem(
        `${peer.username}: could not be reached after ${REBUILD_ATTEMPTS} attempts. Your networks may not be able to connect directly.`,
      );
      return;
    }
    this.rebuilds.set(peer.peerId, spentSoFar + 1);

    this.links.delete(peer.peerId);
    old.close();
    // Whatever was last received on the dead connection is gone with it, and a
    // frozen final frame left on screen is worse than an empty tile: it is the
    // call looking like it works.
    for (const slot of SLOTS) this.options.onTrack(peer.peerId, slot, null);

    window.setTimeout(() => {
      // The roster may have settled the question while this was waiting - the
      // person really did leave - and re-adding them then would put a tile back
      // for somebody who is gone.
      if (this.closed || this.links.has(peer.peerId)) return;
      if (!this.peerIsExpected.has(peer.peerId)) return;
      this.link(peer);
      this.announcePeers();
    }, REBUILD_DELAY_MS);
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
      link.setSharePublish(this.sharePublish);
      await link.tune(
        'screen',
        {
          maxBitrate: this.sharePublish.maxBitrate,
          maxFramerate: this.sharePublish.maxFramerate,
          scaleResolutionDownBy: this.sharePublish.scaleResolutionDownBy,
          priority: this.sharePublish.priority,
        },
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
    for (const link of this.links.values()) {
      link.setSharePublish(publish);
      if (publish) link.preferShareCodec(publish.videoCodec);
    }
    if (!publish) return;
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

  /**
   * A reading per peer, turned into rates against the previous one.
   *
   * Called only while somebody is looking at the connection panel: `getStats`
   * is not free, and a number nobody is reading is a number not worth taking.
   */
  async stats(): Promise<LinkStats[]> {
    const links = [...this.links.values()];
    const samples = await Promise.all(links.map((link) => link.sample()));

    return links.map((link, index) => {
      const now = samples[index]!;
      const before = this.lastSamples.get(link.peer.peerId);
      this.lastSamples.set(link.peer.peerId, now);
      return toStats(link.peer.peerId, link.peer.username, now, before);
    });
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
    let tick = 0;
    this.speakingTimer = window.setInterval(() => {
      // A fifth as often as the speaking ring: a share appearing a beat late is
      // invisible next to the second it takes to pick a window, and `getStats`
      // is not free.
      if (++tick % VIDEO_POLL_EVERY === 0) {
        for (const link of this.links.values()) void link.pollVideo();
      }

      const speaking = new Set<string>();
      if (this.localSpeaking) speaking.add('local');
      for (const link of this.links.values()) {
        // Started here, read next tick: the level comes from `getStats`, which
        // is a promise. See `pollAudioLevel`.
        void link.pollAudioLevel();
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

  /**
   * Takes one peer out of the mesh: their tracks, their link and their meter.
   *
   * The reading is taken before the connection is closed, because after it is
   * closed there is nothing left to read - which is how a call that lost four
   * people one at a time used to report the traffic of only the last one.
   */
  private drop(peerId: string): void {
    const link = this.links.get(peerId);
    this.links.delete(peerId);
    // Before the early return below: a peer who leaves mid-rebuild has no link
    // to find here, and must still not have one built for them afterwards.
    this.peerIsExpected.delete(peerId);
    this.rebuilds.delete(peerId);
    for (const slot of SLOTS) this.options.onTrack(peerId, slot, null);
    this.announcePeers();
    if (!link) return;

    void link
      .sample()
      .then((sample) => {
        this.retiredLinks.push(reportOf(link.peer, sample));
      })
      .catch(() => undefined)
      .finally(() => {
        this.lastSamples.delete(peerId);
        link.close();
      });
  }

  private send(event: ClientCallEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  close(): void {
    this.closed = true;
    if (this.speakingTimer !== null) window.clearInterval(this.speakingTimer);
    this.speakingTimer = null;

    // The last reading of every live link, taken before it is closed and before
    // the socket goes, because both of those destroy the only counters there
    // are: the gateway is not in the media path and has nothing of its own to
    // count. Everything else about the call is torn down now; only the goodbye
    // waits, and `closed` already stops anything else being sent.
    const live = [...this.links.values()];
    this.links.clear();
    this.lastSamples.clear();
    this.local.clear();

    void Promise.all(
      live.map((link) =>
        link
          .sample()
          .then((sample) => reportOf(link.peer, sample))
          .catch(() => null),
      ),
    )
      .catch(() => [])
      .then((reports) => {
        const links = [...this.retiredLinks, ...reports.flatMap((report) => (report ? [report] : []))];
        const bytesSent = links.reduce((total, link) => total + link.bytesSent, 0);
        const bytesReceived = links.reduce((total, link) => total + link.bytesReceived, 0);

        this.send({ type: 'leave', bytes: bytesSent + bytesReceived, bytesSent, bytesReceived, links });
        for (const link of live) link.close();
        this.socket?.close();
        this.socket = null;
      });
  }
}

/**
 * One link's last reading, as the log stores it.
 *
 * By `userId` rather than by peer id: a peer id lives as long as a socket and
 * means nothing a month later, and the question the log answers is who the call
 * was with.
 */
function reportOf(peer: CallPeer, sample: LinkSample): CallLinkReport {
  return {
    userId: peer.userId,
    username: peer.username,
    bytesSent: sample.outboundAudioBytes + sample.outboundVideoBytes,
    bytesReceived: sample.inboundAudioBytes + sample.inboundVideoBytes,
    roundTripMs:
      sample.roundTripSeconds === null ? null : Math.round(sample.roundTripSeconds * 1000),
    packetsLost: sample.packetsLost,
    packetsReceived: sample.packetsReceived,
    transport: sample.transport,
  };
}
