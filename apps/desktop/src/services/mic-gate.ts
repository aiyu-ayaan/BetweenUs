/**
 * The noise gate, and the level meter that shares its arithmetic.
 *
 * Noise suppression cleans up a signal. It does not decide that nobody is
 * talking - so a suppressed fan is a quieter fan, still in the call. What makes
 * a Discord call silent between sentences is a gate: below a threshold the
 * microphone is simply closed. Discord calls the threshold input sensitivity,
 * and it is the single control that most changes what other people hear.
 *
 * It runs in an AudioWorklet, which matters for two reasons that are not
 * obvious:
 *
 * - **The audio thread does not get throttled.** A gate driven from the main
 *   thread by a timer stops running when Electron backgrounds the window, which
 *   is exactly when somebody is not looking at the call and most needs it to
 *   behave.
 * - **It can act between samples.** The decision has to be made at the top of a
 *   word, not 100 ms later; a gate on a 100 ms poll clips every sentence's first
 *   consonant.
 *
 * The worklet is assembled from `stepGate`'s own source rather than a copy of
 * it, so the logic under the self-check is the logic on the audio thread. That
 * is why `stepGate` and `amplitudeToDb` close over nothing: a worklet is a
 * separate global scope and anything they referenced would be undefined there.
 *
 * ponytail: no gate where AudioWorklet is missing - the track is passed straight
 * through, which is what the microphone did before this existed. Electron has
 * had worklets since long before the version this app runs on.
 */
import { amplitudeToDb, stepGate, type AudioProcessor } from './voice-quality';

/** How often the worklet reports the level back, in seconds. */
const REPORT_INTERVAL = 0.05;

/**
 * A function's compiled name is not its source name after a production build,
 * and a build is free to emit it as an arrow. Binding the source to a name here
 * survives both: a named function expression and an arrow are both expressions.
 */
function named(fn: { toString(): string }, name: string): string {
  return `const ${name} = ${fn.toString()};`;
}

const WORKLET_SOURCE = `
${named(amplitudeToDb, 'amplitudeToDb')}
${named(stepGate, 'stepGate')}

class BetweenUsGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.thresholdDb = null;
    this.state = { open: false, heldUntil: 0 };
    this.gain = 1;
    this.reportedAt = 0;
    this.port.onmessage = (event) => {
      this.thresholdDb = event.data.thresholdDb;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    let sum = 0;
    let count = 0;
    for (const channel of input) {
      for (let i = 0; i < channel.length; i += 1) sum += channel[i] * channel[i];
      count += channel.length;
    }
    const db = amplitudeToDb(count > 0 ? Math.sqrt(sum / count) : 0);

    if (this.thresholdDb === null) {
      this.state = { open: true, heldUntil: 0 };
    } else {
      this.state = stepGate(this.state, db, this.thresholdDb, currentTime);
    }

    // Ramped per sample: 5 ms to open, 150 ms to close. Opening any slower eats
    // the start of a word; closing any faster is an audible click.
    const target = this.state.open ? 1 : 0;
    const step = (target > this.gain ? 1 / 0.005 : -1 / 0.15) / sampleRate;

    for (let channel = 0; channel < output.length; channel += 1) {
      const from = input[Math.min(channel, input.length - 1)];
      const to = output[channel];
      let gain = this.gain;
      for (let i = 0; i < to.length; i += 1) {
        gain = Math.min(1, Math.max(0, gain + step));
        to[i] = from[i] * gain;
      }
      if (channel === output.length - 1) this.gain = gain;
    }

    if (currentTime - this.reportedAt >= ${REPORT_INTERVAL}) {
      this.reportedAt = currentTime;
      this.port.postMessage({ db, open: this.state.open });
    }

    return true;
  }
}

registerProcessor('betweenus-gate', BetweenUsGate);
`;

let moduleUrl: string | null = null;
/** Registering the same processor name twice in one context throws. */
const registered = new WeakSet<AudioContext>();

async function addWorklet(context: AudioContext): Promise<boolean> {
  if (registered.has(context)) return true;
  try {
    moduleUrl ??= URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(moduleUrl);
    registered.add(context);
    return true;
  } catch (error) {
    console.warn('[mic-gate] no worklet, microphone passes through ungated:', error);
    return false;
  }
}

export interface MicLevel {
  /** Loudness of the last block, in dBFS. -100 is silence. */
  db: number;
  /** Whether the gate is letting it through. */
  open: boolean;
}

/**
 * The gate as an audio processor: it sits between the captured microphone and
 * the track that is actually sent, so what the gate closes never reaches
 * anybody. The voice store puts `processedTrack` on the senders rather than the
 * raw capture, which is the whole point of it.
 */
export class NoiseGate implements AudioProcessor {
  readonly name = 'betweenus-noise-gate';

  processedTrack?: MediaStreamTrack;

  private thresholdDb: number | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private listener: ((level: MicLevel) => void) | null = null;

  constructor(thresholdDb: number | null) {
    this.thresholdDb = thresholdDb;
  }

  async init(options: { track: MediaStreamTrack; audioContext: AudioContext }): Promise<void> {
    const context = options.audioContext;
    this.source = context.createMediaStreamSource(new MediaStream([options.track]));
    this.destination = context.createMediaStreamDestination();

    if (await addWorklet(context)) {
      this.node = new AudioWorkletNode(context, 'betweenus-gate');
      this.node.port.onmessage = (event: MessageEvent<MicLevel>) => this.listener?.(event.data);
      this.source.connect(this.node).connect(this.destination);
      this.setThreshold(this.thresholdDb);
    } else {
      this.source.connect(this.destination);
    }

    this.processedTrack = this.destination.stream.getAudioTracks()[0];
  }

  async restart(options: { track: MediaStreamTrack; audioContext: AudioContext }): Promise<void> {
    await this.destroy();
    await this.init(options);
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    this.node?.disconnect();
    this.destination?.disconnect();
    this.source = null;
    this.node = null;
    this.destination = null;
    this.processedTrack = undefined;
  }

  /** `null` is an open mic. Takes effect on the next block, without republishing. */
  setThreshold(thresholdDb: number | null): void {
    this.thresholdDb = thresholdDb;
    this.node?.port.postMessage({ thresholdDb });
  }

  /** For a meter. One listener - there is one settings screen. */
  onLevel(listener: ((level: MicLevel) => void) | null): void {
    this.listener = listener;
  }
}

/**
 * Opens the microphone on its own to drive the meter in settings, so the
 * threshold can be set without being in a call. Returns a stop function.
 *
 * Deliberately a second capture rather than a tap on the live one: the settings
 * screen is opened while a call is running as often as not, and Windows is
 * perfectly happy to hand the same microphone to two capturers.
 */
export async function monitorMic(
  deviceId: string | null,
  thresholdDb: number | null,
  onLevel: (level: MicLevel) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId } : true,
  });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error('That microphone handed back no audio');
  const context = new AudioContext();
  const gate = new NoiseGate(thresholdDb);

  gate.onLevel(onLevel);
  await gate.init({ track, audioContext: context });

  return () => {
    gate.onLevel(null);
    void gate.destroy();
    track.stop();
    void context.close().catch(() => undefined);
  };
}

/**
 * Exported for the self-check. Splicing one function's source into another
 * program is the kind of thing that works until a build renames something, so
 * the check compiles this string and fails if it is not valid JavaScript.
 */
export const workletSource = WORKLET_SOURCE;
