import { useEffect, useState } from 'react';
import {
  ABOUT_MAX_LENGTH,
  COVER_ASPECT,
  COVER_MAX_WIDTH,
  DEFAULT_ABOUT,
  LAST_SEEN_VISIBILITIES,
  type LastSeenVisibility,
} from '@betweenus/shared-types';
import type { ActiveStatus, DeviceKey, StatusPrivacy } from '@betweenus/shared-types';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { echoAdvice, echoCancellerFailing } from '../../services/call-stats';
import { useAudioSettings } from '../../stores/audioSettings';
import { monitorMic, type MicLevel } from '../../services/mic-gate';
import { describeKey } from '../../services/talk-key';
import { playCallTone } from '../../services/call-tones';
import { CallUsageSection } from './CallUsage';
import { DeviceSelect, useDevices } from '../../components/DeviceSelect';
import { DEFAULT_VOICE_SETTINGS, GATE_RANGE } from '../../services/voice-quality';
import { BITRATE_RANGE, FRAME_RATES, type CodecChoice } from '../../services/share-quality';

/** Where the manual bitrate starts when it is switched on: a fast LAN's worth. */
const DEFAULT_MANUAL_BITRATE = 25_000_000;
import { api } from '../../services/api';
import {
  notificationPreferences,
  onPreferencesChanged,
  updateNotificationPreferences,
} from '../../services/notifications';
import { serverUrl } from '../../services/endpoint';
import {
  backupIdentity,
  deviceId,
  passwordRecoveryEnabled,
  rewrapBackupForPassword,
  setPasswordRecovery,
} from '../../services/e2ee';
import { useIdentityStore } from '../../stores/identity';
import { useFriendsStore } from '../../stores/friends';
import { useAgentStore } from '../../services/remote-agent';
import { isDesktopRuntime } from '../../services/platform';
import { startWebPush } from '../../services/web-push';
import { ServerPicker } from '../auth/ServerPicker';
import { Avatar } from '../../components/Avatar';
import { PicturePicker } from '../../components/PicturePicker';
import { ProfileCover } from '../../components/ProfileCover';
import { DisappearingPicker } from '../../components/DisappearingPicker';
import { pruneExpired } from '../../stores/chat';
import {
  BellIcon,
  BetweenUsLogoIcon,
  BlockIcon,
  CheckIcon,
  ClockIcon,
  ChevronLeftIcon,
  DownloadIcon,
  LogOutIcon,
  MicIcon,
  MonitorIcon,
  PaletteIcon,
  PhoneIcon,
  ShieldIcon,
  SparklesIcon,
  UserIcon,
  XIcon,
} from '../../components/icons';
import { useUpdateStore } from '../../stores/updates';
import { ReleaseNotes } from '../../components/ReleaseNotes';
import { DENSITIES, DENSITY_LABELS } from '../../services/density';
import { LOCALES } from '../../services/i18n';
import {
  useThemeStore,
  THEMES,
  ACCENT_PRESETS,
} from '../../stores/theme';
import { useFocusTrap } from '../../services/focus-trap';

const isMac = typeof window !== 'undefined' && window.betweenus?.platform === 'darwin';

type Section =
  | 'account'
  | 'privacy'
  | 'encryption'
  | 'voice'
  | 'calls'
  | 'notifications'
  | 'remote'
  | 'appearance'
  | 'updates'
  | 'deployment';

interface SectionEntry {
  id: Section;
  label: string;
  /** The line under the label, so a list of eleven names is still readable. */
  hint: string;
  icon: typeof UserIcon;
}

/**
 * The settings, in named groups.
 *
 * Android has grouped its settings since it was written - Account, Preferences,
 * This Device, Deployment, Session - and the desktop had one flat list of eight
 * where the phone had five headings. Eleven flat entries is a list somebody
 * reads top to bottom every time because nothing tells them which third of it
 * their answer is in; the same eleven under four headings is four things to
 * skim. So this is the phone's grouping, entry for entry, on the two clients
 * that did not have it.
 *
 * It is also why this list grew: "My Account" was one page carrying the
 * profile, the password, the encryption key **and** which deployment the app
 * talks to. Those last two are not account fields - one is this installation's
 * key material and the other is which server exists at all - and they are the
 * two rows Android has always had somewhere else.
 *
 * Remote Access is about *this machine* offering itself, which a browser tab
 * cannot do - so the web client has no such entry. See services/platform.ts.
 */
const SECTION_GROUPS: Array<{ label: string; entries: SectionEntry[] }> = [
  {
    label: 'Account',
    entries: [
      {
        id: 'account',
        label: 'My Account',
        hint: 'Name, pictures, status and password',
        icon: UserIcon,
      },
      {
        id: 'privacy',
        label: 'Privacy & Safety',
        hint: 'Blocked people, and clearing your own messages',
        icon: BlockIcon,
      },
      {
        id: 'encryption',
        label: 'Encryption',
        hint: 'Your key, its backup and the machines holding one',
        icon: ShieldIcon,
      },
    ],
  },
  {
    label: 'Preferences',
    entries: [
      {
        id: 'appearance',
        label: 'Themes & Appearance',
        hint: 'Theme, accent, density and language',
        icon: PaletteIcon,
      },
      {
        id: 'voice',
        label: 'Voice & Video',
        hint: 'Devices, noise gate, push to talk, share quality',
        icon: MicIcon,
      },
      {
        id: 'notifications',
        label: 'Notifications',
        hint: 'Alerts, mentions, direct messages, quiet hours',
        icon: BellIcon,
      },
    ],
  },
  {
    label: 'This Device',
    entries: [
      ...(isDesktopRuntime()
        ? [
            {
              id: 'remote' as const,
              label: 'Remote Access',
              hint: 'Offering this machine, and who may reach it',
              icon: MonitorIcon,
            },
          ]
        : []),
      {
        id: 'calls',
        label: 'Calls & Data',
        hint: 'Every call this account has been in, and bandwidth',
        icon: PhoneIcon,
      },
      {
        id: 'updates',
        label: 'Updates',
        hint: 'Release channel, version checks, installer',
        icon: DownloadIcon,
      },
    ],
  },
  {
    label: 'Deployment',
    entries: [
      {
        id: 'deployment',
        label: 'Server',
        hint: 'The BetweenUs deployment this app talks to',
        icon: BetweenUsLogoIcon,
      },
    ],
  },
];

/** Flattened, for the mobile tab strip and for finding an entry by its id. */
const SECTIONS: SectionEntry[] = SECTION_GROUPS.flatMap((group) => group.entries);

/**
 * Settings take the whole window rather than a dialog, because they are a place
 * you go rather than a thing you glance at - and because a modal that covers a
 * chat you are still in invites you to keep half-reading it.
 */
