import { VOICE_WAVEFORM_BARS } from '@betweenus/shared-types';

/**
 * Recording a voice message.
 *
 * A voice message is not a new kind of message. It is a recording, encrypted
 * and uploaded exactly like a file somebody picked with the paperclip, and it
 * arrives as an audio attachment that the message list already knows how to
 * play. That is the whole design, and it is why this file is short: everything
 * downstream of "here is a File" already existed.
 *
 * What it does own is the awkward half - holding a microphone open, stopping
 * it properly, and handing the track back to the operating system afterwards.
 * A recorder that leaks its stream leaves the recording light on, which is the
 * one bug in this area nobody forgives.
 */

/**
 * What to record into.
 *
 * Opus in a WebM container is the first choice: it is what Chromium encodes
 * natively, it is what the voice call path already uses, and it is roughly a
 * tenth the size of anything uncompressed. The rest is fallback for a runtime
 * that disagrees - Safari answers MP4/AAC - and the empty string at the end is
 * "whatever you would have picked anyway", which is always allowed.
 */
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  '',
];

/** The first container this runtime will actually record into. */
function pickType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return CANDIDATES.find((type) => type === '' || MediaRecorder.isTypeSupported(type)) ?? '';
}

/** Whether this runtime can record at all, asked before a button is drawn. */
export function canRecordVoice(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** The file extension that matches a recorder's mime type. */
export function extensionFor(type: string): string {
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

/** A finished recording: the file, and what it looked like being made. */
export interface RecordedVoice {
  file: File;
  /** Seconds, rounded to a tenth - the label, not a seek position. */
  duration: number;
  /** Bar heights 0..1, `VOICE_WAVEFORM_BARS` of them. */
  waveform: number[];
}

/**
 * A recording in progress.
 *
 * Two ways out, and they are not the same. `stop` returns the recording;
 * `cancel` throws it away. Both release the microphone, because the only thing
 * worse than a lost recording is a recording light that stays on after it.
 */
export interface VoiceRecording {
  /** Finishes and returns it, or null when nothing worth sending was captured. */
  stop(): Promise<RecordedVoice | null>;
  /** Abandons it. Nothing is returned and nothing is kept. */
  cancel(): void;
  /** Seconds recorded so far, for the counter on screen. */
  elapsed(): number;
  /**
   * The bars measured so far, so the composer can draw the recording as it
   * happens. The same samples that end up in the manifest.
   */
  levels(): number[];
}

/**
 * Longer than this and the recorder stops itself.
 *
 * Five minutes, matched to nothing in particular except that a voice message
 * is a voice message. What it is really guarding is the case where somebody
 * starts a recording and walks away: without a ceiling that is an open
 * microphone and a growing buffer until the window is closed.
 */
export const MAX_SECONDS = 5 * 60;

/**
 * A recording shorter than this is a slip of the finger, not a message.
 *
 * Every messenger has this threshold because every messenger has the same
 * gesture: a tap that was meant to be a hold produces a quarter-second of
 * room tone, and sending it is never what anybody meant.
 */
export const MIN_SECONDS = 1;

/**
 * Opens the microphone and starts recording.
 *
 * Throws if the microphone is refused or missing, which is the caller's to put
 * on screen: it is the one failure here a person can do something about.
 */
export async function startVoiceRecording(): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // The processing a spoken message wants, and the same three the call path
    // asks for in its `clear` mode. A voice note is speech in a room, not a
    // recording session.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const type = pickType();
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  // The shape of the message, measured while it is being spoken.
  //
  // Taken off the live stream rather than computed from the finished file,
  // because the finished file is compressed Opus - getting samples back out of
  // it means decoding it, and this is a signal already passing through here.
  const meter = openMeter(stream);

  const startedAt = Date.now();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    meter.close();
    for (const track of stream.getTracks()) track.stop();
  };

  recorder.start();
  // The ceiling, as a timer rather than as a check somewhere: a recorder that
  // has been walked away from is precisely the one nobody is asking anything.
  const ceiling = window.setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, MAX_SECONDS * 1000);

  const elapsed = (): number => (Date.now() - startedAt) / 1000;

  return {
    elapsed,
    levels: () => meter.levels(),

    cancel(): void {
      window.clearTimeout(ceiling);
      if (recorder.state !== 'inactive') recorder.stop();
      chunks.length = 0;
      release();
    },

    async stop(): Promise<RecordedVoice | null> {
      window.clearTimeout(ceiling);
      const seconds = elapsed();
      // Read before `release`, which closes the meter.
      const measured = meter.levels();

      // The last chunk arrives with `stop`, not before it, so the file cannot
      // be assembled until the recorder says it is done.
      await new Promise<void>((resolve) => {
        if (recorder.state === 'inactive') {
          resolve();
          return;
        }
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      release();

      if (seconds < MIN_SECONDS || chunks.length === 0) return null;

      const recorded = recorder.mimeType || type || 'audio/webm';
      const blob = new Blob(chunks, { type: recorded });
      return {
        file: new File([blob], voiceFileName(recorded), { type: recorded }),
        duration: Math.round(seconds * 10) / 10,
        waveform: toWaveform(measured),
      };
    },
  };
}

/**
 * How often the level is sampled while recording.
 *
 * Ten times a second: fast enough that a syllable registers as its own bar in
 * a short message, slow enough that a five-minute recording is a few thousand
 * numbers rather than a few hundred thousand, all of which are then thrown
 * away by the downsample anyway.
 */
const SAMPLE_MS = 100;

/**
 * A meter on the live microphone.
 *
 * `AnalyserNode` over `ScriptProcessorNode` because the former is a read
 * whenever you want one and the latter is a deprecated callback on the audio
 * thread. Nothing here is in the recording path - the meter is a branch off
 * the same stream, so a failure to open it costs the waveform and never the
 * message.
 */
function openMeter(stream: MediaStream): { levels: () => number[]; close: () => void } {
  const samples: number[] = [];
  let context: AudioContext | null = null;
  let ticker = 0;

  try {
    context = new AudioContext();
    const analyser = context.createAnalyser();
    // Small: this is a loudness reading, not a spectrum. A short window also
    // means the value tracks the syllable rather than averaging over it.
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    ticker = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      // Root mean square, which is loudness as an ear hears it. A peak reading
      // makes every bar full height the moment anybody says a hard consonant.
      let sum = 0;
      for (const value of buffer) sum += value * value;
      samples.push(Math.sqrt(sum / buffer.length));
    }, SAMPLE_MS);
  } catch {
    // No meter on this runtime. The recording is unaffected; the message
    // arrives with no waveform and the player draws a flat one.
  }

  return {
    levels: () => [...samples],
    close: () => {
      if (ticker) window.clearInterval(ticker);
      void context?.close().catch(() => undefined);
    },
  };
}

