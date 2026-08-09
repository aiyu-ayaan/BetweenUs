import { useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { CompassIcon, NexoraLogoIcon, PlusIcon } from '../../components/icons';
import { ServerIcon } from '../../components/ServerIcon';

/**
 * The left rail: direct messages at the top, then one pill per server. The
 * active pill grows a marker on the left edge, which is how Discord shows where
 * you are without spending any horizontal space on it.
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
      className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-surface-950 py-3"
    >
      <RailButton
        label="Direct messages"
        active={view === 'home'}
        onClick={showHome}
        activeClasses="bg-accent text-white"
      >
        <NexoraLogoIcon className="h-7 w-7" />
      </RailButton>

      <hr className="w-8 border-t-2 border-surface-800" />

      {servers.map((server) => (
        <RailButton
          key={server.id}
          label={server.name}
          active={view === 'server' && server.id === activeServerId}
          onClick={() => void selectServer(server.id)}
          activeClasses="bg-accent text-white"
        >
          <ServerIcon server={server} />
        </RailButton>
      ))}

      <RailButton
        label="Create a server"
        active={false}
        onClick={() => setDialog('create')}
        idleTextClasses="text-status-online"
        activeClasses="bg-status-online text-white"
      >
        <PlusIcon className="h-6 w-6" />
      </RailButton>

      <RailButton
        label="Join a server"
        active={false}
        onClick={() => setDialog('join')}
        idleTextClasses="text-status-online"
        activeClasses="bg-status-online text-white"
      >
        <CompassIcon className="h-6 w-6" />
      </RailButton>

      {dialog !== 'none' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={dialog === 'create' ? 'Create a server' : 'Join a server'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setDialog('none')}
        >
          <div
            className="w-full max-w-md rounded-lg bg-surface-800 p-6 text-left"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-2xl font-bold text-slate-50">
              {dialog === 'create' ? 'Create a server' : 'Join a server'}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {dialog === 'create'
                ? 'Your server is where you and your people hang out. Make one and start talking.'
                : 'Enter the invite slug someone sent you.'}
            </p>

            <label
              htmlFor="server-input"
              className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-300"
            >
              {dialog === 'create' ? 'Server name' : 'Invite slug'}
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
              className="mt-2 w-full rounded bg-surface-950 px-3 py-2.5 text-slate-100 outline-none ring-0 focus:ring-2 focus:ring-accent"
              placeholder={dialog === 'create' ? "Ayaan's server" : 'nexora-team'}
            />

            {failure && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {failure}
              </p>
            )}

            <div className="-mx-6 -mb-6 mt-6 flex justify-end gap-3 rounded-b-lg bg-surface-850 px-6 py-4">
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
                className="cursor-pointer rounded bg-accent px-6 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:opacity-60"
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
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r bg-white transition-all duration-200 ${
          active ? 'h-10' : 'h-2 opacity-0 group-hover:opacity-100'
        }`}
      />
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-current={active ? 'true' : undefined}
        // No focus ring here: the pill already says where you are with the
        // marker on the left edge, and a ring around a circle reads as a stray
        // blue square.
        className={`flex h-12 w-12 cursor-pointer items-center justify-center overflow-hidden outline-none ring-0 focus:ring-0 focus-visible:ring-0 transition-all duration-200 ${
          active
            ? `rounded-2xl ${activeClasses}`
            : `rounded-[24px] bg-surface-800 hover:rounded-2xl hover:bg-accent hover:text-white ${idleTextClasses}`
        }`}
      >
        {children}
      </button>
    </div>
  );
}
