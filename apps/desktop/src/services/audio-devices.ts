/**
 * What this machine has plugged in, in one place.
 *
 * Every picker used to enumerate the hardware for itself, which meant two lists
 * that could disagree and a stale one behind any popover that happened to be
 * mounted before a headset arrived. There is one list here, one `devicechange`
 * listener behind it, and everything that draws or decides reads it.
 *
 * The pure parts - which device a setting resolves to, and whether it is still
 * there - are exported separately so they can be tested under Node.
 *
 * **Cameras are in here too, despite the file name.** `enumerateDevices` returns
 * every kind at once and every rule below was already written against a
 * `MediaDeviceKind` rather than against microphones; only the capture helper
 * was audio-shaped, and only by which constraint key it fills in. A parallel
 * `video-devices.ts` would have been this file with two words changed and a
 * second `devicechange` listener racing this one - and the unplugged-device
 * rule, which is the subtle part, duplicated away from its self-check.
 */

let devices: MediaDeviceInfo[] = [];
const listeners = new Set<(devices: MediaDeviceInfo[]) => void>();

/** The list as last read. Empty before the first enumeration. */
export function readDevices(): MediaDeviceInfo[] {
  return devices;
}

/** Re-reads the hardware. Cheap, and idempotent. */
export function refreshDevices(): void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
  void navigator.mediaDevices
    .enumerateDevices()
    .then((found) => {
      devices = realDevices(found);
      for (const listener of listeners) listener(devices);
    })
    .catch(() => undefined);
}

/**
 * The hardware, with the stand-in for "you have not been asked yet" removed.
 *
 * Before the microphone has ever been granted, `enumerateDevices` does not
 * return nothing - it returns one entry per kind with an empty id and an empty
 * label, which is the browser saying a device of that kind exists and declining
 * to say which. Kept, that placeholder is indistinguishable from a real list of
 * one, and every question asked of the list gets the wrong answer from it: a
 * chosen microphone is reported missing because the placeholder is not it, the
 * picker falls back to showing "System default" over a choice that is still
 * there, and the warning about an unplugged device appears on a machine with
 * nothing unplugged.
 *
 * Dropped, the list is empty until permission - and empty already means "not
 * enumerated yet" everywhere below, which is the truth.
 */
export function realDevices(found: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return found.filter((device) => device.deviceId !== '');
}

