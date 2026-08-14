/**
 * How this machine's microphone is set up. A machine, not an account: the
 * device names, the sensitivity that suits this room and the switches that suit
 * this headset are all properties of where you are sitting, so they belong in
 * local storage rather than on the server the way notification preferences do.
 *
 * Nothing here knows about peer connections. The voice store watches this and applies
 * what changed to the live room - which keeps the dependency pointing one way
 * and lets settings be changed before ever joining a call.
 */
import { create } from 'zustand';
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from '../services/voice-quality';

const STORAGE_KEY = 'nexora.voice-settings';

function load(): VoiceSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    // Spread over the defaults, so a setting added later has a value in a
    // profile that was written before it existed.
    return stored ? { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(stored) } : DEFAULT_VOICE_SETTINGS;
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

interface AudioSettingsState {
  settings: VoiceSettings;
  update: (patch: Partial<VoiceSettings>) => void;
}

export const useAudioSettings = create<AudioSettingsState>((set, get) => ({
  settings: load(),
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // A profile with no storage still gets the setting for this session.
    }
  },
}));
