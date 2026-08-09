import { useCallback, useEffect, useState } from 'react';

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

  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <select
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className="mt-2 w-full cursor-pointer rounded bg-surface-950 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">System default</option>
        {options.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || 'Unnamed device'}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The device list, refreshed when the operating system's changes - plugging in
 * a headset mid-call is the moment somebody goes looking for this menu.
 *
 * The refresh function is for the other case: the labels are blank until the
 * microphone has been granted once, so whoever opens one wants the list read
 * again afterwards.
 */
export function useDevices(): [MediaDeviceInfo[], () => void] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const read = useCallback((): void => {
    void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => undefined);
  }, []);

  useEffect(() => {
    read();
    navigator.mediaDevices.addEventListener('devicechange', read);
    return () => navigator.mediaDevices.removeEventListener('devicechange', read);
  }, [read]);

  return [devices, read];
}
