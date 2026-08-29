import { useEffect, useRef, useState } from 'react';
import type { ActiveStatus } from '@betweenus/shared-types';
import { useAuthStore } from '../../stores/auth';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { Avatar } from '../../components/Avatar';
import { AppDownloadIcon, MicIcon, MicOffIcon, SettingsIcon } from '../../components/icons';
import { isDesktopRuntime } from '../../services/platform';
import { DOWNLOAD_URL, downloadLabel } from '../../services/downloads';

const STATUS_CHOICES: Array<{ value: ActiveStatus; label: string; hint?: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Idle' },
  { value: 'dnd', label: 'Do Not Disturb', hint: 'You will not receive desktop notifications.' },
  { value: 'invisible', label: 'Invisible', hint: 'You will not appear online, but can use BetweenUs normally.' },
];

const DOT: Record<ActiveStatus, string> = {
  online: 'bg-status-online',
  idle: 'bg-status-idle',
  dnd: 'bg-status-dnd',
  invisible: 'bg-status-offline',
};

/**
 * The strip along the bottom of every sidebar: who you are, what you are set
 * to, and the way into settings. Clicking the avatar opens the status picker,
 * which is the only place `invisible` is ever shown.
 */
export function UserPanel({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  const user = useAuthStore((state) => state.user);
  const selfStatus = usePresenceStore((state) => state.selfStatus);
  const setStatus = usePresenceStore((state) => state.setStatus);
  const micEnabled = useVoiceStore((state) => state.micEnabled);
  const voiceStatus = useVoiceStore((state) => state.status);
  const toggleMic = useVoiceStore((state) => state.toggleMic);

  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // A menu that does not close when you look away is a menu you have to fight.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent): void => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);

  return (
    <>
      {/* Only in a browser, and above the account row rather than inside it:
          it is an offer, not one of this account's controls, and the two
          should not be reached for by accident. It disappears the moment
          somebody is running the app it points at. */}
      {!isDesktopRuntime() && (
        <a
          href={DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer noopener"
          title="Voice calls, screen sharing and one-time messages all work in the app"
          className="flex shrink-0 cursor-pointer items-center gap-2 border-t border-edge bg-accent/[0.06] px-3 py-2 text-left transition-colors duration-200 hover:bg-accent/[0.12]"
        >
          <AppDownloadIcon className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-slate-100">
              {downloadLabel()}
            </span>
            <span className="block truncate text-[11px] text-slate-400">
              One-time messages need it
            </span>
          </span>
        </a>
      )}

    <div ref={panel} className="relative flex shrink-0 items-center gap-2 border-t border-edge bg-black/20 px-2 py-1.5">
      {open && (
        <div
          role="menu"
          aria-label="Set status"
          className="absolute bottom-full left-2 z-40 mb-2 w-60 animate-pop overflow-hidden rounded-xl border border-edge bg-surface-950 py-1.5 shadow-pop"
        >
          {STATUS_CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitemradio"
              aria-checked={selfStatus === choice.value}
              onClick={() => {
                setStatus(choice.value);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left hover:bg-white/[0.06]"
            >
              <span
                aria-hidden="true"
                className={`mt-1 h-3 w-3 shrink-0 rounded-full ${DOT[choice.value]}`}
              />
              <span className="min-w-0">
                <span className="block text-sm text-slate-100">{choice.label}</span>
                {choice.hint && (
                  <span className="mt-0.5 block text-xs leading-snug text-slate-400">
                    {choice.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Set your status"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 py-1 text-left transition-colors duration-200 hover:bg-white/[0.06]"
      >
        <Avatar
          name={user?.displayName ?? '?'}
          avatarUrl={user?.avatarUrl}
          status={selfStatus}
          size="sm"
          ringColour="border-surface-850"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-100">
            {user?.displayName}
          </span>
          <span className="block truncate text-xs text-slate-400">
            {STATUS_CHOICES.find((choice) => choice.value === selfStatus)?.label ?? 'Online'}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => void toggleMic()}
        disabled={voiceStatus !== 'connected'}
        aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        title={voiceStatus === 'connected' ? 'Microphone' : 'Join a voice channel first'}
        className="shrink-0 cursor-pointer rounded-md p-2 text-slate-300 transition-colors duration-150 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {micEnabled ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5 text-danger" />}
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="User settings"
        title="User settings"
        className="shrink-0 cursor-pointer rounded-md p-2 text-slate-300 transition-colors duration-150 hover:bg-white/[0.06]"
      >
        <SettingsIcon className="h-5 w-5" />
      </button>
    </div>
    </>
  );
}
