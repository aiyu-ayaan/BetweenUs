/**
 * "Nobody can hear you", with the fix attached.
 *
 * The banner used to say to go and look in the device picker, which is one more
 * thing to find while somebody is talking into a microphone that is sending
 * nothing. The picker is here instead: the most likely cause of the warning is
 * the wrong input, so the input list is the warning.
 *
 * Both places that show the warning - the sidebar panel and the voice channel
 * screen - render this, so they cannot drift apart.
 */
import { DeviceSelect, useDevices } from '../../components/DeviceSelect';
import { useAudioSettings } from '../../stores/audioSettings';

export function NotHeardNotice({ compact = false }: { compact?: boolean }): JSX.Element {
  const [devices] = useDevices();
  const inputDeviceId = useAudioSettings((state) => state.settings.inputDeviceId);
  const update = useAudioSettings((state) => state.update);

  return (
    <div
      role="alert"
      className={`rounded bg-danger/10 text-danger ${compact ? 'px-2 py-1.5' : 'px-3 py-2.5'}`}
    >
      <p className={compact ? 'text-xs' : 'text-sm'}>
        Nobody can hear you - your microphone is sending nothing. Try another input:
      </p>
      <div className="mt-2">
        <DeviceSelect
          label="Input device"
          kind="audioinput"
          devices={devices}
          value={inputDeviceId}
          onChange={(next) => update({ inputDeviceId: next })}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        Changing this reopens the microphone straight away. If none of them work, the operating
        system is holding the device - check that nothing else is recording.
      </p>
    </div>
  );
}
