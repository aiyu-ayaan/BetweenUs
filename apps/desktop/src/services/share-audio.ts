/**
 * A share's system audio as a track, with this app's own output left out.
 *
 * The main process captures it (`electron/share-audio.ts`) and streams raw PCM
 * over IPC; this plays that PCM into a `MediaStreamAudioDestinationNode`, whose
 * track is what the share sends in place of the one `getDisplayMedia` would
 * have handed back. That one is the machine's whole output mix, call included,
 * which is what sent everybody's voice back to them.
 *
 * Nothing here reaches the speakers: the destination is a stream, not the
 * context's output, so the person sharing does not hear their system twice.
 */

/** Matches what the helper is told to produce. */
const SAMPLE_RATE = 48_000;

const WORKLET_SOURCE = `
// One second of room. IPC is not a clock, so the chunks arrive in bursts.
const CAPACITY = ${SAMPLE_RATE};
// 40 ms queued before playing, and again after running dry: a burst late by a
// little is absorbed rather than heard as a click.
const PRIME = ${SAMPLE_RATE / 25};
// Past 200 ms the far end is hearing the share late for good, so the backlog is
// dropped back down to PRIME instead of carried.
const CEILING = ${SAMPLE_RATE / 5};

class BetweenUsShareAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left = new Float32Array(CAPACITY);
    this.right = new Float32Array(CAPACITY);
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.playing = false;
    this.port.onmessage = (event) => this.push(new Int16Array(event.data));
  }

  push(samples) {
    const frames = samples.length >> 1;
    for (let i = 0; i < frames; i++) {
      this.left[this.write] = samples[2 * i] / 32768;
      this.right[this.write] = samples[2 * i + 1] / 32768;
      this.write = (this.write + 1) % CAPACITY;
    }
    this.size += frames;
    if (this.size > CEILING) {
      const drop = this.size - PRIME;
      this.read = (this.read + drop) % CAPACITY;
      this.size -= drop;
    }
  }

  process(_inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] || left;
    if (!this.playing && this.size >= PRIME) this.playing = true;
    // Outputs start zeroed, so not playing is silence.
    if (!this.playing) return true;
    for (let i = 0; i < left.length; i++) {
      if (this.size === 0) {
        this.playing = false;
        break;
      }
      left[i] = this.left[this.read];
      right[i] = this.right[this.read];
      this.read = (this.read + 1) % CAPACITY;
      this.size--;
    }
    return true;
  }
}

registerProcessor('betweenus-share-audio', BetweenUsShareAudio);
`;

let moduleUrl: string | null = null;

export interface ShareAudio {
  track: MediaStreamTrack;
  /** Ends the capture and the track. Safe to call more than once. */
  stop: () => void;
}

/**
 * Starts the capture, or resolves null where it is unavailable or failed to
 * start - the caller then asks `getDisplayMedia` for audio the old way.
 */
export async function startShareAudio(): Promise<ShareAudio | null> {
  const bridge = window.betweenus;
  if (!bridge?.shareAudioSupported || !bridge.startShareAudio || !bridge.onShareAudio) return null;

  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  let unsubscribe: (() => void) | null = null;
  let track: MediaStreamTrack | null = null;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
    bridge.stopShareAudio?.();
    track?.stop();
    void context.close().catch(() => undefined);
  };

  try {
    moduleUrl ??= URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(moduleUrl);
    const node = new AudioWorkletNode(context, 'betweenus-share-audio', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 2;
    node.connect(destination);

    unsubscribe = bridge.onShareAudio((pcm) => {
      // A copy of just these bytes, which the worklet can then own outright.
      const chunk = pcm.slice();
      node.port.postMessage(chunk.buffer, [chunk.buffer]);
    });
    await context.resume();

    if (!(await bridge.startShareAudio())) {
      stop();
      return null;
    }
    track = destination.stream.getAudioTracks()[0] ?? null;
    if (!track) {
      stop();
      return null;
    }
    return { track, stop };
  } catch (error) {
    console.warn('[share-audio] falling back to whole-mix loopback:', error);
    stop();
    return null;
  }
}