export function UserSettings({ onClose }: { onClose: () => void }): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const [section, setSection] = useState<Section>('account');
  const logout = useAuthStore((state) => state.logout);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="User settings"
      className="fixed inset-0 z-50 flex flex-col animate-fade bg-ground"
    >
      {/* Mobile sticky top bar */}
      <div className="md:hidden flex h-12 shrink-0 items-center justify-between border-b border-edge bg-surface-850 px-3 z-10">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to chat"
          className="flex min-h-[40px] items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/[0.07] hover:text-white"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          <span>Back</span>
        </button>
        <span className="font-semibold text-sm text-slate-100">User Settings</span>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Log out"
          className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md p-1.5 text-slate-400 hover:bg-danger hover:text-white transition-colors duration-150"
        >
          <LogOutIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Mobile horizontal section tabs */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-edge bg-surface-800 px-3 py-2 shrink-0"
      >
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            onClick={() => setSection(entry.id)}
            aria-selected={section === entry.id}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-200 min-h-[36px] ${
              section === entry.id
                ? 'bg-accent text-white'
                : 'bg-surface-700/60 text-slate-300 hover:bg-white/[0.06]'
            }`}
          >
            <entry.icon className="h-3.5 w-3.5 shrink-0" />
            <span>{entry.label}</span>
          </button>
        ))}
      </div>

      {/* Desktop Top Bar / Window Controls Header */}
      <header className="drag-region hidden md:flex h-10 shrink-0 items-center justify-between px-2.5">
        <div className={`flex items-center gap-1.5 ${isMac ? 'ps-[72px]' : 'ps-1'}`}>
          <BetweenUsLogoIcon className="h-[18px] w-[18px] shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate text-[13px] font-semibold tracking-tight text-slate-300">
            BetweenUs
          </span>
          <span className="text-slate-600 text-xs">/</span>
          <span className="text-[13px] font-medium text-slate-400">User Settings</span>
        </div>
        <div className={`hidden shrink-0 md:block ${isMac ? 'w-36' : 'w-[146px]'}`} />
      </header>

      {/* Main Settings Panels */}
      <div className="flex min-h-0 flex-1 gap-0 md:gap-1.5 p-0 md:px-1.5 md:pb-1.5">
        <nav
          aria-label="Settings sections"
          className="panel hidden md:flex w-[232px] shrink-0 flex-col items-end overflow-y-auto bg-surface-800 py-8 pe-2"
        >
        <div className="w-[192px]">
          {SECTION_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2.5 pb-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                {group.label}
              </p>
              {group.entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSection(entry.id)}
                  aria-current={section === entry.id ? 'page' : undefined}
                  className={`mt-0.5 flex w-full cursor-pointer items-start gap-2 rounded px-2.5 py-1.5 text-start transition-colors duration-200 ${
                    section === entry.id ? 'row-active' : 'text-slate-300 hover:bg-white/[0.05]'
                  }`}
                >
                  <entry.icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[15px] leading-tight">{entry.label}</span>
                    {/* The line Android's rows have had all along. Eleven
                        two-word labels are eleven guesses about what is behind
                        each; the second line is what stops somebody opening
                        three of them looking for one setting. */}
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                      {entry.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}

          {/* Signing out is its own group on Android and its own footer here,
              for the same reason: it is the one row that ends the session
              rather than changing a setting. */}
          <hr className="my-2 border-surface-700" />

          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-start text-[15px] text-slate-300 transition-colors duration-200 hover:bg-danger hover:text-white"
          >
            Log out
            <LogOutIcon className="h-4 w-4" />
          </button>
        </div>
      </nav>

      <div className="panel relative flex-1 overflow-y-auto bg-surface-900 px-4 py-6 md:px-10 md:py-10 rounded-none md:rounded-panel border-0 md:border border-edge">
        <div className="max-w-[660px]">
          {section === 'account' && <AccountSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'encryption' && <EncryptionSection />}
          {section === 'voice' && <VoiceSection />}
          {section === 'calls' && <CallUsageSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'remote' && <RemoteSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'updates' && <UpdatesSection />}
          {section === 'deployment' && <DeploymentSection />}
        </div>

        {/* Desktop Close ESC button */}
        <div className="fixed top-14 end-8 md:end-10 z-50 hidden md:block no-drag">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings (Escape)"
            title="Close settings (ESC)"
            className="group flex flex-col items-center gap-1 cursor-pointer select-none focus:outline-none"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-500 text-slate-400 transition-all duration-150 group-hover:border-slate-300 group-hover:bg-white/[0.08] group-hover:text-slate-100 active:scale-95">
              <XIcon className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-bold tracking-wider text-slate-500 transition-colors duration-150 group-hover:text-slate-300">
              ESC
            </span>
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}

/**
 * The two things somebody does about other people rather than about the app:
 * refusing one of them, and taking their own history off every screen.
 *
 * They share a page because they share a shape - both are one-sided, both are
 * about this account's view, and neither reaches across and changes what
 * anybody else sees.
 */
/**
 * The three audiences a moment can have, in the order they narrow.
 *
 * Named here rather than inline so the labels and the wire values sit together:
 * the value is what the server enforces and the label is what somebody reads,
 * and a privacy setting whose two halves drift is the worst kind of bug in this
 * screen.
 */
const MOMENT_AUDIENCES: Array<{ value: StatusPrivacy; label: string }> = [
  { value: 'friends', label: 'My friends' },
  { value: 'friends-except', label: 'My friends except…' },
  { value: 'only-share-with', label: 'Only share with…' },
];

function PrivacySection(): JSX.Element {
  const blocked = useFriendsStore((state) => state.blocked);
  const load = useFriendsStore((state) => state.load);
  const unblock = useFriendsStore((state) => state.unblock);

  const [clearing, setClearing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const [savingWindow, setSavingWindow] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);

  const friends = useFriendsStore((state) => state.friends);
  const [savingMoments, setSavingMoments] = useState(false);
  const [momentsError, setMomentsError] = useState<string | null>(null);

  /**
   * Changes who this account's moments are sealed for.
   *
   * Saved on every press rather than behind a Save button: a privacy setting
   * that waits for one is a setting people believe they have changed and have
   * not. Both halves go together because half of "only these three" saved is a
   * different audience from the one that was chosen.
   *
   * It applies from the next post onwards. A moment already posted was sealed
   * for the audience it had, and no setting can reach a key that is already on
   * somebody's device - the screen says so rather than implying otherwise.
   */
  const saveMoments = async (
    privacy: StatusPrivacy,
    list: string[],
  ): Promise<void> => {
    setSavingMoments(true);
    setMomentsError(null);
    try {
      await api.updateAccount({ statusPrivacy: privacy, statusPrivacyList: list });
      await refreshUser();
    } catch (caught) {
      setMomentsError(
        caught instanceof Error ? caught.message : 'Could not change who sees your moments.',
      );
    } finally {
      setSavingMoments(false);
    }
  };

  /**
   * Changes this account's own window.
   *
   * Applied here as well as saved, and both halves matter. The server leaves
   * what is now too old out of the next history page; this window is already
   * holding decrypted messages that no fetch will re-ask for, so without the
   * prune the setting appears to do nothing until something reloads.
   */
  const saveWindow = async (seconds: number | null): Promise<void> => {
    setSavingWindow(true);
    setWindowError(null);
    try {
      await api.updateAccount({ messageTtlSeconds: seconds });
      await refreshUser();
      pruneExpired();
    } catch (caught) {
      setWindowError(
        caught instanceof Error ? caught.message : 'Could not change your disappearing window.',
      );
    } finally {
      setSavingWindow(false);
    }
  };

  // The friends screen loads this too, but settings can be opened without ever
  // having been there.
  useEffect(() => {
    void load();
  }, [load]);

  const clearChats = async (): Promise<void> => {
    // Typed rather than clicked. It is not reversible from inside the app, and
    // "are you sure" next to a button somebody already meant to press is not a
    // question, it is a speed bump.
    const typed = prompt(
      'This hides every message you can currently see, in every conversation, on ' +
        'every device you are signed in on.\n\n' +
        'Nobody else loses anything - the other side of each conversation still ' +
        'has their copy, and new messages still arrive.\n\n' +
        'Type CLEAR to confirm.',
    );
    if (typed?.trim().toUpperCase() !== 'CLEAR') return;

    setClearing(true);
    setError(null);
    setNote(null);
    try {
      await api.clearChats();
      // The server publishes the cut to this account's sockets, and the chat
      // store drops the caches when it lands - including this window's. There
      // is nothing to do here but say so.
      setNote('Cleared. Your other devices are catching up.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not clear your messages.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Privacy &amp; Safety</h1>
      <p className="mt-2 text-sm text-slate-400">
        Who can reach you, and what stays on your screens.
      </p>

      <section className="mt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          <BlockIcon className="h-4 w-4" />
          Blocked people
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          A blocked person cannot message you or send you a request, and your conversation
          disappears for both of you. Nothing is deleted - unblocking brings it back.
        </p>

        {blocked.length === 0 ? (
          <p className="mt-4 rounded-lg border border-edge bg-surface-950 px-4 py-6 text-center text-sm text-slate-500">
            You have not blocked anyone.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-surface-700/60 rounded-lg border border-edge bg-surface-950">
            {blocked.map((entry) => (
              <li key={entry.user.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar
                  name={entry.user.displayName}
                  avatarUrl={entry.user.avatarUrl}
                  ringColour="border-surface-950"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-100">{entry.user.displayName}</p>
                  <p className="truncate text-xs text-slate-500">
                    @{entry.user.username} · blocked{' '}
                    {new Date(entry.blockedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void unblock(entry.user.id)}
                  className="shrink-0 cursor-pointer rounded-md border border-edge px-3 py-1.5 text-xs text-slate-300 transition-colors duration-200 hover:border-accent hover:text-slate-100"
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 border-t border-edge pt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          <SparklesIcon className="h-4 w-4" />
          Moments
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          Who a moment is shared with when you post it. Your friend list is the widest this can
          be - a moment is never shown to anybody else, whichever of these is chosen.
        </p>
        <p className="mt-1.5 text-sm text-slate-500">
          It applies to what you post from now on. A moment already up was sealed for the people
          it had then, and nothing here can reach a key that is already on somebody&apos;s device.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {MOMENT_AUDIENCES.map((choice) => {
            const chosen = (user?.statusPrivacy ?? 'friends') === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                disabled={savingMoments}
                aria-pressed={chosen}
                onClick={() => void saveMoments(choice.value, user?.statusPrivacyList ?? [])}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors duration-200 disabled:cursor-default ${
                  chosen
                    ? 'border-accent bg-accent/10 text-slate-100'
                    : 'border-edge text-slate-300 hover:border-accent hover:text-slate-100'
                }`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>

        {/* The list only exists for the two choices that name people, and it
            is the same list either way - what changes is what being on it
            means, which is what the line above it says. */}
        {user && user.statusPrivacy !== 'friends' && (
          <div className="mt-4">
            <p className="text-sm text-slate-400">
              {user.statusPrivacy === 'friends-except'
                ? 'Everybody except the people you tick.'
                : 'Only the people you tick.'}
            </p>
            {friends.length === 0 ? (
              <p className="mt-3 rounded-lg border border-edge bg-surface-950 px-4 py-6 text-center text-sm text-slate-500">
                You have no friends to choose from yet.
              </p>
            ) : (
              <ul className="mt-3 max-h-64 divide-y divide-surface-700/60 overflow-y-auto rounded-lg border border-edge bg-surface-950">
                {friends
                  .filter((friend) => friend.status === 'ACCEPTED')
                  .map((friend) => {
                    const named = (user.statusPrivacyList ?? []).includes(friend.user.id);
                    return (
                      <li key={friend.user.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={named}
                            disabled={savingMoments}
                            onChange={() =>
                              void saveMoments(
                                user.statusPrivacy,
                                named
                                  ? (user.statusPrivacyList ?? []).filter(
                                      (id) => id !== friend.user.id,
                                    )
                                  : [...(user.statusPrivacyList ?? []), friend.user.id],
                              )
                            }
                            className="h-4 w-4 shrink-0 accent-accent"
                          />
                          <Avatar
                            name={friend.user.displayName}
                            avatarUrl={friend.user.avatarUrl}
                            size="sm"
                            ringColour="border-surface-950"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
                            {friend.user.displayName}
                          </span>
                          <span className="shrink-0 truncate text-xs text-slate-500">
                            @{friend.user.username}
                          </span>
                        </label>
                      </li>
                    );
                  })}
              </ul>
            )}
            {user.statusPrivacy === 'only-share-with' &&
              (user.statusPrivacyList ?? []).length === 0 && (
                <p className="mt-3 text-sm text-amber-200">
                  Nobody is ticked, so nobody but you will see what you post.
                </p>
              )}
          </div>
        )}

        {momentsError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {momentsError}
          </p>
        )}
      </section>

      <section className="mt-8 border-t border-edge pt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          <ClockIcon className="h-4 w-4" />
          Disappearing messages
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          Stop showing you messages older than this, in every conversation, on every device you
          are signed in on. It is the same shape as clearing your messages below - one-sided, and
          about your own screens - except that the line keeps moving instead of being drawn once.
        </p>
        <p className="mt-1.5 text-sm text-slate-500">
          Nobody else loses anything. A server can also set a window of its own, and that one does
          delete for everybody - where the two disagree, whichever is shorter is what you see.
        </p>

        <DisappearingPicker
          value={user?.messageTtlSeconds ?? null}
          disabled={savingWindow}
          onChange={(seconds) => void saveWindow(seconds)}
        />

        {windowError && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {windowError}
          </p>
        )}
      </section>

      <section className="mt-8 border-t border-edge pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Clear my messages
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          Hides everything you can currently see, in every conversation, on every device you are
          signed in on. The people you were talking to keep their own copies - a conversation has
          two ends, and this button only reaches one of them.
        </p>

        <button
          type="button"
          disabled={clearing}
          onClick={() => void clearChats()}
          className="mt-4 cursor-pointer rounded-md border border-danger/40 px-4 py-2 text-sm text-danger transition-colors duration-200 hover:border-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {clearing ? 'Clearing…' : 'Clear all my messages'}
        </button>

        {note && (
          <p role="status" className="mt-3 text-sm text-status-online">
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </section>
    </>
  );
}

