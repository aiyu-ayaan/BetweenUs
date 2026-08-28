/**
 * "There is a newer BetweenUs than this one."
 *
 * One store for both clients, because the question is the same and only the
 * answer differs:
 *
 * - **Desktop.** A real update: ask GitHub, download the build this copy can
 *   actually apply, and hand the machine over to it. All of that is in the main
 *   process - see electron/updates.ts - and this drives it over the bridge.
 * - **Web.** A tab cannot install anything, so the whole update is a reload;
 *   what it watches for is the deployment changing under it. See
 *   services/web-update.ts.
 *
 * Which one is in play is not a build flag, it is whether the preload bridge is
 * there, exactly as everything else platform-specific in this app decides it.
 */
import { create } from 'zustand';
import { isDesktopRuntime } from '../services/platform';
import { watchForNewBuild } from '../services/web-update';

/** Where an update has got to. */
export type UpdateStage =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'failed';

const DISMISSED_KEY = 'betweenus.updateDismissed';

/**
 * Dismissal is per version, so the next release is news again. A snooze in
 * days would be the other option; this is the same idea with nothing to keep
 * wound up, and the offer is one line at the top of the window rather than
 * something in the way.
 */
function dismissedVersion(): string {
  try {
    return localStorage.getItem(DISMISSED_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberDismissal(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // A profile with no storage is asked again next launch. Not worth failing.
  }
}

interface UpdateState {
  /** Absent until the first check has said what this client can do. */
  info: DesktopUpdateInfo | null;
  stage: UpdateStage;
  offer: DesktopUpdateOffer | null;
  /** 0..1 while downloading, or -1 when the total size is unknown. */
  progress: number;
  error: string | null;
  /** Web only: the deployment has changed and this tab is behind it. */
  reloadReady: boolean;
  /** The version last waved away, so the next release is news again. */
  dismissed: string;
  /** True when there is something to say and it has not been waved away. */
  showing: () => boolean;

  /** Starts whichever watch this runtime has. Called once, from App. */
  start: () => () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  setChannel: (channel: DesktopUpdateChannel) => Promise<void>;
  dismiss: () => void;
}

/** How often the desktop app asks GitHub. Its rate limit is 60 an hour. */
const DESKTOP_POLL_MS = 6 * 60 * 60 * 1000;

export const useUpdateStore = create<UpdateState>((set, get) => ({
  info: null,
  stage: 'idle',
  offer: null,
  progress: 0,
  error: null,
  reloadReady: false,
  dismissed: dismissedVersion(),

  showing: () => {
    const { stage, offer, reloadReady, dismissed } = get();
    if (reloadReady) return true;
    if (stage === 'idle' || stage === 'checking' || stage === 'failed') return false;
    return offer !== null && offer.version !== dismissed;
  },

  start: () => {
    if (!isDesktopRuntime()) {
      return watchForNewBuild(() => set({ reloadReady: true }));
    }

    const bridge = window.betweenus;
    const stopProgress = bridge?.onUpdateProgress?.((progress) => set({ progress })) ?? (() => {});

    void bridge?.updateInfo?.().then((info) => {
      set({ info });
      // A build downloaded before the last quit is still waiting to be applied.
      if (info.downloaded) {
        set({ stage: 'ready' });
      }
    });

    // On launch and then rarely. A desktop release is not an hourly event, and
    // the check is also a button in settings for anybody who wants it sooner.
    void get().check();
    const timer = setInterval(() => void get().check(), DESKTOP_POLL_MS);

    return () => {
      clearInterval(timer);
      stopProgress();
    };
  },

  check: async () => {
    const bridge = window.betweenus;
    if (!bridge?.updateCheck) return;
    // A download in flight must not be replaced under itself by a poll.
    if (get().stage === 'downloading' || get().stage === 'installing') return;

    set({ stage: 'checking', error: null });
    try {
      const offer = await bridge.updateCheck();
      const info = (await bridge.updateInfo?.()) ?? get().info;
      const stage = offer
        ? info?.downloaded?.version === offer.version
          ? 'ready'
          : 'available'
        : 'idle';
      set({ info, offer, stage });
      // The "auto" in auto update. Waiting for a click before starting a
      // ninety-megabyte download meant the button that mattered - Restart and
      // install - was ten minutes away from every person who pressed the first
      // one. Nothing is ever installed without being asked: the download is
      // the slow half, and it is the half that can happen quietly.
      if (stage === 'available') await get().download();
    } catch (error) {
      set({ stage: 'failed', error: (error as Error).message });
    }
  },

  download: async () => {
    const { offer } = get();
    const bridge = window.betweenus;
    if (!offer || !bridge?.updateDownload) return;

    set({ stage: 'downloading', progress: 0, error: null });
    try {
      await bridge.updateDownload(offer);
      set({ stage: 'ready', progress: 1, info: (await bridge.updateInfo?.()) ?? get().info });
    } catch (error) {
      set({ stage: 'failed', error: (error as Error).message });
    }
  },

  install: async () => {
    const bridge = window.betweenus;
    if (!bridge?.updateInstall) return;

    set({ stage: 'installing', error: null });
    // On success the app is quitting, so there is nothing after this to set.
    const result = await bridge.updateInstall();
    if (!result.started) {
      set({ stage: 'ready', error: result.reason ?? 'The update could not be started.' });
    }
  },

  setChannel: async (channel) => {
    const settings = await window.betweenus?.setAppSettings?.({ updateChannel: channel });
    const info = get().info;
    // Said here rather than waited for: the settings screen draws the chosen
    // channel from `info`, and `info` was only refreshed by the check below -
    // so a check that failed, or was merely slow, left the button looking as
    // though the channel had not changed at all.
    set({
      offer: null,
      stage: 'idle',
      // The offer in hand was picked on the old channel and may not be on the
      // new one, so it is thrown away rather than left looking current.
      info: info ? { ...info, channel: settings?.updateChannel ?? channel } : info,
    });
    await get().check();
  },

  dismiss: () => {
    const { offer, reloadReady } = get();
    if (reloadReady) {
      set({ reloadReady: false });
      return;
    }
    if (!offer) return;
    rememberDismissal(offer.version);
    // The stage is kept: settings still shows what is waiting, it is only the
    // banner that goes away.
    set({ dismissed: offer.version });
  },
}));
