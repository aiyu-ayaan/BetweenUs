/**
 * What the call is actually doing, in numbers.
 *
 * Until now nothing measured anything: "it looks bad" and "the link is bad"
 * were the same sentence, and the only way to tell them apart was to open
 * `chrome://webrtc-internals`, which is not a thing to ask of somebody in a
 * meeting. Worse, the most common failure in any voice app - a microphone that
 * is sending nothing at all while its owner talks happily into it - is silent
 * on both sides.
 *
 * The arithmetic is here and pure; the sampling is in `mesh.ts`, which is the
 * only thing holding a peer connection to ask.
 */

import type { CallTransport } from '@betweenus/shared-types';

/**
 * Why the picture leaving this machine is smaller or slower than it was asked
 * to be, straight from `qualityLimitationReason` on the outbound stream.
 *
 * The one number that separates "the link cannot carry it" from "this machine
 * cannot encode it" from "nothing is holding it back and it still looks like
 * that". Without it a soft share is a guess, and the guess is usually wrong:
 * `bandwidth` and `cpu` want opposite fixes.
 */
export type QualityLimit = 'bandwidth' | 'cpu' | 'other';

/** One `getStats` sample of one peer connection, already reduced to numbers. */
export interface LinkSample {
  at: number;
  /** Bytes this peer has sent us, ever, per kind. */
  inboundAudioBytes: number;
  inboundVideoBytes: number;
  /** Bytes we have sent them, ever. */
  outboundAudioBytes: number;
  outboundVideoBytes: number;
  /** Packets they sent that never arrived, and the ones that did. */
  packetsLost: number;
  packetsReceived: number;
  /** Round trip on the selected candidate pair, in seconds, when known. */
  roundTripSeconds: number | null;
  /** The screen or camera as it arrives, when one does. */
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  /** The same, for the biggest picture leaving this machine. */
  sendWidth: number | null;
  sendHeight: number | null;
  sendLimitedBy: QualityLimit | null;
  /**
   * Whether this link has a path at all: ICE settled and DTLS came up.
   *
   * Distinct from every byte counter above, which cannot tell "connected and
   * saying nothing" from "never connected" - both read as a still counter.
   */
  connected: boolean;
  /**
   * Whether the media went straight to the other machine or through a relay.
   *
   * Null until ICE has settled on a pair. It costs an operator nothing when it
   * is direct and relay bandwidth when it is not, and there is no way to see
   * which from anywhere else - the server is not in the path to look.
   */
  transport: CallTransport | null;
  /**
   * How many dB of echo the canceller is actually removing, from the local
   * audio source. Null when the browser does not report it.
   *
   * This is the only number that answers "is echo cancellation working", and
   * without it echo is diagnosed by asking somebody on the call whether they
   * can hear themselves - which is why it went unfixed for so long. It is a
   * property of this machine rather than of a link, but it is read here because
   * this is where `getStats` is already being called.
   */
  echoReturnLossEnhancementDb: number | null;
}

/** What a person is shown about one other person in the call. */
export interface LinkStats {
  peerId: string;
  name: string;
  /** Null until there are two samples to compare. */
  downKbps: number | null;
  upKbps: number | null;
  /** Percentage of their packets that never arrived, over the whole call. */
  lossPercent: number | null;
  roundTripMs: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  /** What is leaving this machine, and what is holding it down. */
  sendWidth: number | null;
  sendHeight: number | null;
  sendLimitedBy: QualityLimit | null;
  /** False when we are sending them no audio at all - see `notBeingHeard`. */
  sendingAudio: boolean;
  /** False while this link has no path at all - see `notBeingHeard`. */
  connected: boolean;
}

/**
 * Kilobits per second between two samples.
 *
 * Null rather than zero when there is nothing to compare, because "no reading
 * yet" and "nothing is flowing" are the two answers this is asked for and
 * showing 0 kbps for the first second of every call is how a healthy call gets
 * reported as broken.
 */
export function kbpsBetween(
  bytesNow: number,
  bytesBefore: number,
  msElapsed: number,
): number | null {
  if (msElapsed <= 0) return null;
  const bytes = bytesNow - bytesBefore;
  // A counter that went backwards is a connection that was rebuilt underneath
  // us; the next sample will be right and this one is not worth guessing at.
  if (bytes < 0) return null;
  return Math.round((bytes * 8) / msElapsed);
}

/** Share of their packets that never arrived, as a percentage. */
export function lossPercent(lost: number, received: number): number | null {
  const total = lost + received;
  if (total <= 0) return null;
  return Math.round((lost / total) * 1000) / 10;
}

/**
 * Below this many dB of enhancement, the canceller is not doing its job.
 *
 * A converged AEC3 removes 20-40 dB. Single digits mean it is running but
 * cancelling against the wrong reference, which is the signature of audio being
 * played to a device other than the one the canceller is listening to. Zero or
 * near it means it is not running at all.
 *
 * Six is deliberately generous: the number swings while the canceller converges
 * at the top of a call, and a warning that fires on every call start is a
 * warning people learn to ignore.
 */
export const MIN_HEALTHY_ERLE_DB = 6;

/**
 * Whether the far end is hearing themselves come back.
 *
 * Two conditions, and both matter. Echo cancellation being *off* is not a
 * fault - hi-fi mode turns it off deliberately, because it chews holes in
 * anything that correlates with what the speakers are playing - so it is only
 * worth reporting when the setting says it should be working. And a null
 * reading is not a failure: plenty of builds do not report the statistic, and
 * warning on its absence would put a permanent notice on machines with no echo.
 */
export function echoCancellerFailing(
  echoCancellationEnabled: boolean,
  erleDb: number | null,
): boolean {
  if (!echoCancellationEnabled) return false;
  if (erleDb === null) return false;
  return erleDb < MIN_HEALTHY_ERLE_DB;
}

