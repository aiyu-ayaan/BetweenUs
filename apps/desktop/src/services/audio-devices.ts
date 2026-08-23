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
): boolean {
  if (!chosen) return true;
  // Chosen but absent: the fallback is the best that can be done, and
  // recapturing would only pick the same fallback again.
  if (chosenIsMissing(devices, 'audioinput', chosen)) return false;
  return capturedDeviceId !== chosen;
}
