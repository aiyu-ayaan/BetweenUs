/**
 * Microphone, speakers and camera, changed from inside the call.
 *
 * The full set of controls lives in Settings → Voice & Video, but the moment
 * somebody wants their devices is the moment they cannot be heard - which is a
 * bad time to go looking through a settings screen. Discord puts the same two
 * lists behind the arrow on the mute button for the same reason.
 *
 * It writes to the same store the settings screen does, so a change here is
 * remembered and applied to the running call by the voice store.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { DeviceSelect, useDevices } from '../../components/DeviceSelect';
import { useAudioSettings } from '../../stores/audioSettings';
import { CallPopover } from './CallPopover';

export function DevicePicker({
  anchor,
  onClose,
}: {
  /** The button that opened it: placed against, and left to close it itself. */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
}): JSX.Element {
  const [devices] = useDevices();
  const settings = useAudioSettings((state) => state.settings);
  const update = useAudioSettings((state) => state.update);
  const panel = useRef<HTMLDivElement>(null);

  // A popover closes when it is clicked away from or Escape is pressed; a
  // pointerdown rather than a click, so a drag that starts outside counts.
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      const target = event.target as Node;
      // The button toggles it on its own click; closing here as well would
      // reopen it on that same click.
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
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
  }, [anchor, onClose]);

  return (
    <CallPopover anchor={anchor} panel={panel} width={288} className="space-y-4 p-4">
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
      <DeviceSelect
        label="Camera"
        kind="videoinput"
        devices={devices}
        value={settings.camera.deviceId}
        onChange={(deviceId) => update({ camera: { ...settings.camera, deviceId } })}
      />
      <p className="text-xs text-slate-400">
        Sensitivity, processing and camera quality are in Settings → Voice &amp; Video.
      </p>
    </CallPopover>
  );
}
