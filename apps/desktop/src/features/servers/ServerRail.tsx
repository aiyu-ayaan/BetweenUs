import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import {
  clearPendingInvite,
  inviteCodeFrom,
  pendingInvite,
} from '../../services/invite-link';
import { InviteDialog } from './InviteDialog';
import { CompassIcon, MessageIcon, PlusIcon } from '../../components/icons';
import { ServerIcon } from '../../components/ServerIcon';
import { useFocusTrap } from '../../services/focus-trap';

export function ServerRail({
  className,
  onNavigate,
}: {
  className?: string;
  /** Called on any click in the rail - what `App.tsx` uses to drop the top
      bar back to Workbench, since picking a server the workbench is already
      pinned to changes nothing in the chat store for an effect to react to. */
  onNavigate?: () => void;
} = {}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const {
    servers,
    channelServerId,
    unread,
    view,
    activeServerId,
    selectServer,
    showHome,
    createServer,
  } = useChatStore();
  const [dialog, setDialog] = useState<'none' | 'create' | 'join'>('none');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  useEffect(() => {
    const code = pendingInvite();
    if (!code) return;
    clearPendingInvite();
    setInvited(code);
  }, []);

  const submit = async (): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      if (dialog === 'create') {
        await createServer(trimmed);
      } else {
        const code = inviteCodeFrom(trimmed);
        if (!code) throw new Error('That is not an invite link or code');
        setInvited(code);
      }
      setDialog('none');
      setValue('');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav
      aria-label="Servers"
      onClickCapture={onNavigate}
      className={`relative flex w-16 shrink-0 flex-col items-center gap-1.5 overflow-y-auto bg-surface-950 py-2.5 ${className ?? ''}`}
    >
      {/* Direct Messages Icon Button */}
      <RailButton
        label="Direct messages"
        active={view === 'home'}
        onClick={showHome}
        activeClasses="bg-accent text-white shadow-lg shadow-accent/25 rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-surface-950"
        shape={view === 'home' ? 'rounded-2xl' : 'rounded-full hover:rounded-2xl'}
      >
        <MessageIcon className="h-5 w-5" />
      </RailButton>

      <hr className="my-1 w-8 border-t border-edge/60" />

      {/* Real Servers from store */}
      {servers.map((server) => {
        const isActive = view === 'server' && activeServerId === server.id;
        // Summed from the durable channelId -> serverId map, not from
        // `channels` - that array is reset to whichever server is currently
        // open, so every other server's icon read a permanent zero here.
        const serverUnread = Object.entries(unread).reduce(
          (sum, [channelId, count]) => (channelServerId[channelId] === server.id ? sum + count : sum),
          0,
        );

        return (
          <RailButton
            key={server.id}
            label={server.name}
            active={isActive}
            badge={serverUnread > 0 ? serverUnread : undefined}
            onClick={() => void selectServer(server.id)}
            activeClasses="bg-accent text-white shadow-lg shadow-accent/30 rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-surface-950"
            shape={isActive ? 'rounded-2xl' : 'rounded-full hover:rounded-2xl'}
          >
            <ServerIcon server={server} size="rail" />
          </RailButton>
        );
      })}

      {/* Add Server Button */}
      <RailButton
        label="Create a server"
        active={false}
        onClick={() => setDialog('create')}
        idleTextClasses="text-emerald-400"
        activeClasses="bg-emerald-500 text-white"
        shape="rounded-full hover:rounded-2xl hover:bg-emerald-500/20"
      >
        <PlusIcon className="h-5 w-5 text-emerald-400" />
      </RailButton>

      {/* Explore / Join Servers Button */}
      <RailButton
        label="Join a server"
        active={false}
        onClick={() => setDialog('join')}
        idleTextClasses="text-slate-400"
        activeClasses="bg-white/[0.07] text-slate-100"
        shape="rounded-full hover:rounded-2xl hover:bg-white/[0.08]"
      >
        <CompassIcon className="h-5 w-5 text-slate-400" />
      </RailButton>

      {invited && <InviteDialog code={invited} onClose={() => setInvited(null)} />}

      {dialog !== 'none' && (
        <div
          ref={trap}
          role="dialog"
          aria-modal="true"
          aria-label={dialog === 'create' ? 'Create a server' : 'Join a server'}
          className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4"
          onClick={() => setDialog('none')}
        >
          <div
            className="w-full max-w-md animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 p-6 text-start shadow-pop"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-xl font-semibold text-slate-50">
              {dialog === 'create' ? 'Create a server' : 'Join a server'}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {dialog === 'create'
                ? 'Your server is where you and your people hang out. Make one and start talking.'
                : 'Paste the invite code someone sent you.'}
            </p>

            <label
              htmlFor="server-input"
              className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-300"
            >
              {dialog === 'create' ? 'Server name' : 'Invite code'}
            </label>
            <input
              id="server-input"
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
                if (event.key === 'Escape') setDialog('none');
              }}
              className="mt-2 w-full rounded-lg border border-edge bg-surface-950 px-3 py-2.5 text-slate-100 outline-none ring-0 transition-colors focus:border-accent/60"
              placeholder={dialog === 'create' ? "My community" : 'betweenus-team'}
            />

            {failure && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {failure}
              </p>
            )}

            <div className="-mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t border-edge bg-black/20 px-6 py-4">
              <button
                type="button"
                onClick={() => setDialog('none')}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !value.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Working...' : dialog === 'create' ? 'Create' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
  activeClasses,
  idleTextClasses = 'text-slate-300',
  badge,
  shape = 'rounded-full',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  activeClasses: string;
  idleTextClasses?: string;
  badge?: number | string;
  shape?: string;
}): JSX.Element {
  return (
    <div className="group relative flex w-full justify-center my-0.5">
      {/* Active side indicator marker - explicitly pinned to left-0 */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1/2 w-1.5 -translate-y-1/2 rounded-r-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)] transition-all duration-200 ease-out ${
          active
            ? 'h-8 opacity-100 scale-100'
            : 'h-2 opacity-0 scale-75 group-hover:h-4 group-hover:opacity-60 group-hover:scale-100'
        }`}
      />
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-current={active ? 'true' : undefined}
        className={`relative flex h-11 w-11 cursor-pointer items-center justify-center transition-all duration-200 focus:outline-none active:scale-[0.96] ${shape} ${
          active
            ? activeClasses
            : `bg-surface-800/80 hover:bg-accent/20 hover:text-white ${idleTextClasses}`
        }`}
      >
        {children}
        {Boolean(badge) && (
          <span className="absolute -bottom-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-md ring-2 ring-surface-950">
            {badge}
          </span>
        )}
      </button>
    </div>
  );
}
