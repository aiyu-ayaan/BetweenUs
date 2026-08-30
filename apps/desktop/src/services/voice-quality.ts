/**
 * How a microphone is captured and encoded, and why the defaults are not it.
 *
 * A voice channel used to be published with a media SDK's defaults: 48 kbps,
 * mono, echo cancellation / noise suppression / gain control left at whatever
 * the browser felt like, one device (the system default), and no way
 * for anybody to change any of it. That is fine on a headset in a quiet room and
 * audibly worse than Discord anywhere else - a fan, a mechanical keyboard or a
 * flatmate ends up in the room with you, and somebody with two microphones has
 * no way to say which one.
 *
 * What Discord actually does, and what is reachable from here:
 *
 * - **Ask the platform for its best denoiser.** Discord ships Krisp, an ML model
 *   in a native library. Chromium has grown `voiceIsolation`, which is the same
 *   idea behind a constraint: a stronger, model-based suppressor that keeps a
 *   voice and drops everything else. Where it exists it replaces
 *   `noiseSuppression`; where it does not, it is ignored and the ordinary WebRTC
 *   suppressor still runs. Nothing to ship, nothing to load.
 * - **Gate the quiet.** Suppression cleans up a signal; it does not decide that
 *   nobody is talking. Discord's input sensitivity does, and it is what makes a
 *   Discord call silent between sentences. That is `mic-gate.ts`, driven by the
 *   threshold here.
 * - **Spend a sensible bitrate.** 64 kbps mono is Discord's voice channel and is
 *   transparent for speech; 128 kbps stereo is what a music bot or a "hi-fi"
 *   mode wants. These are the numbers every media SDK's "presets" are made of,
 *   written out here where the reason for them can sit beside them.
 * - **Let the two modes be opposite.** Everything that makes speech clear ruins
 *   music: gain control pumps, suppression eats reverb tails, DTX cuts a quiet
 *   passage out entirely, and mono throws half a recording away. Rather than a
 *   quality slider that means nothing, the mode says what the microphone is
 *   *for*, exactly as the screen-share picker asks what is on the screen
 *   (`share-quality.ts`).
 *
 * The pure part lives here, with a self-check, because a wrong constraint object
 * is inaudible until somebody else is listening to it.
 */

import { NO_OVERRIDE, type QualityOverride } from './share-quality';

/**
 * Something that sits between a captured track and the one that is sent.
 *
 * The gate in `mic-gate.ts` is the only implementation, and the shape is the
 * one a media SDK used to call with. It is kept because it is the right shape
 * independently of who calls it: give it the raw track and an audio context,
 * take `processedTrack` back, send that instead.
 */
