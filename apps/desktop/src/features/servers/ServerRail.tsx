import { useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { CompassIcon, MessageIcon, PlusIcon } from '../../components/icons';
import { ServerIcon } from '../../components/ServerIcon';

/**
 * The left rail: direct messages at the top, then one tile per server, and the
 * two ways to get another one at the bottom.
 *
 * It is the one region that is not a panel - it sits directly on the ground, so
 * the workbench reads as panels arranged beside a column of controls rather
 * than as one more grey stripe. Where you are is a short bar against the left
 * edge, the way an editor marks its active activity-bar item: it costs no
 * horizontal space and it does not turn the tile into a different shape.
 */
export function ServerRail(): JSX.Element {
  const { servers, view, activeServerId, selectServer, showHome, createServer, joinServer } =
    useChatStore();
  const [dialog, setDialog] = useState<'none' | 'create' | 'join'>('none');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      if (dialog === 'create') await createServer(trimmed);
      else await joinServer(trimmed);
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
      className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden py-0.5"
    >
      {/* Not the Nexora mark: that is in the top bar, and a second copy of it
          one row below reads as branding rather than as the button it is. A
          rail tile has to say where it goes. */}
      <RailButton
        label="Direct messages"
        active={view === 'home'}
        onClick={showHome}
        activeClasses="bg-accent/20 text-accent"
      >
        <MessageIcon className="h-[22px] w-[22px]" />
      </RailButton>

      <hr className="my-1 w-6 border-t border-edge" />

      {servers.map((server) => (
        <RailButton
          key={server.id}
          label={server.name}
          active={view === 'server' && server.id === activeServerId}
          onClick={() => void selectServer(server.id)}
          activeClasses="bg-accent text-white"
        >
          <ServerIcon server={server} size="rail" />
        </RailButton>
      ))}

      <RailButton
        label="Create a server"
        active={false}
        onClick={() => setDialog('create')}
        idleTextClasses="text-slate-500"
        activeClasses="bg-white/[0.07] text-slate-100"
      >
        <PlusIcon className="h-6 w-6" />
      </RailButton>

      <RailButton
        label="Join a server"
        active={false}
        onClick={() => setDialog('join')}
        idleTextClasses="text-slate-500"
        activeClasses="bg-white/[0.07] text-slate-100"
      >
        <CompassIcon className="h-6 w-6" />
      </RailButton>

      {dialog !== 'none' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={dialog === 'create' ? 'Create a server' : 'Join a server'}
          className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4"
          onClick={() => setDialog('none')}
        >
          <div
            className="w-full max-w-md animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 p-6 text-left shadow-pop"
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
              placeholder={dialog === 'create' ? "Ayaan's server" : 'nexora-team'}
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
                className="cursor-pointer px-4 py-2 text-sm text-slate-200 hover:underline"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="cursor-pointer rounded-lg bg-accent px-6 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-60"
              >
                {busy ? 'Working…' : dialog === 'create' ? 'Create' : 'Join'}
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
  idleTextClasses = 'text-slate-200',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  activeClasses: string;
  idleTextClasses?: string;
}): JSX.Element {
  return (
    <div className="group relative flex w-full justify-center">
      {/* The marker is the only thing that moves, and it grows out of the edge
          rather than sliding in from nowhere: a hover shows a stub of it, so
          the active state and the "you could be here" state are visibly the
          same object at two lengths. */}
      <span
        aria-hidden="true"
        className={`absolute -left-0.5 top-1/2 w-[3px] -translate-y-1/2 rounded-full bg-accent transition-[height,opacity] duration-200 ease-out ${
          active ? 'h-5 opacity-100' : 'h-2 opacity-0 group-hover:opacity-60'
        }`}
      />
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-current={active ? 'true' : undefined}
        // No focus ring here: the marker on the left edge already says where
        // you are, and a second ring around a 40px tile is all noise.
        className={`flex h-10 w-10 cursor-pointer items-center justify-center overflow-hidden rounded-lg outline-none ring-0 transition-colors duration-150 focus:ring-0 focus-visible:ring-0 active:scale-[0.96] ${
          active
            ? activeClasses
            : `hover:bg-white/[0.07] hover:text-slate-100 ${idleTextClasses}`
        }`}
      >
        {children}
      </button>
    </div>
  );
}
