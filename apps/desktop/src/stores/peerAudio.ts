/**
 * How loud each other person is, on this machine.
 *
 * The other half of what an audio settings screen is for. Input settings decide
 * how you sound; this decides how everyone else does - the person whose gain is
 * set too high, the one on a laptop microphone across a room, and the one you
 * would rather not hear at all while you keep listening to the others.
 *
 * A machine and not an account, the same reasoning `audioSettings.ts` gives:
 * somebody being too loud is a fact about these speakers and this room, and
 * carrying it to another device would be carrying the wrong thing.
 *
 * Keyed by user id rather than peer id. A peer id is per socket, so it changes
 * when somebody reconnects or moves the call to their laptop, and a volume that
 * resets when the other person's wifi drops is worse than none.
 */
import { create } from 'zustand';

const STORAGE_KEY = 'betweenus.peer-audio';

export interface PeerAudio {
  /** 0 to 1, where 1 is however loud they arrived. */
  volume: number;
  /** Silenced for me, without telling them and without touching anyone else. */
  muted: boolean;
}

export const DEFAULT_PEER_AUDIO: PeerAudio = { volume: 1, muted: false };

/**
 * What an `<audio>` element's `volume` should be.
 *
 * A muted person is zero rather than "not played": the track keeps arriving and
 * keeps being decoded, so unmuting is instant and their speaking ring still
 * moves - which is the difference between silencing somebody and pretending
 * they left.
 *
 * ponytail: 1 is the ceiling, because that is `HTMLMediaElement.volume`'s
 * ceiling. Boosting a quiet talker past their original level needs a WebAudio
 * gain node in the path, which is a bigger change than this is worth until
 * somebody actually asks for it.
 */
export function elementVolume(setting: PeerAudio | undefined): number {
  if (!setting) return DEFAULT_PEER_AUDIO.volume;
  if (setting.muted) return 0;
  // A clamp alone lets NaN through, and `element.volume = NaN` throws rather
  // than being ignored - which would take the whole sink down over a stored
  // value nobody can see.
  if (!Number.isFinite(setting.volume)) return 0;
  return Math.min(1, Math.max(0, setting.volume));
}

/** A setting that says nothing is not stored: the map holds the exceptions. */
export function isDefault(setting: PeerAudio): boolean {
  return setting.muted === DEFAULT_PEER_AUDIO.muted && setting.volume === DEFAULT_PEER_AUDIO.volume;
}

function load(): Record<string, PeerAudio> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, PeerAudio>) : {};
  } catch {
    return {};
  }
}

interface PeerAudioState {
  /** userId -> setting. Only people who are not at the default appear here. */
  people: Record<string, PeerAudio>;
  settingFor: (userId: string) => PeerAudio;
  setVolume: (userId: string, volume: number) => void;
  toggleMuted: (userId: string) => void;
  /** Puts one person back to normal, which is what removing them from the map is. */
  reset: (userId: string) => void;
}

export const usePeerAudio = create<PeerAudioState>((set, get) => ({
  people: load(),

  settingFor: (userId) => get().people[userId] ?? DEFAULT_PEER_AUDIO,

  setVolume: (userId, volume) => write(set, get, userId, { volume }),

  toggleMuted: (userId) => write(set, get, userId, { muted: !get().settingFor(userId).muted }),

  reset: (userId) => write(set, get, userId, DEFAULT_PEER_AUDIO),
}));

type Setter = (partial: Partial<PeerAudioState>) => void;

function write(
  set: Setter,
  get: () => PeerAudioState,
  userId: string,
  patch: Partial<PeerAudio>,
): void {
  const next = { ...get().settingFor(userId), ...patch };
  const people = { ...get().people };
  if (isDefault(next)) delete people[userId];
  else people[userId] = next;

  set({ people });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(people));
  } catch {
    // No storage: the setting still holds for this session.
  }
}
