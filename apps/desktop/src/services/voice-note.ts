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

/**
 * A recording in progress.
 *
 * Two ways out, and they are not the same. `stop` returns the file; `cancel`
 * throws it away. Both release the microphone, because the only thing worse
 * than a lost recording is a recording light that stays on after it.
 */
export interface VoiceRecording {
  /** Finishes and returns the file, or null when nothing worth sending was captured. */
  stop(): Promise<File | null>;
  /** Abandons it. Nothing is returned and nothing is kept. */
  cancel(): void;
  /** Seconds recorded so far, for the counter on screen. */
  elapsed(): number;
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

  const startedAt = Date.now();
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
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

    cancel(): void {
      window.clearTimeout(ceiling);
      if (recorder.state !== 'inactive') recorder.stop();
      chunks.length = 0;
      release();
    },

    async stop(): Promise<File | null> {
      window.clearTimeout(ceiling);
      const seconds = elapsed();

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
      return new File([blob], voiceFileName(recorded), { type: recorded });
    },
  };
}

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
