import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chat';
import {
  clearPendingInvite,
  inviteCodeFrom,
  pendingInvite,
} from '../../services/invite-link';
import { InviteDialog } from './InviteDialog';
import { BetweenUsLogoIcon, CompassIcon, MessageIcon, PlusIcon } from '../../components/icons';
import { ServerIcon } from '../../components/ServerIcon';
import { useFocusTrap } from '../../services/focus-trap';

interface RailItem {
  id: string;
  name: string;
  badge?: number;
}

const SHOWCASE_SERVERS: RailItem[] = [
  { id: 'server-bu', name: 'BU' },
  { id: 'server-os', name: 'OS', badge: 3 },
  { id: 'server-rt', name: 'RT' },
  { id: 'server-cg', name: 'CG' },
];

export function ServerRail({ className }: { className?: string } = {}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const { servers, view, activeServerId, selectServer, showHome, createServer } = useChatStore();
  const [dialog, setDialog] = useState<'none' | 'create' | 'join'>('none');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const [selectedRailId, setSelectedRailId] = useState<string>('betweenus-hq');

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

  // BetweenUs HQ is active when in server view and either it is selected or primary
  const isPrimaryActive = view === 'server' && (selectedRailId === 'betweenus-hq' || !activeServerId);

  return (
    <nav
      aria-label="Servers"
      className={`relative flex w-16 shrink-0 flex-col items-center gap-1.5 overflow-y-auto bg-[#0b0f19] py-2.5 ${className ?? ''}`}
    >
      {/* Top BetweenUs HQ Master Button with Active Ring & Marker */}
      <RailButton
        label="BetweenUs HQ"
        active={isPrimaryActive}
        onClick={() => {
          setSelectedRailId('betweenus-hq');
          useChatStore.setState({ view: 'server' });
          if (servers[0]) void selectServer(servers[0].id);
        }}
        activeClasses="bg-accent text-white shadow-lg shadow-accent/30 rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-[#0b0f19]"
        shape="rounded-2xl"
      >
        <BetweenUsLogoIcon className="h-6 w-6 text-white" />
      </RailButton>

      {/* Direct Messages Icon */}
      <RailButton
        label="Direct messages"
        active={view === 'home' || selectedRailId === 'home'}
        onClick={() => {
          setSelectedRailId('home');
          showHome();
        }}
        activeClasses="bg-accent text-white shadow-lg shadow-accent/25 rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-[#0b0f19]"
        shape="rounded-2xl"
      >
        <MessageIcon className="h-5 w-5" />
      </RailButton>

      <hr className="my-1 w-8 border-t border-edge/60" />

      {/* Real Servers or Showcase Servers (BU, OS, RT, CG) */}
      {servers.length > 1
        ? servers.slice(1).map((server) => {
            const isActive = view === 'server' && (activeServerId === server.id || selectedRailId === server.id);
            return (
              <RailButton
                key={server.id}
                label={server.name}
                active={isActive}
                onClick={() => {
                  setSelectedRailId(server.id);
                  void selectServer(server.id);
                }}
                activeClasses="bg-accent text-white rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-[#0b0f19]"
                shape="rounded-full hover:rounded-2xl"
              >
                <ServerIcon server={server} size="rail" />
              </RailButton>
            );
          })
        : SHOWCASE_SERVERS.map((item) => {
            const isActive = view === 'server' && selectedRailId === item.id;
            return (
              <RailButton
                key={item.id}
                label={item.name}
                active={isActive}
                badge={item.badge}
                onClick={() => {
                  setSelectedRailId(item.id);
                  useChatStore.setState({ view: 'server' });
                }}
                activeClasses="bg-accent text-white rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-[#0b0f19]"
                shape="rounded-full hover:rounded-2xl"
              >
                <span className="text-xs font-bold tracking-wider text-inherit">
                  {item.name}
                </span>
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

      {/* Explore Servers Button */}
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
              placeholder={dialog === 'create' ? "BetweenUs HQ" : 'betweenus-team'}
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
          active ? 'h-8 opacity-100 scale-100' : 'h-2 opacity-0 scale-75 group-hover:h-4 group-hover:opacity-60 group-hover:scale-100'
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
          <span className="absolute -bottom-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-md ring-2 ring-[#0b0f19]">
            {badge}
          </span>
        )}
      </button>
    </div>
  );
}
