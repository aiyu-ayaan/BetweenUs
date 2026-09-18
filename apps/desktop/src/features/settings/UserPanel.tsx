import { useEffect, useRef, useState } from 'react';
import type { ActiveStatus } from '@betweenus/shared-types';
import { useAuthStore } from '../../stores/auth';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { Avatar } from '../../components/Avatar';
import { AppDownloadIcon, HeadphonesIcon, MicIcon, MicOffIcon, SettingsIcon } from '../../components/icons';
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

const STATUS_WORD: Record<ActiveStatus, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  invisible: 'Invisible',
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
  const toggleMic = useVoiceStore((state) => state.toggleMic);

  const [open, setOpen] = useState(false);
  const [deafened, setDeafened] = useState(false);
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
          className="flex shrink-0 cursor-pointer items-center gap-2 border-t border-edge bg-accent/[0.06] px-3 py-2 text-start transition-colors duration-200 hover:bg-accent/[0.12]"
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

    <div ref={panel} className="relative flex shrink-0 items-center gap-2 border-t border-edge bg-black/20 p-2">
      {open && (
        <div
          role="menu"
          aria-label="Set status"
          className="absolute bottom-full start-2 z-40 mb-2 w-60 animate-pop overflow-hidden rounded-xl border border-edge bg-surface-950 py-1.5 shadow-pop"
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
              className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-start hover:bg-white/[0.06]"
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
        className="spring-press flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-start hover:bg-white/[0.06]"
      >
        <Avatar
          name={user?.displayName ?? 'aiyu'}
          avatarUrl={user?.avatarUrl}
          status={selfStatus}
          size="md"
          ringColour="border-surface-850"
          viewable={false}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-100">
            {user?.displayName ?? 'aiyu'}
          </span>
          {/* No second dot here - the avatar above already cuts one into its
              own corner for this exact status, and a row that draws the same
              fact twice reads as two people's presence rather than one.
              And no role either: this column is roughly ninety pixels once the
              avatar and the buttons have taken theirs, so "Founder • Online"
              truncated to "Foun…", which says neither. The role is already on
              every message this account sends and beside its name in the
              member list; what this row is for is who you are and what you are
              set to. */}
          <span className="block truncate text-xs text-slate-400">
            {STATUS_WORD[selfStatus]}
          </span>
        </span>
      </button>

      {/* Always here, in a call or out of one. `VoicePanel` above carries no
          controls at all, so this row is the only microphone on the sidebar -
          the rest of the call's controls are in `VoiceChannelView`, one click
          away through the channel name in that panel. */}
      <button
        type="button"
        onClick={() => void toggleMic()}
        aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        title="Microphone"
        className="spring-press shrink-0 cursor-pointer rounded-lg p-2 text-slate-300 hover:bg-white/[0.06]"
      >
        {micEnabled ? <MicIcon className="h-4 w-4" /> : <MicOffIcon className="h-4 w-4 text-danger" />}
      </button>

      <button
        type="button"
        onClick={() => setDeafened((d) => !d)}
        aria-label={deafened ? 'Undeafen' : 'Deafen'}
        title="Deafen"
        className={`spring-press shrink-0 cursor-pointer rounded-lg p-2 hover:bg-white/[0.06] ${
          deafened ? 'text-danger' : 'text-slate-300'
        }`}
      >
        <HeadphonesIcon className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="User settings"
        title="User settings"
        className="spring-press shrink-0 cursor-pointer rounded-lg p-2 text-slate-300 hover:bg-white/[0.06]"
      >
        <SettingsIcon className="h-4 w-4" />
      </button>
    </div>
    </>
  );
}
