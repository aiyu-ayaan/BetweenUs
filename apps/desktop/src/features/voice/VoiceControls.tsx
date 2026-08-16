/**
 * The mic / camera / screen / hang-up row.
 *
 * It lives in both the sidebar panel and the voice channel screen, so it is its
 * own component: the two places must never disagree about what is on.
 */
import { useState, type ReactNode } from 'react';
import { useVoiceStore } from '../../stores/voice';
import { useAudioSettings } from '../../stores/audioSettings';
import { describeKey } from '../../services/talk-key';
import { ScreenSharePicker } from './ScreenSharePicker';
import { DevicePicker } from './DevicePicker';
import {
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  ScreenShareIcon,
  SettingsIcon,
  VideoIcon,
  VideoOffIcon,
} from '../../components/icons';

export function VoiceControls({ size = 'sm' }: { size?: 'sm' | 'lg' }): JSX.Element {
  const status = useVoiceStore((state) => state.status);
  const micEnabled = useVoiceStore((state) => state.micEnabled);
  const cameraEnabled = useVoiceStore((state) => state.cameraEnabled);
  const screenEnabled = useVoiceStore((state) => state.screenEnabled);
  const toggleMic = useVoiceStore((state) => state.toggleMic);
  const talking = useVoiceStore((state) => state.talking);
  const pushToTalk = useAudioSettings((state) => state.settings.pushToTalk);
  const pushToTalkKey = useAudioSettings((state) => state.settings.pushToTalkKey);
  const toggleCamera = useVoiceStore((state) => state.toggleCamera);
  const stopScreenShare = useVoiceStore((state) => state.stopScreenShare);
  const leave = useVoiceStore((state) => state.leave);

  // Starting a share asks what to share first; stopping is immediate.
  const [picking, setPicking] = useState(false);
  // Devices can be changed before the call connects - a headset plugged in
  // late is exactly when somebody goes looking for this.
  const [choosingDevices, setChoosingDevices] = useState(false);

  const disabled = status !== 'connected';
  const icon = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  const pad = size === 'lg' ? 'p-3' : 'p-2';

  return (
    <div className={`flex items-center ${size === 'lg' ? 'gap-2' : 'gap-1'}`}>
      {/* Under push to talk the button still means "am I in this call at all",
          and the key means "right now". A muted microphone stays muted however
          long the key is held, so the label has to say which of the two is
          being changed. */}
      <ControlButton
        active={micEnabled && (!pushToTalk || talking)}
        disabled={disabled}
        pad={pad}
        label={
          !micEnabled
            ? 'Unmute microphone'
            : pushToTalk
              ? `Hold ${describeKey(pushToTalkKey)} to talk - click to mute`
              : 'Mute microphone'
        }
        onClick={() => void toggleMic()}
      >
        {micEnabled ? <MicIcon className={icon} /> : <MicOffIcon className={icon} />}
      </ControlButton>

      <ControlButton
        active={cameraEnabled}
        disabled={disabled}
        pad={pad}
        label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
        onClick={() => void toggleCamera()}
      >
        {cameraEnabled ? <VideoIcon className={icon} /> : <VideoOffIcon className={icon} />}
      </ControlButton>

      <ControlButton
        active={screenEnabled}
        disabled={disabled}
        pad={pad}
        label={screenEnabled ? 'Stop sharing screen' : 'Share screen'}
        onClick={() => (screenEnabled ? void stopScreenShare() : setPicking(true))}
      >
        <ScreenShareIcon className={icon} />
      </ControlButton>

      {picking && <ScreenSharePicker onClose={() => setPicking(false)} />}

      <div className="relative">
        <ControlButton
          active={choosingDevices}
          pad={pad}
          label="Microphone and speakers"
          onClick={() => setChoosingDevices((open) => !open)}
        >
          <SettingsIcon className={icon} />
        </ControlButton>
        {choosingDevices && <DevicePicker onClose={() => setChoosingDevices(false)} />}
      </div>

      <button
        type="button"
        onClick={() => void leave()}
        aria-label="Disconnect from voice"
        title="Disconnect"
        className={`${size === 'lg' ? '' : 'ml-auto'} flex items-center justify-center cursor-pointer rounded-md bg-red-600 ${pad} text-white transition-colors duration-200 hover:bg-red-500 active:bg-red-700`}
      >
        <PhoneOffIcon className={icon} />
      </button>
    </div>
  );
}

function ControlButton({
  active,
  disabled,
  pad,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  pad: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`flex items-center justify-center rounded-md ${pad} transition-colors duration-200 ${
        disabled
          ? 'cursor-not-allowed bg-surface-800 text-slate-600 opacity-50'
          : active
          ? 'cursor-pointer bg-surface-700 text-slate-100 hover:bg-white/[0.06]'
          : 'cursor-pointer bg-surface-800 text-slate-400 hover:bg-white/[0.06]'
      }`}
    >
      {children}
    </button>
  );
}
