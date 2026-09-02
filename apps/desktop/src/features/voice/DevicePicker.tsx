/**
 * Microphone and speakers, changed from inside the call.
 *
 * The full set of controls lives in Settings → Voice & Video, but the moment
 * somebody wants their devices is the moment they cannot be heard - which is a
 * bad time to go looking through a settings screen. Discord puts the same two
 * lists behind the arrow on the mute button for the same reason.
 *
 * It writes to the same store the settings screen does, so a change here is
 * remembered and applied to the running call by the voice store.
 */
import { useEffect, useRef } from 'react';
import { DeviceSelect, useDevices } from '../../components/DeviceSelect';
import { useAudioSettings } from '../../stores/audioSettings';

export function DevicePicker({ onClose }: { onClose: () => void }): JSX.Element {
  const [devices] = useDevices();
  const settings = useAudioSettings((state) => state.settings);
  const update = useAudioSettings((state) => state.update);
  const panel = useRef<HTMLDivElement>(null);

  // A popover closes when it is clicked away from or Escape is pressed; a
  // pointerdown rather than a click, so a drag that starts outside counts.
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div
      ref={panel}
      className="absolute bottom-full start-0 z-30 mb-2 w-72 space-y-4 rounded-lg bg-surface-800 p-4 shadow-lg"
    >
      <DeviceSelect
        label="Input device"
        kind="audioinput"
        devices={devices}
        value={settings.inputDeviceId}
        onChange={(inputDeviceId) => update({ inputDeviceId })}
      />
      <DeviceSelect
        label="Output device"
        kind="audiooutput"
        devices={devices}
        value={settings.outputDeviceId}
        onChange={(outputDeviceId) => update({ outputDeviceId })}
      />
      <p className="text-xs text-slate-400">
        Sensitivity and processing are in Settings → Voice &amp; Video.
      </p>
    </div>
  );
}
