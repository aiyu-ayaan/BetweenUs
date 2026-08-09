import { useEffect, useState } from 'react';
import type { ActiveStatus } from '@nexora/shared-types';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { api } from '../../services/api';
import {
  notificationPreferences,
  onPreferencesChanged,
  updateNotificationPreferences,
} from '../../services/notifications';
import { serverUrl } from '../../services/endpoint';
import { useAgentStore } from '../../services/remote-agent';
import { ServerPicker } from '../auth/ServerPicker';
import { Avatar } from '../../components/Avatar';
import { PicturePicker } from '../../components/PicturePicker';
import {
  BellIcon,
  LogOutIcon,
  MicIcon,
  MonitorIcon,
  PaletteIcon,
  UserIcon,
  XIcon,
} from '../../components/icons';

type Section = 'account' | 'voice' | 'notifications' | 'remote' | 'appearance';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof UserIcon }> = [
  { id: 'account', label: 'My Account', icon: UserIcon },
  { id: 'voice', label: 'Voice & Video', icon: MicIcon },
  { id: 'notifications', label: 'Notifications', icon: BellIcon },
  { id: 'remote', label: 'Remote Access', icon: MonitorIcon },
  { id: 'appearance', label: 'Appearance', icon: PaletteIcon },
];

/**
 * Settings take the whole window rather than a dialog, because they are a place
 * you go rather than a thing you glance at - and because a modal that covers a
 * chat you are still in invites you to keep half-reading it.
 */
export function UserSettings({ onClose }: { onClose: () => void }): JSX.Element {
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
      role="dialog"
      aria-modal="true"
      aria-label="User settings"
      className="fixed inset-0 z-50 flex bg-surface-900"
    >
      <nav
        aria-label="Settings sections"
        className="flex w-[232px] shrink-0 flex-col items-end overflow-y-auto bg-surface-800 py-14 pr-2"
      >
        <div className="w-[192px]">
          <p className="px-2.5 pb-1 text-xs font-bold uppercase tracking-wide text-slate-400">
            User settings
          </p>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              aria-current={section === entry.id ? 'page' : undefined}
              className={`mt-0.5 flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-[15px] transition-colors duration-200 ${
                section === entry.id
                  ? 'bg-surface-700 text-slate-50'
                  : 'text-slate-300 hover:bg-surface-700/60'
              }`}
            >
              <entry.icon className="h-4 w-4 shrink-0" />
              {entry.label}
            </button>
          ))}

          <hr className="my-2 border-surface-700" />

          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-left text-[15px] text-slate-300 transition-colors duration-200 hover:bg-danger hover:text-white"
          >
            Log out
            <LogOutIcon className="h-4 w-4" />
          </button>
        </div>
      </nav>

      <div className="relative flex-1 overflow-y-auto px-10 py-14">
        <div className="max-w-[660px]">
          {section === 'account' && <AccountSection />}
          {section === 'voice' && <VoiceSection />}
          {section === 'notifications' && <NotificationsSection />}
          {section === 'remote' && <RemoteSection />}
          {section === 'appearance' && <AppearanceSection />}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="absolute right-10 top-14 flex h-9 w-9 cursor-pointer flex-col items-center justify-center rounded-full border-2 border-slate-500 text-slate-400 transition-colors duration-200 hover:bg-surface-700 hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
        <span className="absolute right-8 top-24 text-[11px] font-bold text-slate-500">ESC</span>
      </div>
    </div>
  );
}