export interface AudioProcessor {
  readonly name: string;
  processedTrack?: MediaStreamTrack;
  init(options: { track: MediaStreamTrack; audioContext: AudioContext }): Promise<void>;
  restart(options: { track: MediaStreamTrack; audioContext: AudioContext }): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * The constraints half of `getUserMedia({ audio })`.
 *
 * `voiceIsolation` is not in the DOM types yet, so the extra member is spelled
 * out rather than cast away at every call site.
 */
export type MicConstraints = MediaTrackConstraints & { voiceIsolation?: boolean };

/**
 * How the microphone is encoded once it is on a sender.
 *
 * `maxBitrate` goes on the encoding parameters, which can be changed on a live
 * sender. `stereo`, `dtx` and `red` are Opus payload options and live in the
 * SDP's `fmtp` line, so they are fixed when the connection is negotiated - see
 * `mesh.ts`, which is where both are applied.
 */
export interface MicEncoding {
  maxBitrate: number;
  stereo: boolean;
  dtx: boolean;
  red: boolean;
}

/**
 * What the microphone is for. Not a quality slider - the two want opposite
 * processing, and neither is "better".
 */
export type VoiceMode = 'clear' | 'hifi';

/**
 * How much suppression to ask the platform for. See `VoiceSettings.noiseSuppression`.
 *
 * Deliberately the same three names the Android client uses, so a support
 * conversation about "set it to High" means one thing on both.
 */
export type NoiseSuppression = 'off' | 'standard' | 'high';

export interface VoiceSettings {
  mode: VoiceMode;
  /** `null` means the system default device, which is what most people want. */
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /**
   * Fall back to the system default when a chosen device is unplugged.
   *
   * A device id is remembered forever and the hardware is not: pick a headset
   * once and every later call is pinned to it, so the call after it is put away
   * opens a microphone that is in a drawer. On by default, because a device
   * that is gone is not a choice.
   *
   * It is only ever the *chosen* device going away that drops the choice. This
   * used to drop it on any device change at all, which made an explicit choice
   * impossible to keep: see `unpinDevices` in stores/voice.ts.
   *
   * Off is for the machine where the fallback is worse than the failure - one
   * whose system default is a microphone that must never be picked.
   */
  followSystemDevices: boolean;
  echoCancellation: boolean;
  /**
   * How hard to work at removing everything that is not a voice.
   *
   * Three levels rather than a switch, because the honest answer to "should
   * noise suppression be on" depends on hardware nobody can see from here.
   * `standard` is the ordinary WebRTC suppressor, which is tuned for
   * *stationary* noise - a fan, a hiss, an air conditioner. `high` additionally
   * asks for `voiceIsolation`, Chromium's model-based suppressor, which is the
   * one that removes a keyboard, a dog and a flatmate; it costs measurably more
   * CPU and it is the wrong default for a laptop on battery in a quiet room.
   *
   * Where `voiceIsolation` is not supported the constraint is ignored and
   * `high` degrades to `standard`, which is why asking for it costs nothing.
   */
  noiseSuppression: NoiseSuppression;
  autoGainControl: boolean;
  /**
   * dBFS below which the microphone is closed, or `null` for an open mic.
   * Discord calls this input sensitivity.
   */
  gateThresholdDb: number | null;
  /**
   * Talk only while a key is held. The gate answers "is somebody speaking";
   * this answers "do you mean to be heard", which is the question a shared room,
   * a mechanical keyboard and a phone call in the background all raise.
   */
  pushToTalk: boolean;
  /**
   * `KeyboardEvent.code` of the key that opens the microphone. A code rather
   * than a key, so it is the same physical key on every layout.
   */
  pushToTalkKey: string;
  /**
   * The two notes when somebody arrives or leaves the call. On by default: a
   * voice channel is the one screen nobody is looking at, so who is in it has
   * to be audible or it is not knowable at all.
   */
  callTones: boolean;
  /**
   * What this machine says the share ladder got wrong - see `QualityOverride`
   * in `share-quality.ts`. It lives here because it is a property of the
   * machine and the network it is on, which is what everything else in this
   * object is; it covers a screen share in a call and a remote session, since
   * both are the same encoder being asked the same question.
   */
  share: QualityOverride;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  mode: 'clear',
  inputDeviceId: null,
  outputDeviceId: null,
  followSystemDevices: true,
  echoCancellation: true,
  noiseSuppression: 'standard',
  autoGainControl: true,
  // Quiet enough that a normal voice is nowhere near it, loud enough to sit
  // above room tone on a cheap microphone.
  gateThresholdDb: -50,
  pushToTalk: false,
  // Not Space: the composer is one keystroke away at all times, and a
  // push-to-talk key that also types is a key nobody can use.
  pushToTalkKey: 'AltRight',
  callTones: true,
  share: NO_OVERRIDE,
};

/**
 * The usable ends of the sensitivity slider. Below -80 dBFS is under the noise
 * floor of every microphone made, and above -20 dBFS a shout would not open it.
 */
export const GATE_RANGE = { minDb: -80, maxDb: -20 } as const;

/** Opus bitrate ceilings, in bits per second. */
const BITRATE = {
  // Discord's voice channel. Transparent for speech; anything more is spent on
  // reproducing a room nobody wants reproduced.
  clear: 64_000,
  // Two channels of music, which is four times the information a voice is.
  hifi: 128_000,
} as const;

/**
 * The three switches, resolved for a mode.
 *
 * `voiceIsolation` is the interesting one: where Chromium supports it, it is a
 * model-based suppressor in the same league as Krisp and it takes over from
 * `noiseSuppression` entirely. Where it does not, an unknown constraint is
 * ignored - so asking costs nothing and never fails a capture.
 */
export function micProcessing(
  settings: VoiceSettings,
): Pick<
  MicConstraints,
  'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'voiceIsolation'
> {
  if (settings.mode === 'hifi') {
    // Not a preference: every one of these is destructive to music, and a mode
    // that says "this is an instrument" has already answered the question.
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      voiceIsolation: false,
    };
  }

  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression !== 'off',
    autoGainControl: settings.autoGainControl,
    // Only `high` asks for the model. This used to be tied to the same boolean
    // as `noiseSuppression`, which meant every call anybody ever made ran the
    // expensive suppressor whether or not their room needed it, and there was
    // no way to ask for the cheap one on its own.
    voiceIsolation: settings.noiseSuppression === 'high',
  };
}

/**
 * Reads a stored settings object written by an older build.
 *
 * `noiseSuppression` was a boolean until the three levels existed, and the
 * settings store spreads whatever is in local storage over the defaults - so
 * without this a profile written last week arrives with `true` where a
 * `NoiseSuppression` belongs. That is not a type error at runtime, it is worse:
 * `true !== 'off'` and `true !== 'high'`, so the setting silently behaves as
 * `standard` while the settings screen has no option matching it and draws
 * nothing as selected.
 *
 * Pure, and exported, because a migration that is only exercised by upgrading
 * users is a migration nobody ever runs before shipping it.
 */