/** Calls back on every change, and returns the unsubscribe. */
export function onDevicesChanged(listener: (devices: MediaDeviceInfo[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  // The labels are blank until a capture has been granted once, and a granted
  // permission is not an event - so the list is also re-read when the window
  // comes back, which is after the permission prompt and after the operating
  // system's own sound settings have been visited.
  window.addEventListener('focus', refreshDevices);
  refreshDevices();
}

/**
 * True when a device has been chosen and is no longer connected.
 *
 * This is the state behind "it picked the wrong microphone": the capture
 * constraint is deliberately not `exact`, so an absent device is not an error -
 * it is a silent fallback to whatever the operating system calls the default.
 *
 * An empty list is not an answer: it means nothing has been enumerated yet, and
 * warning about a device that has simply not been looked for is worse than
 * saying nothing.
 */
export function chosenIsMissing(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind,
  chosen: string | null,
): boolean {
  if (!chosen) return false;
  const ofKind = devices.filter((device) => device.kind === kind);
  if (ofKind.length === 0) return false;
  return !ofKind.some((device) => device.deviceId === chosen);
}

/**
 * Whether a device change means the live capture is now on the wrong device.
 *
 * Two cases, and they are different questions. With a device chosen, the
 * capture is wrong when it is not on that device - which happens when the
 * device was unplugged and has come back, since the fallback capture does not
 * follow it home. With nothing chosen the capture follows the system default,
 * and the default is exactly what changes when somebody plugs in a headset -
 * so any change at all is worth recapturing for.
 */
export function captureIsStale(
  chosen: string | null,
  capturedDeviceId: string | null,
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind = 'audioinput',
): boolean {
  if (!chosen) return true;
  // Chosen but absent: the fallback is the best that can be done, and
  // recapturing would only pick the same fallback again.
  if (chosenIsMissing(devices, kind, chosen)) return false;
  return capturedDeviceId !== chosen;
}

/**
 * Whether a `getUserMedia` failure is "that device is not there", as opposed to
 * a refused permission or a machine with no microphone at all.
 *
 * `OverconstrainedError` is the spec's answer and what Chromium raises for an
 * `exact` device id it cannot satisfy. `NotFoundError` is the same sentence
 * from a browser that checked the hardware first, so both are treated as the
 * device having gone - and a machine with genuinely nothing plugged in still
 * fails, on the retry, which is the truthful failure.
 */
function deviceIsGone(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'OverconstrainedError' || error.name === 'NotFoundError';
}

/**
 * Opens a microphone, falling back to the system default when the chosen device
 * has gone.
 *
 * Every audio constraint in this app names its device with `exact`, because
 * nothing weaker is honoured - see `deviceConstraint`. `exact` is also what
 * turns an unplugged headset from a silent substitution into a refusal, so the
 * substitution is made here instead: deliberately, in one place, and only for
 * the failure that actually means the device is missing. A denied permission is
 * re-thrown, because retrying it would only be denied again while making the
 * error say something else.
 */
export async function openAudioCapture(constraints: MediaTrackConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: constraints });
  } catch (error) {
    if (constraints.deviceId === undefined || !deviceIsGone(error)) throw error;
    const { deviceId: _gone, ...withoutDevice } = constraints;
    return navigator.mediaDevices.getUserMedia({ audio: withoutDevice });
  }
}

/**
 * Which constraint a browser refused, when it says so.
 *
 * `OverconstrainedError` carries the name of the offending constraint, and a
 * camera gives two genuinely different reasons to raise one: the device id is
 * for a webcam that has been unplugged, or the resolution is one this camera
 * has no format for. They want opposite retries - keep the size and drop the
 * device, or keep the device and drop the size - so guessing is worse than
 * asking. A browser that does not fill the field in is treated as the device
 * case, which is the far commoner one.
 */
function refusedConstraint(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const named = (error as { constraint?: unknown }).constraint;
  return typeof named === 'string' && named !== '' ? named : null;
}

/**
 * Opens a camera, giving up the least it can when the ask cannot be met.
 *
 * The camera is asked for with `exact` on the device and `ideal` on everything
 * else, for the reasons in `camera-quality.ts`. That leaves exactly two ways to
 * be refused, and collapsing both to `video: true` would throw away the working
 * half of the request along with the broken one:
 *
 * - **The chosen camera is gone.** Keep the resolution, drop the device, and
 *   land on the system default - the same deliberate substitution
 *   `openAudioCapture` makes, and the reason `exact` is affordable at all.
 * - **This camera has no such format.** Keep the device - somebody picked it -
 *   and drop the size, letting the camera open at whatever it does have.
 *
 * A second failure is reported rather than retried. Anything else here is a
 * refused permission or a machine with no camera, and retrying either only
 * makes the eventual error say something less true.
 */
export async function openVideoCapture(constraints: MediaTrackConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: constraints });
  } catch (error) {
    if (!deviceIsGone(error)) throw error;

    const refused = refusedConstraint(error);
    if (refused === 'width' || refused === 'height' || refused === 'frameRate') {
      const { width: _w, height: _h, frameRate: _f, ...withoutSize } = constraints;
      return navigator.mediaDevices.getUserMedia({ video: withoutSize });
    }

    if (constraints.deviceId === undefined) throw error;
    const { deviceId: _gone, ...withoutDevice } = constraints;
    return navigator.mediaDevices.getUserMedia({ video: withoutDevice });
  }
}