function AccountSection(): JSX.Element {
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const selfStatus = usePresenceStore((state) => state.selfStatus);
  const setStatus = usePresenceStore((state) => state.setStatus);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNote, setProfileNote] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordNote, setPasswordNote] = useState<string | null>(null);

  const [pickingServer, setPickingServer] = useState(false);

  const saveProfile = async (): Promise<void> => {
    setSavingProfile(true);
    setProfileNote(null);
    try {
      await api.updateAccount({ displayName: displayName.trim(), username: username.trim() });
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
        <div className="h-[100px] bg-accent" />
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
          </div>
        </div>

        <div className="border-t border-black/20 px-4 py-4">
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
          >
            <Avatar
              name={user?.displayName ?? '?'}
              avatarUrl={user?.avatarUrl}
              size="lg"
              ringColour="border-surface-800"
            />
          </PicturePicker>
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
                : 'bg-surface-800 text-slate-200 hover:bg-surface-700'
            }`}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Profile</h2>
      <div className="mt-3 space-y-4">
        <TextField label="Display name" value={displayName} onChange={setDisplayName} />
        <TextField label="Username" value={username} onChange={setUsername} />
        <button
          type="button"
          disabled={savingProfile}
          onClick={() => void saveProfile()}
          className="cursor-pointer rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:opacity-60"
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
          className="cursor-pointer rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:opacity-50"
        >
          Change password
        </button>
        {passwordNote && <p className="text-sm text-slate-300">{passwordNote}</p>}
      </div>

      <h2 className="mt-8 text-base font-semibold text-slate-50">Server</h2>
      <p className="mt-1 text-sm text-slate-400">
        The deployment this app talks to. Changing it signs you out of this one.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="rounded bg-surface-800 px-3 py-2 text-sm text-slate-200">
          {serverUrl()}
        </code>
        <button
          type="button"
          onClick={() => setPickingServer(true)}
          className="cursor-pointer rounded bg-surface-800 px-5 py-2 text-sm font-medium text-slate-100 transition-colors duration-200 hover:bg-surface-700"
        >
          Change server
        </button>
      </div>

      {pickingServer && <ServerPicker onClose={() => setPickingServer(false)} />}
    </>
  );
}

function VoiceSection(): JSX.Element {
  const status = useVoiceStore((state) => state.status);
  const micEnabled = useVoiceStore((state) => state.micEnabled);
  const cameraEnabled = useVoiceStore((state) => state.cameraEnabled);

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Voice &amp; Video</h1>
      <p className="mt-2 text-sm text-slate-400">
        Devices are chosen by the operating system. What is shown here is the state of the call
        this window is in.
      </p>

      <dl className="mt-5 space-y-4 rounded-lg bg-surface-800 p-4">
        <Field label="Connection" value={status === 'connected' ? 'In a voice channel' : 'Not connected'} />
        <Field label="Microphone" value={micEnabled ? 'On' : 'Off'} />
        <Field label="Camera" value={cameraEnabled ? 'On' : 'Off'} />
        <Field
          label="Encryption"
          value="End-to-end, with the channel key. A call that cannot encrypt is aborted rather than downgraded."
        />
      </dl>
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
    void window.nexora?.getAppSettings().then(setMachine);
  }, []);

  const save = (patch: Partial<typeof preferences>): void => {
    void updateNotificationPreferences(patch).catch(() => undefined);
  };

  const saveMachine = (patch: { launchOnStartup?: boolean; closeToTray?: boolean }): void => {
    void window.nexora?.setAppSettings(patch).then((next) => {
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

      <h2 className="mt-8 text-base font-semibold text-slate-100">This computer</h2>
      <div className="mt-3 space-y-1 rounded-lg bg-surface-800 p-4">
        <Switch
          label="Open Nexora when the system starts"
          hint="Starts in the tray, without a window in front of what you were doing."
          checked={machine?.launchOnStartup ?? false}
          disabled={machine === null || !machine.canManageAutoStart}
          onChange={(launchOnStartup) => saveMachine({ launchOnStartup })}
        />
        <Switch
          label="Keep running in the tray when the window is closed"
          hint="Off makes closing the window quit Nexora, and notifications stop with it."
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
                className="cursor-pointer rounded bg-surface-700 px-3 py-1.5 text-sm text-slate-100 transition-colors duration-200 hover:bg-surface-600"
              >
                Unmute
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
      className={`flex items-start justify-between gap-6 py-2 ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <span>
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
        className="mt-2 rounded bg-surface-950 px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent"
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

function AppearanceSection(): JSX.Element {
  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Appearance</h1>
      <p className="mt-2 text-sm text-slate-400">
        Nexora is dark. A light theme is not built yet, and a switch that does nothing is worse
        than no switch.
      </p>
      <div className="mt-5 flex gap-3">
        <div className="w-40 overflow-hidden rounded-lg ring-2 ring-accent">
          <div className="h-20 bg-surface-900" />
          <p className="bg-surface-800 px-3 py-2 text-sm text-slate-100">Dark</p>
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
        className="mt-2 w-full rounded bg-surface-950 px-3 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </label>
  );
}

function formatDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString() : '';
}