/**
 * Raw amplitude samples, as the bars a player draws.
 *
 * Two steps, and the second is the one that matters. Downsampling to a fixed
 * count makes every message the same width. Normalising against the loudest
 * bar makes a quiet recording look like a recording rather than like silence -
 * absolute levels vary by an order of magnitude between microphones, and a
 * waveform is read as a shape, never as a measurement.
 *
 * A floor under every bar so silence is still a line. A waveform with gaps in
 * it reads as a broken file rather than as a pause for breath.
 */
export function toWaveform(samples: number[], bars = VOICE_WAVEFORM_BARS): number[] {
  if (samples.length === 0) return [];

  const buckets: number[] = [];
  for (let index = 0; index < bars; index += 1) {
    const from = Math.floor((index * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((index + 1) * samples.length) / bars));
    let sum = 0;
    for (let at = from; at < to; at += 1) sum += samples[at] ?? 0;
    buckets.push(sum / (to - from));
  }

  const loudest = Math.max(...buckets);
  // Everything was silence: a flat line is honest, and dividing by zero is not.
  if (loudest <= 0) return buckets.map(() => MIN_BAR);
  return buckets.map((value) => Math.max(MIN_BAR, Math.min(1, value / loudest)));
}

/** No bar is ever shorter than this, so a pause is a line and not a hole. */
const MIN_BAR = 0.08;

/**
 * What a recording is called.
 *
 * Named for what it is and when it was, so a channel of them reads as a list
 * rather than as six files called "audio". The stamp is local time, because it
 * is a label for whoever is looking at it and not a timestamp anything parses.
 */
export function voiceFileName(contentType: string, at: Date = new Date()): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `_${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `voice_${stamp}.${extensionFor(contentType)}`;
}

/** `m:ss`, which is how long a voice message is ever worth spelling out. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}`;
}
