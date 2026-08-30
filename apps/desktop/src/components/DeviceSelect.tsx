import { useEffect, useState } from 'react';
import {
  onDevicesChanged,
  readDevices,
  refreshDevices,
  chosenIsMissing,
} from '../services/audio-devices';

/**
 * A microphone or speaker picker, used by Voice & Video in settings and by the
 * one in the call controls - the two must never disagree about what is chosen.
 *
 * `null` is the system default and stays a real option: a machine whose chosen
 * device has since been unplugged should fall back rather than fail a join.
 * Device labels are blank until the microphone has been granted once, which is
 * the operating system's rule and not something the app can work around.
 */
export function DeviceSelect({
  label,
  kind,
  devices,
  value,
  onChange,
}: {
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value: string | null;
  onChange: (deviceId: string | null) => void;
}): JSX.Element {
  const options = devices.filter((device) => device.kind === kind && device.deviceId !== 'default');
  // A chosen device that is no longer plugged in is captured with `exact` like
  // any other, refused, and retried on the system default by `openAudioCapture`.
  // The person still hears a microphone they did not choose, so the substitution
  // is said out loud here rather than left to be discovered.
  const missing = chosenIsMissing(devices, kind, value);

  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <select
        value={missing ? '' : (value ?? '')}
        onChange={(event) => onChange(event.target.value || null)}
        className="mt-2 w-full cursor-pointer rounded-lg border border-edge bg-surface-950 px-3 py-2 text-slate-100 outline-none transition-colors focus:border-accent/60"
      >
        <option value="">System default</option>
        {options.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || 'Unnamed device'}
          </option>
        ))}
      </select>
      {missing && (
        <span className="mt-1.5 block text-xs text-amber-300">
          The device you chose is not connected. The system default is being used instead - pick
          another to make it stick.
        </span>
      )}
    </label>
  );
}

/**
 * The device list, refreshed when the operating system's changes - plugging in
 * a headset mid-call is the moment somebody goes looking for this menu.
 *
 * One list for the whole window rather than one enumeration per picker: the
 * settings screen and the in-call popover were reading the hardware separately
 * and could disagree about what was plugged in. The refresh function is for the
 * other case - the labels are blank until the microphone has been granted once,
 * so whoever opens one wants the list read again afterwards.
 */
export function useDevices(): [MediaDeviceInfo[], () => void] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>(readDevices);

  useEffect(() => {
    refreshDevices();
    return onDevicesChanged(setDevices);
  }, []);

  return [devices, refreshDevices];
}