/**
 * Why the canceller is failing, when it is, in a sentence somebody can act on.
 *
 * The output device is the whole reason this exists. Chromium builds its echo
 * reference from the *default* render device, so playing a call to a device
 * chosen in this app's own settings hands the canceller the wrong signal to
 * subtract - and the symptom is a call that echoes only for people who changed
 * their speakers, which is indistinguishable from bad luck until this is
 * measured.
 */
export function echoAdvice(usingNonDefaultOutput: boolean): string {
  return usingNonDefaultOutput
    ? 'Echo cancellation is not working on this output device. Switch the call output back to System default, or change your default device in Windows sound settings.'
    : 'Echo cancellation is not working - other people may hear themselves. Headphones will stop it.';
}

/**
 * "Your microphone is not being heard."
 *
 * The one warning worth interrupting somebody for, and the reason this file
 * exists. It is true when this client believes it is sending audio - the mic is
 * on, the key is down if push to talk is on - and the bytes on the wire say
 * otherwise for long enough that it cannot be a pause.
 *
 * Deliberately not derived from "am I speaking": somebody silent for ten
 * seconds is still being heard, and a microphone that is muted at the OS level
 * sends comfort noise rather than nothing at all. What this catches is the
 * capture that failed, the device that was unplugged, and the sender that was
 * never attached.
 *
 * And deliberately only over links that have a path. A connection that never
 * came up carries nothing in either direction, so the best microphone in the
 * world reads as silent on it - which is how "nobody can hear you, try another
 * input" came to be the message on screen during a call that had simply failed
 * to connect, sitting directly under the mesh's own "could not be reached".
 * That is the worst kind of wrong answer: prominent, actionable, and impossible
 * to act on successfully, because no input device on the machine is the
 * problem. The two notices contradicted each other and the wrong one was the
 * one with a dropdown, so it was the one people spent the call on.
 */
export function notBeingHeard(
  intendsToSend: boolean,
  stats: LinkStats[],
  quietSamples: number,
  requiredSamples = 3,
): boolean {
  if (!intendsToSend) return false;
  if (quietSamples < requiredSamples) return false;
  // Nobody to be heard by: an empty call, or one where no link has a path.
  // Neither is evidence about the microphone.
  const reachable = stats.filter((link) => link.connected);
  if (reachable.length === 0) return false;
  return reachable.every((link) => !link.sendingAudio);
}

/**
 * A short sentence about the link, or null when there is nothing worth saying.
 *
 * One threshold per problem, chosen where a person would notice: 5% loss is
 * where speech starts breaking up, and 300 ms round trip is where a
 * conversation starts talking over itself.
 */
export function healthWarning(stats: LinkStats[]): string | null {
  const lossy = stats.filter((link) => (link.lossPercent ?? 0) >= 5);
  if (lossy.length > 0) {
    const worst = Math.max(...lossy.map((link) => link.lossPercent ?? 0));
    return lossy.length === 1
      ? `Losing ${worst}% of the packets from ${lossy[0]!.name}`
      : `Losing packets from ${lossy.length} people - up to ${worst}%`;
  }

  const slow = stats.filter((link) => (link.roundTripMs ?? 0) >= 300);
  if (slow.length > 0) {
    const worst = Math.max(...slow.map((link) => link.roundTripMs ?? 0));
    return `Round trip of ${worst} ms - expect to talk over each other`;
  }

  return null;
}

/** Turns two samples into what the panel shows. */
export function toStats(
  peerId: string,
  name: string,
  now: LinkSample,
  before: LinkSample | undefined,
): LinkStats {
  const elapsed = before ? now.at - before.at : 0;

  return {
    peerId,
    name,
    downKbps: before
      ? kbpsBetween(
          now.inboundAudioBytes + now.inboundVideoBytes,
          before.inboundAudioBytes + before.inboundVideoBytes,
          elapsed,
        )
      : null,
    upKbps: before
      ? kbpsBetween(
          now.outboundAudioBytes + now.outboundVideoBytes,
          before.outboundAudioBytes + before.outboundVideoBytes,
          elapsed,
        )
      : null,
    lossPercent: lossPercent(now.packetsLost, now.packetsReceived),
    roundTripMs:
      now.roundTripSeconds === null ? null : Math.round(now.roundTripSeconds * 1000),
    frameWidth: now.frameWidth,
    frameHeight: now.frameHeight,
    framesPerSecond: now.framesPerSecond === null ? null : Math.round(now.framesPerSecond),
    sendWidth: now.sendWidth,
    sendHeight: now.sendHeight,
    sendLimitedBy: now.sendLimitedBy,
    // Any movement at all counts. Opus sends a few hundred bytes a second even
    // through silence, so a sender that is attached and working is never still.
    sendingAudio: before ? now.outboundAudioBytes > before.outboundAudioBytes : true,
    connected: now.connected,
  };
}

/**
 * How long the call has been running, as a clock.
 *
 * The phone has had this since the beginning and neither of the other two
 * clients did - not because anybody chose that, but because on Android it is
 * free: an ongoing-call notification with `setUsesChronometer` is counted by
 * the system. A desktop window and a browser tab have no notification to hang
 * it on, so the number has to be drawn.
 *
 * `mm:ss` until an hour, `h:mm:ss` after it. Never `00:` hours, because a
 * leading pair of zeroes on every call is two characters that only ever say
 * "this is not a long call".
 */
export function formatCallDuration(seconds: number): string {
  // A clock that has not started, or one whose start is somehow in the future -
  // a machine's clock moving backwards is a thing that happens - reads as zero
  // rather than as a negative duration.
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const mmss = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}
