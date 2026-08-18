/**
 * Talk while a key is held.
 *
 * The gate answers "is somebody making a noise". This answers a different
 * question - "do you mean to be heard" - and no amount of tuning a threshold
 * gets there: a shared room, a mechanical keyboard and somebody else's phone
 * call are all above any threshold that still passes a quiet voice.
 *
 * ## What this is not
 *
 * It listens to the *window*, so it works while BetweenUs is focused and not while
 * it is behind something else. Discord's is global because it installs a
 * low-level keyboard hook; Electron's `globalShortcut` cannot stand in for one,
 * because it delivers a press and never a release - a push-to-talk that opens
 * the microphone and cannot be told when the key came back up is worse than
 * none at all.
 *
 * ponytail: a native hook per platform is the upgrade, and it is the whole of
 * the remaining work - everything below stays as it is.
 */
import { useAudioSettings } from '../stores/audioSettings';
import { useVoiceStore } from '../stores/voice';
import { isTalkKey } from './talk-key';

let attached = false;
let held = false;

function talk(talking: boolean): void {
  if (held === talking) return;
  held = talking;
  void useVoiceStore.getState().setTalking(talking);
}

function onKeyDown(event: KeyboardEvent): void {
  const settings = useAudioSettings.getState().settings;
  if (!settings.pushToTalk) return;
  if (!isTalkKey(event, settings.pushToTalkKey)) return;
  talk(true);
}

function onKeyUp(event: KeyboardEvent): void {
  const settings = useAudioSettings.getState().settings;
  if (event.code !== settings.pushToTalkKey) return;
  talk(false);
}

/**
 * A key released while another window has focus never arrives here, so losing
 * focus closes the microphone. The alternative is a key that got stuck down
 * because somebody alt-tabbed mid-sentence, which is the failure that makes
 * people stop trusting push to talk.
 */
function onBlur(): void {
  talk(false);
}

/** Starts listening. Safe to call twice; the second call does nothing. */
export function startPushToTalk(): void {
  if (attached) return;
  attached = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
}

export function stopPushToTalk(): void {
  if (!attached) return;
  attached = false;
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  talk(false);
}