const LAST_SEEN_LABELS: Record<LastSeenVisibility, string> = {
  everyone: 'Everyone',
  friends: 'My friends',
  nobody: 'Nobody',
};

/**
 * What each choice actually means, said before it is made.
 *
 * Especially the third. Reciprocity is the rule that keeps this setting from
 * being a one-way mirror, and a rule somebody only discovers by losing
 * something is a rule they experience as a bug.
 */
const LAST_SEEN_NOTES: Record<LastSeenVisibility, string> = {
  everyone: 'Anyone who shares a server or a friendship with you.',
  friends: 'Only people you have accepted as friends.',
  nobody: 'Nobody sees when you were last here - and you will not see anyone else’s either.',
};

/**
 * Who may see when you were last here.
 *
 * Saved on the press rather than behind the Profile section's Save button: it
 * is a switch, not a field being edited, and a privacy switch that needs a
 * second press to take effect is one people believe they have set when they
 * have not.
 */
function LastSeenPrivacy(): JSX.Element {
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const chosen = user?.lastSeenVisibility ?? 'everyone';
  const [saving, setSaving] = useState<LastSeenVisibility | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const choose = async (lastSeenVisibility: LastSeenVisibility): Promise<void> => {
    if (lastSeenVisibility === chosen) return;
    setSaving(lastSeenVisibility);
    setNote(null);
    try {
      await api.updateAccount({ lastSeenVisibility });
      await refreshUser();
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That could not be saved');
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <p className="mt-1 text-sm text-slate-400">{LAST_SEEN_NOTES[chosen]}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {LAST_SEEN_VISIBILITIES.map((option) => (
          <button
            key={option}
            type="button"
            disabled={saving !== null}
            onClick={() => void choose(option)}
            aria-pressed={chosen === option}
            className={`cursor-pointer rounded px-4 py-2 text-sm transition-colors duration-200 disabled:opacity-60 ${
              chosen === option
                ? 'bg-accent text-white'
                : 'bg-surface-800 text-slate-200 hover:bg-white/[0.06]'
            }`}
          >
            {LAST_SEEN_LABELS[option]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        This is not the same as Invisible. Invisible hides that you are here now; this decides who
        may read when you were last here at all.
      </p>
      {note && <p className="mt-2 text-sm text-slate-300">{note}</p>}
    </>
  );
}

/**
 * The about line, with the count that only appears once it matters.
 *
 * Its own field rather than another `TextField` because this is the one that
 * has a ceiling, and a limit somebody only discovers by having their sentence
 * cut off is a limit that should have been on screen. It shows up in the last
 * quarter, which is where somebody is deciding what to leave out.
 *
 * Cut by code point rather than by `String.length`, so an emoji is one
 * character to the person typing it. That also keeps the client's count under
 * the server's ceiling in the one direction that matters: the DTO measures
 * UTF-16 units, which is never fewer.
 */
function AboutField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const used = [...value].length;
  const left = ABOUT_MAX_LENGTH - used;

  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
        <span>About</span>
        {left <= ABOUT_MAX_LENGTH / 4 && (
          <span className={left < 0 ? 'text-danger' : 'text-slate-500'}>{left}</span>
        )}
      </span>
      <textarea
        rows={2}
        value={value}
        placeholder={DEFAULT_ABOUT}
        onChange={(event) => onChange([...event.target.value].slice(0, ABOUT_MAX_LENGTH).join(''))}
        className="w-full resize-none rounded bg-surface-900 px-3 py-2 text-sm text-slate-100 outline-none ring-1 ring-edge transition-shadow duration-200 focus:ring-2 focus:ring-accent"
      />
      <span className="mt-1 block text-xs text-slate-500">
        Shown on your profile card to anyone who can see your name.
      </span>
    </label>
  );
}

function AccountSection(): JSX.Element {
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const selfStatus = usePresenceStore((state) => state.selfStatus);
  const setStatus = usePresenceStore((state) => state.setStatus);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [about, setAbout] = useState(user?.about ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNote, setProfileNote] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordNote, setPasswordNote] = useState<string | null>(null);

  const saveProfile = async (): Promise<void> => {
    setSavingProfile(true);
    setProfileNote(null);
    try {
      await api.updateAccount({
        displayName: displayName.trim(),
        username: username.trim(),
        about: about.trim(),
      });
      await refreshUser();
      setProfileNote('Saved.');
    } catch (error) {
      setProfileNote(error instanceof Error ? error.message : 'That could not be saved');
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (): Promise<void> => {
    setPasswordNote(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      // The identity backup is sealed with the old password; leave it that way
      // and the next machine this account signs in on cannot open it.
      await rewrapBackupForPassword(newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordNote('Password changed. Your other sessions were signed out.');
    } catch (error) {
      setPasswordNote(error instanceof Error ? error.message : 'The password was not changed');
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">My Account</h1>

      <div className="mt-5 overflow-hidden rounded-lg bg-surface-800">
        {/* The band that used to be a flat accent fill. It is the preview and
            the target at once - clicking it picks a picture - so there is no
            separate "here is your cover" thumbnail duplicating it below. */}
        <ProfileCover coverUrl={user?.coverUrl} className="h-[100px]" />
        <div className="flex items-end gap-4 px-4 pb-4">
          <div className="-mt-10 rounded-full border-[6px] border-surface-800">
            <Avatar
              name={user?.displayName ?? '?'}
              avatarUrl={user?.avatarUrl}
              status={selfStatus}
              size="lg"
              ringColour="border-surface-800"
            />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <p className="truncate text-xl font-bold text-slate-50">{user?.displayName}</p>
            <p className="truncate text-sm text-slate-400">@{user?.username}</p>
            {user?.about.trim() && (
              <p className="mt-1 line-clamp-2 break-words text-sm text-slate-300">{user.about}</p>
            )}
          </div>
        </div>

        <div className="space-y-4 border-t border-edge px-4 py-4">
          <PicturePicker
            label="avatar"
            onChange={async (avatarUrl) => {
              await api.updateAccount({ avatarUrl });
              await refreshUser();
            }}
            onClear={
              user?.avatarUrl
                ? async () => {
                    await api.updateAccount({ avatarUrl: null });
                    await refreshUser();
                  }
                : undefined
            }
          />
          <PicturePicker
            label="cover"
            aspect={COVER_ASPECT}
            maxWidth={COVER_MAX_WIDTH}
            hint={`Framed to ${COVER_ASPECT}:1 and scaled to ${COVER_MAX_WIDTH}px wide. Shown behind your name on your profile.`}
            onChange={async (coverUrl) => {
              await api.updateAccount({ coverUrl });
              await refreshUser();
            }}
            onClear={
              user?.coverUrl
                ? async () => {
                    await api.updateAccount({ coverUrl: null });
                    await refreshUser();
                  }
                : undefined
            }
          />
        </div>

        <dl className="space-y-4 bg-surface-850 px-4 py-4">
          <Field label="Email" value={user?.email ?? ''} />
          <Field label="Member since" value={formatDate(user?.createdAt)} />
        </dl>
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Status</h2>
      <p className="mt-1 text-sm text-slate-400">
        Invisible keeps everything working while showing you as offline to everyone else.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['online', 'idle', 'dnd', 'invisible'] as ActiveStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatus(status)}
            aria-pressed={selfStatus === status}
            className={`cursor-pointer rounded px-4 py-2 text-sm transition-colors duration-200 ${
              selfStatus === status
                ? 'bg-accent text-white'
                : 'bg-surface-800 text-slate-200 hover:bg-white/[0.06]'
            }`}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Last seen</h2>
      <LastSeenPrivacy />

      <h2 className="mt-8 text-base font-semibold text-slate-50">Profile</h2>
      <div className="mt-3 space-y-4">
        <TextField label="Display name" value={displayName} onChange={setDisplayName} />
        <TextField label="Username" value={username} onChange={setUsername} />
        <AboutField value={about} onChange={setAbout} />
        <button
          type="button"
          disabled={savingProfile}
          onClick={() => void saveProfile()}
          className="cursor-pointer rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-60"
        >
          {savingProfile ? 'Saving…' : 'Save changes'}
        </button>
        {profileNote && <p className="text-sm text-slate-300">{profileNote}</p>}
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Password</h2>
      <div className="mt-3 space-y-4">
        <TextField
          label="Current password"
          value={currentPassword}
          onChange={setCurrentPassword}
          type="password"
        />
        <TextField
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          type="password"
        />
        <button
          type="button"
          disabled={currentPassword.length === 0 || newPassword.length === 0}
          onClick={() => void savePassword()}
          className="cursor-pointer rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          Change password
        </button>
        {passwordNote && <p className="text-sm text-slate-300">{passwordNote}</p>}
      </div>

    </>
  );
}

/**
 * Which deployment this installation talks to.
 *
 * Its own page rather than the last heading on "My Account", because it is not
 * an account field: it decides which server the account *exists on*, and
 * changing it signs this one out. Sitting under a Save-changes form for a
 * display name made it look like one more editable detail of the same person.
 * Android has always had it under its own Deployment heading.
 */
function DeploymentSection(): JSX.Element {
  const [pickingServer, setPickingServer] = useState(false);

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Server</h1>
      <p className="mt-1 text-sm text-slate-400">
        The deployment this app talks to. Changing it signs you out of this one.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <code className="rounded bg-surface-800 px-3 py-2 text-sm text-slate-200">
          {serverUrl()}
        </code>
        <button
          type="button"
          onClick={() => setPickingServer(true)}
          className="cursor-pointer rounded bg-surface-800 px-5 py-2 text-sm font-medium text-slate-100 transition-colors duration-200 hover:bg-white/[0.06]"
        >
          Change server
        </button>
      </div>

      {pickingServer && <ServerPicker onClose={() => setPickingServer(false)} />}
    </>
  );
}

/**
 * The account's encryption key and whether it could survive this machine.
 *
 * Signing in with a password backs the key up on its own, so most people never
 * come here. A passphrase is for the accounts that cannot do that - a provider
 * sign-in has no password to derive from - and for anyone who would rather not
 * have one secret do both jobs.
 *
 * A page of its own rather than the tail of "My Account". It is not a field of
 * the account: it is this installation's key material and the list of every
 * machine trusted to hold some, and burying "revoke this laptop" under a
 * display name form is burying the one control here somebody arrives in a
 * hurry looking for. Android has kept it under Account & Security all along;
 * this is the desktop catching up, with the list promoted with it.
 */
function EncryptionSection(): JSX.Element {
  const identity = useIdentityStore((state) => state.identity);
  const [passphrase, setPassphrase] = useState('');
  const [keepPassword, setKeepPassword] = useState(true);
  const [byPassword, setByPassword] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void passwordRecoveryEnabled()
      .then(setByPassword)
      .catch(() => setByPassword(null));
  }, [identity]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setNote(null);
    try {
      await backupIdentity({ value: passphrase, kind: 'passphrase' });
      // Deliberately after the passphrase is stored, and only when asked: the
      // whole reason to turn the password path off is a server that sees the
      // password at sign-in, and dropping it before the replacement exists
      // would leave a window with no way back into the account at all.
      if (!keepPassword) await setPasswordRecovery(false);
      setPassphrase('');
      setByPassword(keepPassword);
      setNote(
        keepPassword
          ? 'Saved. Your password still restores this account on a new device; the passphrase is a second way in.'
          : 'Saved. Only this passphrase restores the account now - your password no longer will.',
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Encryption key</h1>
      <p className="mt-1 text-sm text-slate-400">
        Messages are encrypted with a key this account owns. A sealed copy lives on the server so
        the account works on any machine you sign in on - the server cannot open it.
      </p>
      <p className="mt-2 text-sm text-slate-300">
        {identity.status === 'ready' && identity.backedUp
          ? 'This machine holds the account key, and it is backed up. Signing in elsewhere restores it.'
          : identity.status === 'ready' && identity.provisional
            ? 'This machine could not open the account key, so it made one of its own and reads only what has arrived since. Sign out and back in with your account password to recover the account key and every conversation sealed for it.'
            : identity.status === 'ready'
              ? 'This machine has a key of its own, and no backup of it. Your other machines fill in older conversations as they open them. Set a recovery passphrase - or sign in once with your account password - to make this machine hold the account key instead.'
              : 'Waiting for the account key.'}
      </p>
      {byPassword !== null && (
        <p className="mt-1 text-sm text-slate-400">
          {byPassword
            ? 'Recovery by account password is on: signing in on a new device restores your messages with nothing else to type.'
            : 'Recovery by account password is off. A new device needs your recovery passphrase.'}
        </p>
      )}
      <div className="mt-3 space-y-4">
        <TextField
          label="Recovery passphrase"
          value={passphrase}
          onChange={setPassphrase}
          type="password"
        />
        <button
          type="button"
          disabled={saving || passphrase.length < 8 || identity.status !== 'ready'}
          onClick={() => void save()}
          className="cursor-pointer rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Set recovery passphrase'}
        </button>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={keepPassword}
            onChange={(event) => setKeepPassword(event.target.checked)}
            className="mt-0.5 cursor-pointer accent-accent"
          />
          <span>
            Also let my account password recover my messages
            <span className="block text-xs text-slate-500">
              Leave this on and a new device works the moment you sign in. Turn it off and only
              this passphrase gets you back - which is the point if you would rather the server,
              which sees your password when you sign in, could never open the backup.
            </span>
          </span>
        </label>
        <p className="text-xs text-slate-500">
          Nobody - including this deployment - can recover your history if you forget the
          passphrase and have turned password recovery off.
        </p>
        {note && <p className="text-sm text-slate-300">{note}</p>}
      </div>

      <DeviceList />
    </>
  );
}

/**
 * The machines this account has published a key from, and the button that stops
 * one being trusted.
 *
 * The list is the point of the per-device directory: an account key that was
 * copied everywhere could be revoked only by rotating it for every machine at
 * once, which nobody was ever going to do. One row per machine makes "that
 * laptop is not mine any more" a thing somebody can actually say.
 */
function DeviceList(): JSX.Element {
  const [devices, setDevices] = useState<DeviceKey[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mine = deviceId();

  useEffect(() => {
    void api
      .myDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  const revoke = async (device: DeviceKey): Promise<void> => {
    setBusy(device.deviceId);
    setNote(null);
    try {
      const updated = await api.revokeDevice(device.deviceId);
      setDevices((list) =>
        (list ?? []).map((item) => (item.deviceId === updated.deviceId ? updated : item)),
      );
      setNote(
        'Revoked. Nothing new will be encrypted for it, and every channel it was in gets a new key.',
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That could not be revoked');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2 className="mt-8 text-base font-semibold text-slate-50">Your machines</h2>
      <p className="mt-1 text-sm text-slate-400">
        Every machine you sign in on publishes a key of its own, and messages are encrypted for
        each of them separately. Revoking one stops it being encrypted for and re-keys the
        channels it could read. It cannot take back what that machine has already decrypted, and
        it is not a substitute for signing it out.
      </p>

      <ul className="mt-3 space-y-2">
        {devices === null && <li className="text-sm text-slate-500">Loading…</li>}
        {devices?.length === 0 && (
          <li className="text-sm text-slate-500">No keys published yet.</li>
        )}
        {devices?.map((device) => (
          <li
            key={device.deviceId}
            className="flex items-center gap-3 rounded-lg bg-surface-800 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-100">
                {device.label ?? 'Unnamed machine'}
                {device.deviceId === mine && (
                  <span className="ms-2 text-xs text-accent">this one</span>
                )}
              </p>
              <p className="truncate text-xs text-slate-500">
                {device.revokedAt
                  ? `Revoked ${formatDay(device.revokedAt)}`
                  : `Last seen ${formatDay(device.lastSeenAt)}`}
              </p>
            </div>
            {!device.revokedAt && device.deviceId !== mine && (
              <button
                type="button"
                disabled={busy === device.deviceId}
                onClick={() => void revoke(device)}
                className="cursor-pointer rounded px-3 py-1.5 text-xs font-medium text-danger transition-colors duration-150 hover:bg-danger hover:text-white disabled:opacity-50"
              >
                {busy === device.deviceId ? 'Revoking…' : 'Revoke'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-sm text-slate-300">{note}</p>}
    </>
  );
}

/** A date without a time: "last seen at 14:03" is precision nobody asked for. */
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function VoiceSection(): JSX.Element {
  const status = useVoiceStore((state) => state.status);
  const micEnabled = useVoiceStore((state) => state.micEnabled);
  const cameraEnabled = useVoiceStore((state) => state.cameraEnabled);
  const echoErleDb = useVoiceStore((state) => state.echoErleDb);
  const settings = useAudioSettings((state) => state.settings);
  const update = useAudioSettings((state) => state.update);

  const [devices, refreshDevices] = useDevices();
  const [level, setLevel] = useState<MicLevel>({ db: -100, open: false });
  const [testing, setTesting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!testing) return;
    let stop: (() => void) | null = null;
    let cancelled = false;

    void monitorMic(settings.inputDeviceId, settings.gateThresholdDb, setLevel)
      .then((release) => {
        if (cancelled) release();
        else {
          stop = release;
          // Labels only exist once the microphone has been granted, and this
          // is the grant.
          refreshDevices();
        }
      })
      .catch((error: unknown) => {
        setTesting(false);
        setProblem(error instanceof Error ? error.message : 'That microphone could not be opened');
      });

    return () => {
      cancelled = true;
      stop?.();
      setLevel({ db: -100, open: false });
    };
    // The monitor is reopened when the device changes; the threshold is read
    // when it opens and pushed into the running gate below.
  }, [testing, settings.inputDeviceId]);

  const hifi = settings.mode === 'hifi';
  // Only true while a call is running and the canceller has reported a number
  // that says it is not working. Off deliberately - which hi-fi mode does - is
  // not a fault, and a browser that reports nothing raises nothing.
  const echoFailing = echoCancellerFailing(settings.echoCancellation && !hifi, echoErleDb);

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Voice &amp; Video</h1>
      <p className="mt-2 text-sm text-slate-400">
        These are settings of this machine, not of your account - the microphone that suits this
        room is not the one that suits another. Changes apply to a call already running.
      </p>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Devices</h2>
      <div className="mt-3 space-y-4 rounded-lg bg-surface-800 p-4">
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
        <Switch
          label="Follow whatever is plugged in"
          hint="When a device chosen above is unplugged, fall back to the system default instead of opening something that is not there. Off keeps the two choices whatever happens."
          checked={settings.followSystemDevices}
          onChange={(followSystemDevices) => update({ followSystemDevices })}
        />
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Input sensitivity</h2>
      <p className="mt-1 text-sm text-slate-400">
        Below this, the microphone is closed - which is what keeps a fan, a keyboard or a room out
        of the call between sentences. Set it so the bar sits under the marker when you are quiet
        and well past it when you talk.
      </p>
      <div className="mt-3 space-y-3 rounded-lg bg-surface-800 p-4">
        <Switch
          label="Automatically close the microphone"
          hint="Off is an open mic: everything the microphone hears is sent."
          checked={settings.gateThresholdDb !== null}
          onChange={(on) => update({ gateThresholdDb: on ? DEFAULT_VOICE_SETTINGS.gateThresholdDb : null })}
        />
        <LevelMeter db={level.db} thresholdDb={settings.gateThresholdDb} live={testing} />
        {settings.gateThresholdDb !== null && (
          <input
            type="range"
            min={GATE_RANGE.minDb}
            max={GATE_RANGE.maxDb}
            step={1}
            value={settings.gateThresholdDb}
            onChange={(event) => update({ gateThresholdDb: Number(event.target.value) })}
            className="w-full cursor-pointer accent-accent"
          />
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setProblem(null);
              setTesting((on) => !on);
            }}
            className="cursor-pointer rounded bg-surface-950 px-4 py-2 text-sm font-medium text-slate-100 transition-colors duration-200 hover:bg-white/[0.06]"
          >
            {testing ? 'Stop test' : "Let's check"}
          </button>
          {problem && <span className="text-sm text-danger">{problem}</span>}
        </div>
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Push to talk</h2>
      <p className="mt-1 text-sm text-slate-400">
        The sensitivity above answers &quot;is somebody making a noise&quot;. This answers a
        different question - whether you mean to be heard - which no threshold gets to, because a
        shared room and a keyboard are both louder than a quiet voice.
      </p>
      <div className="mt-3 space-y-3 rounded-lg bg-surface-800 p-4">
        <Switch
          label="Talk only while a key is held"
          hint="Your microphone button still decides whether you are in the call at all: muted stays muted however long the key is down."
          checked={settings.pushToTalk}
          onChange={(pushToTalk) => update({ pushToTalk })}
        />
        {settings.pushToTalk && (
          <>
            <PushToTalkKey
              code={settings.pushToTalkKey}
              onChange={(pushToTalkKey) => update({ pushToTalkKey })}
            />
            <p className="text-xs text-slate-500">
              It works while BetweenUs has focus, and not while another window does - a global key
              needs a keyboard hook this app does not install. Letting go is never missed: losing
              focus closes the microphone too, so alt-tabbing mid-sentence cannot leave it open.
            </p>
          </>
        )}
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Screen share quality</h2>
      <p className="mt-1 text-sm text-slate-400">
        Everything about a share is inferred: the bitrate from the pixel count, the codec from
        which one has a hardware encoder, and the rest from congestion control. That is right on a
        link nobody can describe, and exactly wrong on the one link somebody can - a LAN has no
        congestion to infer from, so the estimator finds the ceiling slowly and by degrading
        first. This is where a LAN gets told it is a LAN. It covers a remote session too.
      </p>
      <div className="mt-3 space-y-3 rounded-lg bg-surface-800 p-4">
        <Switch
          label="Set the bitrate myself"
          hint="A ceiling, not a target - a still desktop spends a fraction of it either way."
          checked={settings.share.maxBitrate !== null}
          onChange={(on) =>
            update({
              share: { ...settings.share, maxBitrate: on ? DEFAULT_MANUAL_BITRATE : null },
            })
          }
        />
        {settings.share.maxBitrate !== null && (
          <label className="block">
            <span className="flex items-baseline justify-between text-xs text-slate-400">
              <span>Ceiling</span>
              <span className="text-slate-300">
                {Math.round(settings.share.maxBitrate / 1_000_000)} Mbps
              </span>
            </span>
            <input
              type="range"
              min={BITRATE_RANGE.min}
              max={BITRATE_RANGE.max}
              step={1_000_000}
              value={settings.share.maxBitrate}
              onChange={(event) =>
                update({
                  share: { ...settings.share, maxBitrate: Number(event.target.value) },
                })
              }
              className="mt-2 w-full accent-accent"
            />
          </label>
        )}

        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
            Frame rate
          </span>
          <select
            value={settings.share.frameRate ?? ''}
            onChange={(event) =>
              update({
                share: {
                  ...settings.share,
                  frameRate: event.target.value ? Number(event.target.value) : null,
                },
              })
            }
            className="mt-2 w-full cursor-pointer rounded-lg border border-edge bg-surface-950 px-3 py-2 text-slate-100 outline-none transition-colors focus:border-accent/60"
          >
            <option value="">Whatever the content wants (60)</option>
            {FRAME_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate} fps
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
            Video codec
          </span>
          <select
            value={settings.share.videoCodec}
            onChange={(event) =>
              update({
                share: { ...settings.share, videoCodec: event.target.value as CodecChoice },
              })
            }
            className="mt-2 w-full cursor-pointer rounded-lg border border-edge bg-surface-950 px-3 py-2 text-slate-100 outline-none transition-colors focus:border-accent/60"
          >
            <option value="auto">Automatic (H.264, hardware where there is one)</option>
            <option value="H264">H.264</option>
            <option value="VP9">VP9</option>
            <option value="VP8">VP8</option>
            <option value="AV1">AV1</option>
          </select>
          <span className="mt-1.5 block text-xs text-slate-500">
            A preference, not a promise: a machine with no encoder for the one you pick sends
            what it does have rather than failing the share. VP9 and AV1 look better per bit and
            are usually encoded in software, which costs the latency this is buying.
          </span>
        </label>
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Sounds</h2>
      <div className="mt-3 space-y-1 rounded-lg bg-surface-800 p-4">
        <Switch
          label="Play a tone when somebody joins or leaves the call"
          hint="Two notes, up for an arrival and down for a departure. A voice channel is the one screen nobody is looking at, so who is in it has to be audible."
          checked={settings.callTones}
          onChange={(callTones) => {
            update({ callTones });
            // The toggle is the demonstration: turning it on plays the sound it
            // is turning on, which is the only way to know what was chosen.
            if (callTones) playCallTone('join');
          }}
        />
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Processing</h2>
      <div className="mt-3 space-y-1 rounded-lg bg-surface-800 p-4">
        <Levels
          label="Noise suppression"
          hint="Standard is the ordinary suppressor and handles steady noise - a fan, a hum, an air conditioner. High additionally asks for voice isolation, a model that removes a keyboard, a dog or a flatmate; it costs noticeably more processor, so it is worth turning on for a noisy room rather than leaving on everywhere."
          value={settings.noiseSuppression}
          disabled={hifi}
          options={[
            ['off', 'Off'],
            ['standard', 'Standard'],
            ['high', 'High'],
          ]}
          onChange={(noiseSuppression) => update({ noiseSuppression })}
        />
        <Switch
          label="Echo cancellation"
          hint="Without it, anybody on speakers sends the call back into itself."
          checked={settings.echoCancellation}
          disabled={hifi}
          onChange={(echoCancellation) => update({ echoCancellation })}
        />
        {/* Measured rather than guessed. The canceller reports how much it is
            actually removing, and this is the only place that reading is worth
            anything: somebody is on this screen because they have been told
            they are echoing, and the cause is almost always the output device
            two settings above rather than anything in this section. */}
        {echoFailing && (
          <p
            role="status"
            className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
          >
            {echoAdvice(settings.outputDeviceId !== null)}
          </p>
        )}
        <Switch
          label="Automatic gain control"
          hint="Evens out a quiet or a loud voice. Turn it off if your microphone is already set up."
          checked={settings.autoGainControl}
          disabled={hifi}
          onChange={(autoGainControl) => update({ autoGainControl })}
        />
        <Switch
          label="High fidelity mode"
          hint="For an instrument or a record rather than a voice: stereo at twice the bitrate, with all of the above turned off, because every one of them is destructive to anything that is not speech."
          checked={hifi}
          onChange={(on) => update({ mode: on ? 'hifi' : 'clear' })}
        />
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">This call</h2>
      <dl className="mt-3 space-y-4 rounded-lg bg-surface-800 p-4">
        <Field label="Connection" value={status === 'connected' ? 'In a voice channel' : 'Not connected'} />
        <Field label="Microphone" value={micEnabled ? 'On' : 'Off'} />
        <Field label="Camera" value={cameraEnabled ? 'On' : 'Off'} />
        <Field
          label="Quality"
          value={hifi ? '128 kbps stereo, unprocessed' : '64 kbps mono, processed for speech'}
        />
        <Field
          label="Encryption"
          value="End-to-end, with the channel key. A call that cannot encrypt is aborted rather than downgraded."
        />
      </dl>
    </>
  );
}

/**
 * The bar is the microphone's level; the notch is the threshold. Amber while
 * the gate is closed and accent while it is open, so "am I being heard" is
 * answered by a colour rather than by arithmetic.
 */
/**
 * Records the next key pressed.
 *
 * A code rather than a key, so it is the same physical key whatever the layout
 * says it types - and so a key that types nothing, which is the sort you want
 * for this, is still recordable.
 */
function PushToTalkKey({
  code,
  onChange,
}: {
  code: string;
  onChange: (code: string) => void;
}): JSX.Element {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const capture = (event: KeyboardEvent): void => {
      event.preventDefault();
      // Escape leaves it as it was rather than binding Escape, which would be a
      // key nobody can unbind without pressing it.
      if (event.code !== 'Escape') onChange(event.code);
      setListening(false);
    };
    window.addEventListener('keydown', capture, { capture: true });
    return () => window.removeEventListener('keydown', capture, { capture: true });
  }, [listening, onChange]);

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-slate-300">Key</span>
      <button
        type="button"
        onClick={() => setListening((on) => !on)}
        className={`cursor-pointer rounded px-4 py-2 font-mono text-sm transition-colors duration-200 ${
          listening
            ? 'bg-accent text-white'
            : 'bg-surface-950 text-slate-100 hover:bg-white/[0.06]'
        }`}
      >
        {listening ? 'Press a key…' : describeKey(code)}
      </button>
      {listening && <span className="text-xs text-slate-500">Escape to keep the current one</span>}
    </div>
  );
}

function LevelMeter({
  db,
  thresholdDb,
  live,
}: {
  db: number;
  thresholdDb: number | null;
  live: boolean;
}): JSX.Element {
  const asPercent = (value: number): number =>
    Math.min(100, Math.max(0, ((value - GATE_RANGE.minDb) / (GATE_RANGE.maxDb - GATE_RANGE.minDb)) * 100));

  // Read from the level rather than from the monitor's own gate, so dragging
  // the slider recolours the bar immediately instead of after a reopened
  // microphone - the same decision, made a few milliseconds later.
  const open = thresholdDb === null || db >= thresholdDb;

  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-surface-950">
      <div
        className={`h-full transition-[width] duration-75 ${open ? 'bg-accent' : 'bg-status-idle/60'}`}
        style={{ width: `${live ? asPercent(db) : 0}%` }}
      />
      {thresholdDb !== null && (
        <div
          className="absolute inset-y-0 w-0.5 bg-slate-200"
          style={{ left: `${asPercent(thresholdDb)}%` }}
        />
      )}
    </div>
  );
}

/**
 * The browser's own permission, which is not the account's setting.
 *
 * A tab cannot raise anything the browser has not been asked about, and asking
 * has to come from something the person clicked: Firefox and Safari drop a
 * `requestPermission()` that no gesture led to, which is exactly what sign-in
 * is. So the prompt lives on a button, and the state is shown either way -
 * "notifications are on" with nothing arriving was the confusing half of this.
 */
function BrowserPermission(): JSX.Element | null {
  const [permission, setPermission] = useState<NotificationPermission | null>(() =>
    typeof Notification === 'undefined' ? null : Notification.permission,
  );

  if (permission === null) return null;

  const ask = (): void => {
    void Notification.requestPermission().then((next) => {
      setPermission(next);
      // The push subscription needs the same permission, and this is the first
      // moment it can have it. A no-op where the deployment has no VAPID keys.
      if (next === 'granted') void startWebPush();
    });
  };

  return (
    <>
      <h2 className="mt-8 text-base font-semibold text-slate-100">This browser</h2>
      <div className="mt-3 rounded-lg bg-surface-800 p-4">
        {permission === 'granted' && (
          <p className="text-sm text-slate-400">
            This browser is allowed to show notifications.
          </p>
        )}
        {permission === 'default' && (
          <>
            <p className="text-sm text-slate-400">
              This browser has not been asked yet, so nothing can be shown until it is.
            </p>
            <button
              type="button"
              onClick={ask}
              className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
            >
              Allow notifications
            </button>
          </>
        )}
        {permission === 'denied' && (
          <p className="text-sm text-slate-400">
            This browser is blocking notifications. Nothing here can undo that - it has to be
            turned back on from the padlock in the address bar.
          </p>
        )}
      </div>
    </>
  );
}

function NotificationsSection(): JSX.Element {
  const selfStatus = usePresenceStore((state) => state.selfStatus);
  const channels = useChatStore((state) => state.channels);
  const directs = useChatStore((state) => state.directs);
  const [preferences, setPreferences] = useState(notificationPreferences);
  const [machine, setMachine] = useState<{
    launchOnStartup: boolean;
    closeToTray: boolean;
    canManageAutoStart: boolean;
  } | null>(null);

  useEffect(() => onPreferencesChanged(setPreferences), []);
  useEffect(() => {
    void window.betweenus?.getAppSettings().then(setMachine);
  }, []);

  const save = (patch: Partial<typeof preferences>): void => {
    void updateNotificationPreferences(patch).catch(() => undefined);
  };

  const saveMachine = (patch: { launchOnStartup?: boolean; closeToTray?: boolean }): void => {
    void window.betweenus?.setAppSettings(patch).then((next) => {
      setMachine((current) => (current ? { ...current, ...next } : current));
    });
  };

  const channelName = (channelId: string): string =>
    [...channels, ...directs].find((channel) => channel.id === channelId)?.name ??
    'a channel you have left';

  const quietHoursOn =
    preferences.quietStartMinute !== null && preferences.quietEndMinute !== null;

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Notifications</h1>
      <p className="mt-2 text-sm text-slate-400">
        A desktop notification is raised for anything you cannot already see: a message in another
        channel, or in this one while the window is not focused. Mutes and quiet hours are stored
        on your account, so they hold on every machine you sign in from.
      </p>

      <div className="mt-5 space-y-1 rounded-lg bg-surface-800 p-4">
        <Switch
          label="Desktop notifications"
          hint="Off silences all of them, on every device."
          checked={preferences.enabled}
          onChange={(enabled) => save({ enabled })}
        />
        <Switch
          label="Quiet hours"
          hint="Nothing is raised between these times. The window may cross midnight."
          checked={quietHoursOn}
          onChange={(on) =>
            save(
              on
                ? { quietStartMinute: 22 * 60, quietEndMinute: 8 * 60 }
                : { quietStartMinute: null, quietEndMinute: null },
            )
          }
        />
        {quietHoursOn && (
          <div className="flex gap-4 pt-1">
            <TimeField
              label="From"
              minute={preferences.quietStartMinute ?? 0}
              onChange={(quietStartMinute) => save({ quietStartMinute })}
            />
            <TimeField
              label="Until"
              minute={preferences.quietEndMinute ?? 0}
              onChange={(quietEndMinute) => save({ quietEndMinute })}
            />
          </div>
        )}
      </div>

      {!isDesktopRuntime() && <BrowserPermission />}

      <h2 className="mt-8 text-base font-semibold text-slate-100">This computer</h2>
      <div className="mt-3 space-y-1 rounded-lg bg-surface-800 p-4">
        <Switch
          label="Open BetweenUs when the system starts"
          hint="Starts in the tray, without a window in front of what you were doing."
          checked={machine?.launchOnStartup ?? false}
          disabled={machine === null || !machine.canManageAutoStart}
          onChange={(launchOnStartup) => saveMachine({ launchOnStartup })}
        />
        <Switch
          label="Keep running in the tray when the window is closed"
          hint="Off makes closing the window quit BetweenUs, and notifications stop with it."
          checked={machine?.closeToTray ?? false}
          disabled={machine === null}
          onChange={(closeToTray) => saveMachine({ closeToTray })}
        />
        {machine !== null && !machine.canManageAutoStart && (
          <p className="pt-2 text-sm text-slate-500">
            A development window does not register itself to start with the system.
          </p>
        )}
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-100">Muted channels</h2>
      {preferences.mutedChannelIds.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          Nothing is muted. Mute a channel from the bell in its header.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-surface-700 rounded-lg bg-surface-800">
          {preferences.mutedChannelIds.map((channelId) => (
            <li key={channelId} className="flex items-center justify-between px-4 py-3">
              <span className="text-slate-100">#{channelName(channelId)}</span>
              <button
                type="button"
                onClick={() =>
                  save({
                    mutedChannelIds: preferences.mutedChannelIds.filter((id) => id !== channelId),
                  })
                }
                className="cursor-pointer rounded bg-white/[0.07] px-3 py-1.5 text-sm text-slate-100 transition-colors duration-200 hover:bg-white/[0.1]"
              >
                Unmute
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-base font-semibold text-slate-100">Mentions only</h2>
      {preferences.mentionOnlyChannelIds.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          No channel is set to mentions only. Click the bell in a channel header twice to put it
          here: it stays quiet unless somebody writes your name.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-surface-700 rounded-lg bg-surface-800">
          {preferences.mentionOnlyChannelIds.map((channelId) => (
            <li key={channelId} className="flex items-center justify-between px-4 py-3">
              <span className="text-slate-100">#{channelName(channelId)}</span>
              <button
                type="button"
                onClick={() =>
                  save({
                    mentionOnlyChannelIds: preferences.mentionOnlyChannelIds.filter(
                      (id) => id !== channelId,
                    ),
                  })
                }
                className="cursor-pointer rounded bg-white/[0.07] px-3 py-1.5 text-sm text-slate-100 transition-colors duration-200 hover:bg-white/[0.1]"
              >
                Notify for everything
              </button>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-8 space-y-4 rounded-lg bg-surface-800 p-4">
        <Field
          label="Do Not Disturb"
          value={
            selfStatus === 'dnd'
              ? 'On - notifications are suppressed while this is your status.'
              : 'Off - set your status to Do Not Disturb to silence notifications.'
          }
        />
      </dl>
    </>
  );
}

function Switch({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label
      className={`flex min-h-[44px] items-start justify-between gap-4 py-2.5 sm:py-2 ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-slate-100">{label}</span>
        {hint && <span className="mt-0.5 block text-sm text-slate-400">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 shrink-0 cursor-pointer accent-accent"
      />
    </label>
  );
}

/**
 * One setting with three or more named steps, as a radio group.
 *
 * A real `radiogroup` rather than styled buttons, because arrow-key movement
 * between the options and the "3 of 3 selected" a screen reader announces both
 * come free with the role and have to be rebuilt by hand without it. The
 * selected step is marked by more than colour - it carries a border and a
 * weight change - so it is still readable to somebody who cannot see the
 * accent.
 */
function Levels<T extends string>({
  label,
  hint,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: Array<[T, string]>;
  disabled?: boolean;
  onChange: (value: T) => void;
}): JSX.Element {
  return (
    <div className={`py-2.5 sm:py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="block text-slate-100" id={`levels-${label}`}>
        {label}
      </span>
      {hint && <span className="mt-0.5 block text-sm text-slate-400">{hint}</span>}
      <div
        role="radiogroup"
        aria-labelledby={`levels-${label}`}
        className="mt-2.5 inline-flex rounded-lg border border-edge bg-surface-950 p-0.5"
      >
        {options.map(([option, optionLabel]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={`min-h-[36px] rounded-md px-4 text-sm transition-colors duration-200 ${
              disabled ? '' : 'cursor-pointer'
            } ${
              value === option
                ? 'bg-accent/20 font-medium text-slate-50 ring-1 ring-accent/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A time of day, held as minutes from midnight on this machine's clock. */
function TimeField({
  label,
  minute,
  onChange,
}: {
  label: string;
  minute: number;
  onChange: (minute: number) => void;
}): JSX.Element {
  const value = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(
    minute % 60,
  ).padStart(2, '0')}`;

  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <input
        type="time"
        value={value}
        onChange={(event) => {
          // An empty input clears the value, which is not a time of day.
          const [hours = NaN, minutes = NaN] = event.target.value.split(':').map(Number);
          if (Number.isFinite(hours) && Number.isFinite(minutes)) onChange(hours * 60 + minutes);
        }}
        className="mt-2 rounded-lg border border-edge bg-surface-950 px-3 py-2 text-slate-100 outline-none transition-colors focus:border-accent/60"
      />
    </label>
  );
}

/**
 * This machine offering itself for remote access. Off by default and off is
 * off: no enrolment, no socket, nothing to reach.
 */
function RemoteSection(): JSX.Element {
  const enabled = useAgentStore((state) => state.enabled);
  const status = useAgentStore((state) => state.status);
  const error = useAgentStore((state) => state.error);
  const machineName = useAgentStore((state) => state.machineName);
  const machineId = useAgentStore((state) => state.machineId);
  const controlSupported = useAgentStore((state) => state.controlSupported);
  const session = useAgentStore((state) => state.session);
  const enable = useAgentStore((state) => state.enable);
  const [inputError, setInputError] = useState<string | null>(null);

  // Control failing silently was the worst part of the first version: the
  // session looked fine and the mouse simply did not move.
  useEffect(() => {
    void window.betweenus?.remoteInputDiagnostics().then((report) => setInputError(report.error));
  }, [session]);

  const disable = useAgentStore((state) => state.disable);
  const endSession = useAgentStore((state) => state.endSession);

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Remote Access</h1>
      <p className="mt-2 text-sm text-slate-400">
        Lets you - and anyone you give access to - see and use this machine from another device.
        Nothing listens for a connection: this machine dials out to the gateway, so no port is
        opened on it.
      </p>

      <div className="mt-5 space-y-1">
        <Switch
          label="Allow remote access to this machine"
          hint={
            enabled
              ? `Enrolled as "${machineName}" · ${statusLabel(status)}`
              : 'Off. Turning it on enrols this machine under your account.'
          }
          checked={enabled}
          onChange={(next) => void (next ? enable() : disable())}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {enabled && controlSupported && inputError && (
        <p role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          The input helper reported: {inputError}. A controller can watch this screen but not
          touch it until that is fixed.
        </p>
      )}

      {enabled && !controlSupported && (
        <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Mouse and keyboard control is Windows-only for now. On this machine a session can watch
          the screen but not touch it.
        </p>
      )}

      {session && (
        <div className="mt-5 rounded-lg bg-surface-800 p-4">
          <p className="text-sm text-slate-100">
            <span className="font-medium">{session.controllerName}</span> is connected to this
            machine.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {session.permissions.includes('REMOTE_CONTROL')
              ? 'They can use the mouse and keyboard.'
              : 'They can see the screen only.'}
          </p>
          <button
            type="button"
            onClick={endSession}
            className="mt-3 cursor-pointer rounded bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-red-500"
          >
            End the session
          </button>
        </div>
      )}

      {enabled && machineId && (
        <p className="mt-5 text-xs text-slate-500">
          Who may reach this machine is set in Remote machines → Access, not here: it belongs to
          the machine rather than to this window.
        </p>
      )}
    </>
  );
}

function statusLabel(status: 'off' | 'connecting' | 'online' | 'error'): string {
  switch (status) {
    case 'online':
      return 'reachable';
    case 'connecting':
      return 'connecting…';
    case 'error':
      return 'not reachable';
    default:
      return 'off';
  }
}

/**
 * What this copy is, and how it gets the next one.
 *
 * The desktop app updates itself; a browser tab reloads. Both are drawn here
 * because "am I current?" is the same question in both, and answering it in one
 * place is what stops the web build growing a settings page of its own.
 */
function UpdatesSection(): JSX.Element {
  const desktop = isDesktopRuntime();
  const info = useUpdateStore((state) => state.info);
  const stage = useUpdateStore((state) => state.stage);
  const offer = useUpdateStore((state) => state.offer);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const reloadReady = useUpdateStore((state) => state.reloadReady);
  const check = useUpdateStore((state) => state.check);
  const download = useUpdateStore((state) => state.download);
  const install = useUpdateStore((state) => state.install);
  const setChannel = useUpdateStore((state) => state.setChannel);

  const busy = stage === 'checking' || stage === 'downloading' || stage === 'installing';

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Updates</h1>

      {desktop ? (
        <>
          <p className="mt-2 text-sm text-slate-400">
            This copy is BetweenUs{' '}
            <span className="font-medium text-slate-200">{info?.version ?? '…'}</span>
            {info ? `, the ${FLAVOR_LABEL[info.flavor]}.` : '.'}
          </p>

          {info?.flavor === 'installer' && (
            <p className="mt-2 text-sm text-slate-400">
              An update downloads the setup exe and installs itself over this copy, keeping where
              it is installed and everything in it. BetweenUs starts again when it is done.
            </p>
          )}

          {info?.flavor === 'unpacked' && (
            <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              This is a development build. There is no release for it to update to.
            </p>
          )}

          <h2 className="mt-6 text-xs font-bold uppercase tracking-wide text-slate-400">Channel</h2>
          <p className="mt-1 text-sm text-slate-400">
            A channel takes its own builds and everything steadier, so beta is offered the stable
            releases too.
          </p>
          <div className="mt-3 flex gap-2">
            {UPDATE_CHANNELS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => void setChannel(entry.id)}
                aria-pressed={info?.channel === entry.id}
                className={`flex-1 cursor-pointer rounded-lg px-3 py-2 text-start transition-colors duration-200 ${
                  info?.channel === entry.id
                    ? 'bg-surface-700 ring-2 ring-accent'
                    : 'bg-surface-800 hover:bg-surface-700'
                }`}
              >
                <span className="block text-sm font-medium text-slate-100">{entry.label}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{entry.detail}</span>
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void check()}
              disabled={busy}
              className="cursor-pointer rounded bg-surface-700 px-4 py-2 text-sm font-medium text-slate-100 transition-colors duration-200 hover:bg-surface-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {stage === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>

            {stage === 'available' && (
              <button
                type="button"
                onClick={() => void download()}
                className="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover"
              >
                Download {offer?.version}
              </button>
            )}

            {stage === 'ready' && (
              <button
                type="button"
                onClick={() => void install()}
                className="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover"
              >
                Restart and install
              </button>
            )}

            {stage === 'downloading' && (
              <span className="text-sm tabular-nums text-slate-300">
                {progress < 0 ? 'Downloading…' : `Downloading… ${Math.round(progress * 100)}%`}
              </span>
            )}
          </div>

          {stage === 'idle' && info !== null && info.flavor !== 'unpacked' && !error && (
            <p className="mt-3 text-sm text-slate-400">This is the newest build on this channel.</p>
          )}

          {offer && stage !== 'idle' && (
            <div className="mt-5 rounded-lg bg-surface-800 p-4">
              <p className="text-sm font-medium text-slate-100">{offer.name}</p>
              <p className="mt-1 text-xs text-slate-400">
                {offer.asset.name}
                {offer.asset.size > 0 && ` · ${Math.round(offer.asset.size / 1_000_000)} MB`}
              </p>
              {offer.notes && (
                <div className="mt-3 max-h-64 overflow-y-auto pe-1">
                  <ReleaseNotes text={offer.notes} />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-400">
            In a browser there is nothing to install: the deployment is updated by whoever runs it,
            and this tab picks the new build up when it reloads. It watches for that on its own and
            offers a reload at the top of the window.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => location.reload()}
              className="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover"
            >
              Reload now
            </button>
            <span className="text-sm text-slate-400">
              {reloadReady
                ? 'A newer build is being served.'
                : 'This tab is running the build being served.'}
            </span>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </>
  );
}

const FLAVOR_LABEL: Record<DesktopUpdateFlavor, string> = {
  installer: 'installed build',
  unpacked: 'development build',
};

const UPDATE_CHANNELS: Array<{ id: DesktopUpdateChannel; label: string; detail: string }> = [
  { id: 'stable', label: 'Stable', detail: 'Finished releases only.' },
  { id: 'beta', label: 'Beta', detail: 'Release candidates, plus stable.' },
  { id: 'alpha', label: 'Alpha', detail: 'Everything, as it is built.' },
];

function AppearanceSection(): JSX.Element {
  const settings = useThemeStore((state) => state.settings);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const setFollowSystem = useThemeStore((state) => state.setFollowSystem);
  const setCustomAccent = useThemeStore((state) => state.setCustomAccent);
  const density = useThemeStore((state) => state.settings.density);
  const uiLocale = useThemeStore((state) => state.settings.locale);
  const setInterfaceLocale = useThemeStore((state) => state.setInterfaceLocale);
  const setDensity = useThemeStore((state) => state.setDensity);

  const themeList = Object.values(THEMES);
  const activeDef = THEMES[resolvedTheme] ?? THEMES.dark;

  const [categoryFilter, setCategoryFilter] = useState<'all' | 'light' | 'developer' | 'vibrant' | 'signature'>('all');

  const filteredThemes = themeList.filter((theme) => {
    if (categoryFilter === 'all') return true;
    if (categoryFilter === 'light') return theme.type === 'light';
    if (categoryFilter === 'developer') return theme.category === 'Developer';
    if (categoryFilter === 'vibrant') return theme.category === 'Vibrant' || theme.category === 'Warm' || theme.category === 'Pastel';
    if (categoryFilter === 'signature') return theme.category === 'Signature' || theme.category === 'Monochrome' || theme.category === 'Palette';
    return true;
  });

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">Themes & Appearance</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Customize the look and feel of the BetweenUs workbench across floating surfaces, accents, and tones.
          </p>
        </div>
      </div>

      {/* System Sync Switch */}
      <div className="mt-6 rounded-lg bg-surface-800 p-4 border border-edge">
        <Switch
          label="Sync with computer theme"
          hint="Automatically switch BetweenUs between Daylight and dark themes based on your system appearance."
          checked={settings.followSystem}
          onChange={setFollowSystem}
        />
      </div>

      {/* Themes Gallery */}
      <div className="mt-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Theme collection ({themeList.length})
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            Active: <span className="font-semibold text-slate-100">{activeDef.name}</span>
            {settings.followSystem && <span className="ms-1 text-accent">(Auto)</span>}
          </span>
        </div>

        {/* Category Filter Pills */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            { id: 'all', label: `All (${themeList.length})` },
            { id: 'signature', label: 'Signature & Dark' },
            { id: 'light', label: 'Light Mode' },
            { id: 'developer', label: 'Developer' },
            { id: 'vibrant', label: 'Vibrant & Warm' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id as typeof categoryFilter)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer ${
                categoryFilter === cat.id
                  ? 'bg-accent text-white'
                  : 'bg-surface-800 text-slate-300 hover:bg-surface-700 hover:text-slate-100 border border-edge'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {filteredThemes.map((theme) => {
            const isSelected = resolvedTheme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => setTheme(theme.id)}
                aria-pressed={isSelected}
                className={`group relative flex flex-col text-start cursor-pointer overflow-hidden rounded-xl border transition-all duration-200 focus:outline-none ${
                  isSelected
                    ? 'border-accent bg-surface-800 ring-2 ring-accent/30 shadow-md scale-[1.01]'
                    : 'border-edge bg-surface-850 hover:border-slate-500/30 hover:bg-surface-800 active:scale-[0.99]'
                }`}
              >
                {/* Workbench Mockup Preview */}
                <div
                  className="relative h-28 w-full p-2.5 overflow-hidden transition-transform duration-200 group-hover:scale-[1.02]"
                  style={{ backgroundColor: theme.preview.ground }}
                >
                  <div className="flex h-full gap-1.5 rounded-lg overflow-hidden">
                    {/* Rail mock */}
                    <div
                      className="w-5 shrink-0 rounded flex flex-col items-center py-1.5 gap-1 border border-white/5"
                      style={{ backgroundColor: theme.colors['--color-surface-950'] }}
                    >
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: theme.preview.accent }}
                      />
                      <div className="h-1.5 w-2 rounded-sm bg-white/20" />
                      <div className="h-1.5 w-2 rounded-sm bg-white/10" />
                    </div>

                    {/* Sidebar mock */}
                    <div
                      className="w-14 shrink-0 rounded p-1 flex flex-col gap-1 border border-white/5"
                      style={{ backgroundColor: theme.colors['--color-surface-800'] }}
                    >
                      <div className="h-1.5 w-7 rounded bg-white/30" />
                      <div
                        className="h-3 w-full rounded px-1 flex items-center gap-1"
                        style={{
                          backgroundColor: isSelected
                            ? theme.colors['--color-row-active']
                            : 'transparent',
                        }}
                      >
                        <div
                          className="h-1 w-1 rounded-full"
                          style={{ backgroundColor: theme.preview.accent }}
                        />
                        <div className="h-1 w-6 rounded bg-white/40" />
                      </div>
                      <div className="h-1.5 w-8 rounded bg-white/15 ms-1" />
                      <div className="h-1.5 w-6 rounded bg-white/15 ms-1" />
                    </div>

                    {/* Main Surface mock */}
                    <div
                      className="flex-1 rounded p-1.5 flex flex-col justify-between border border-white/5"
                      style={{ backgroundColor: theme.preview.surface }}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <div
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: theme.preview.accent }}
                          />
                          <div className="h-1.5 w-12 rounded bg-white/40" />
                        </div>
                        <div className="h-1 w-16 rounded bg-white/20 ms-3.5" />
                      </div>

                      {/* Mock chat bubble */}
                      <div
                        className="self-end rounded px-1.5 py-0.5 max-w-[80%]"
                        style={{ backgroundColor: theme.preview.accent }}
                      >
                        <div className="h-1 w-10 rounded bg-white/90" />
                      </div>
                    </div>
                  </div>

                  {/* Active Indicator Checkmark */}
                  {isSelected && (
                    <div className="absolute top-2.5 end-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white shadow-sm ring-2 ring-surface-900">
                      <CheckIcon className="h-3.5 w-3.5 stroke-[3]" />
                    </div>
                  )}
                </div>

                {/* Card Info */}
                <div className="flex items-start justify-between gap-2 p-3.5 border-t border-edge bg-surface-850">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-100">{theme.name}</span>
                      <span className="rounded-full bg-surface-700/80 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                        {theme.category}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {theme.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Accent Color Customizer */}
      <div className="mt-8 border-t border-edge pt-7">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Accent tint
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Choose a custom accent color for buttons, active channel indicators, and focus rings.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {ACCENT_PRESETS.map((preset) => {
            const isPresetActive = settings.customAccentId === preset.id;
            const swatchBg = preset.value || activeDef.preview.accent;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setCustomAccent(preset.id)}
                title={preset.label}
                aria-label={`Select ${preset.label} accent`}
                aria-pressed={isPresetActive}
                className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer ${
                  isPresetActive
                    ? 'border-accent bg-accent/15 text-slate-100 ring-2 ring-accent/30'
                    : 'border-edge bg-surface-800 text-slate-300 hover:bg-surface-700 hover:border-slate-500/40'
                }`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full shrink-0 shadow-sm flex items-center justify-center"
                  style={{ backgroundColor: swatchBg }}
                >
                  {isPresetActive && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white shadow-xs" />
                  )}
                </span>
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Density */}
      <div className="mt-8 border-t border-edge pt-7">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Message density
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          How much space a conversation gets. This is spacing, not text size — the
          system font scale is the accessible way to ask for larger text, and a
          second control here that disagreed with it would be worse than none.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {DENSITIES.map((option) => {
            const active = density === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setDensity(option)}
                aria-pressed={active}
                className={`flex min-w-[180px] flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-start transition-colors duration-150 ${
                  active
                    ? 'border-accent bg-accent/15 text-slate-100'
                    : 'border-edge bg-surface-800 text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <span className="text-sm font-medium">{DENSITY_LABELS[option].label}</span>
                <span className="text-xs text-slate-400">{DENSITY_LABELS[option].hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Language, which today is a direction */}
      <div className="mt-8 border-t border-edge pt-7">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">Language</h2>
        <p className="mt-1 text-sm text-slate-400">
          BetweenUs is not translated yet, so every one of these still reads in English.
          What changes today is the direction the layout runs in — pick Arabic or Hebrew and
          the sidebars, menus and message rows move to the other side of the screen.
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {LOCALES.map((option) => {
            const active = uiLocale === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setInterfaceLocale(option.id)}
                aria-pressed={active}
                lang={option.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors duration-150 ${
                  active
                    ? 'border-accent bg-accent/15 text-slate-100'
                    : 'border-edge bg-surface-800 text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                <span>{option.label}</span>
                <span className="text-xs uppercase text-slate-400">{option.direction}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Preview Sandbox */}
      <div className="mt-8 border-t border-edge pt-7">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Workbench Preview
        </h2>
        <div className="mt-3.5 rounded-xl border border-edge bg-ground p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Sidebar snippet */}
            <div className="w-full sm:w-48 rounded-lg bg-surface-800 p-2.5 border border-edge flex flex-col gap-1.5">
              <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Channels
              </div>
              <div className="row-active flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium cursor-pointer">
                <span className="text-accent font-bold">#</span>
                <span>general</span>
                <span className="ms-auto flex h-2 w-2 rounded-full bg-status-online" />
              </div>
              <div className="row-idle flex items-center gap-2 rounded px-2 py-1.5 text-xs font-medium cursor-pointer">
                <span className="text-slate-500 font-bold">#</span>
                <span>voice-lounge</span>
              </div>
            </div>

            {/* Main panel snippet */}
            <div className="flex-1 rounded-lg bg-surface-900 p-3.5 border border-edge flex flex-col justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 pb-2 border-b border-edge">
                  <span className="font-semibold text-xs text-slate-100"># general</span>
                  <span className="text-[11px] text-slate-400">· BetweenUs Team</span>
                </div>
                <div className="mt-2.5 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center text-white text-[10px] font-bold">
                      BU
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-medium text-xs text-slate-100">BetweenUs</span>
                        <span className="text-[10px] text-slate-400">Today at 5:30 PM</span>
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5">
                        Welcome to BetweenUs! Theme colors adjust across all floating surfaces seamlessly.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-accent-hover active:scale-[0.98]"
                >
                  Primary Action
                </button>
                <span className="text-xs text-slate-400">Floating panel aesthetic</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const STATUS_LABELS: Record<ActiveStatus, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  invisible: 'Invisible',
};

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-slate-100">{value}</dd>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full min-h-[44px] rounded-lg border border-edge bg-surface-950 px-3 py-2.5 text-slate-100 outline-none transition-colors focus:border-accent/60"
      />
    </label>
  );
}

function formatDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString() : '';
}