export function migrateVoiceSettings(stored: unknown): Partial<VoiceSettings> {
  if (typeof stored !== 'object' || stored === null) return {};
  const settings = { ...(stored as Record<string, unknown>) };

  // The old switch: on meant the ordinary suppressor, which is `standard`.
  // Anyone who wants the model-based one can now say so explicitly.
  if (typeof settings.noiseSuppression === 'boolean') {
    settings.noiseSuppression = settings.noiseSuppression ? 'standard' : 'off';
  } else if (!isNoiseSuppression(settings.noiseSuppression)) {
    delete settings.noiseSuppression;
  }

  return settings as Partial<VoiceSettings>;
}

/** Narrows an unknown to a level, so a hand-edited profile cannot poison it. */
export function isNoiseSuppression(value: unknown): value is NoiseSuppression {
  return value === 'off' || value === 'standard' || value === 'high';
}

/**
 * The `deviceId` half of an audio constraint, for a chosen device or none.
 *
 * `exact`, and it has to be. A bare `deviceId` string is the `ideal` form,
 * which is advisory: the browser scores every microphone by fitness distance
 * and is free to hand back a different one, and Chromium does - it opens
 * whatever the operating system calls the default. That is the whole of
 * "changing the input device does not change the input device". Every pick
 * reopened the same microphone, and nothing said so, because a capture that
 * ignored the constraint is not an error.
 *
 * Asking properly costs the silent fallback for a device that has been
 * unplugged since it was chosen: `exact` refuses instead of substituting. That
 * fallback is worth having and is now done deliberately, once, by
 * `openAudioCapture` - rather than bought by asking in a form nothing honours.
 */
export function deviceConstraint(deviceId: string | null): Pick<MicConstraints, 'deviceId'> {
  return deviceId ? { deviceId: { exact: deviceId } } : {};
}

/** Capture constraints for the microphone. */
export function micCapture(settings: VoiceSettings): MicConstraints {
  return {
    ...micProcessing(settings),
    channelCount: settings.mode === 'hifi' ? 2 : 1,
    ...deviceConstraint(settings.inputDeviceId),
  };
}

/** How the microphone is encoded on the wire. */
export function micEncoding(settings: VoiceSettings): MicEncoding {
  const hifi = settings.mode === 'hifi';

  return {
    maxBitrate: hifi ? BITRATE.hifi : BITRATE.clear,
    stereo: hifi,
    // DTX stops sending during silence, which is most of a call and none of a
    // recording - a held piano note is exactly what it deletes.
    dtx: !hifi,
    // Redundant audio data: a packet carries the previous one as well, so a
    // single loss is inaudible. Cheap at these bitrates and worth it for both.
    red: true,
  };
}

export interface GateState {
  open: boolean;
  /** Seconds on the audio clock until which the gate stays open regardless. */
  heldUntil: number;
}

export const GATE_CLOSED: GateState = { open: false, heldUntil: 0 };

/**
 * One step of the noise gate.
 *
 * Three behaviours, and all three matter: it opens the instant the level
 * crosses the threshold (a gate that fades in eats the start of a word), it
 * holds open for a moment afterwards (so the gap between two words is not a
 * gap in the call), and it needs the level to fall further than the threshold
 * before it closes (without that, a voice sitting exactly on the line chatters
 * the gate open and shut).
 *
 * `nowSeconds` is the audio clock, not the wall clock.
 *
 * Deliberately self-contained - no module-level constants, no imports. This
 * function's own source is stringified into an AudioWorklet by `mic-gate.ts`,
 * so anything it closes over would not exist on the audio thread.
 */
export function stepGate(
  state: GateState,
  levelDb: number,
  thresholdDb: number,
  nowSeconds: number,
): GateState {
  const HOLD_SECONDS = 0.3;
  const HYSTERESIS_DB = 6;

  const loud = levelDb >= thresholdDb;
  const open = loud || nowSeconds < state.heldUntil || (state.open && levelDb >= thresholdDb - HYSTERESIS_DB);

  return { open, heldUntil: loud ? nowSeconds + HOLD_SECONDS : state.heldUntil };
}

/**
 * RMS amplitude (0..1) as dBFS, floored at -100 so silence is a number rather
 * than `-Infinity`. Self-contained for the same reason `stepGate` is.
 */
export function amplitudeToDb(rms: number): number {
  return rms > 0.00001 ? 20 * Math.log10(rms) : -100;
}
