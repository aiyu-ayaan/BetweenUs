import { useState } from 'react';
import { useChatStore } from '../../stores/chat';
import { CompassIcon, PlusIcon } from '../../components/icons';

/** Left rail of workspace pills, Discord-style. */
export function WorkspaceRail(): JSX.Element {
  const { workspaces, activeWorkspaceId, selectWorkspace, createWorkspace, joinWorkspace } =
    useChatStore();
  const [dialog, setDialog] = useState<'none' | 'create' | 'join'>('none');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (dialog === 'create') await createWorkspace(trimmed);
      else await joinWorkspace(trimmed);
      setDialog('none');
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav
      aria-label="Workspaces"
      className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-surface-950 py-3"
    >
      {workspaces.map((workspace) => {
        const active = workspace.id === activeWorkspaceId;
        return (
          <button
            key={workspace.id}
            type="button"
            onClick={() => void selectWorkspace(workspace.id)}
            title={workspace.name}
            aria-label={workspace.name}
            aria-current={active ? 'true' : undefined}
            className={`flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl text-sm font-semibold transition-colors duration-200 ${
              active
                ? 'rounded-xl bg-accent text-white'
                : 'bg-surface-800 text-slate-300 hover:bg-accent hover:text-white'
            }`}
          >
            {initials(workspace.name)}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => setDialog('create')}
        aria-label="Create workspace"
        title="Create workspace"
        className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl bg-surface-800 text-emerald-400 transition-colors duration-200 hover:bg-emerald-500 hover:text-white"
      >
        <PlusIcon className="h-5 w-5" />
      </button>

      <button
        type="button"
        onClick={() => setDialog('join')}
        aria-label="Join workspace by slug"
        title="Join workspace"
        className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl bg-surface-800 text-slate-300 transition-colors duration-200 hover:bg-accent hover:text-white"
      >
        <CompassIcon className="h-5 w-5" />
      </button>

      {dialog !== 'none' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={dialog === 'create' ? 'Create workspace' : 'Join workspace'}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setDialog('none')}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-surface-800 p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">
              {dialog === 'create' ? 'Create a workspace' : 'Join a workspace'}
            </h2>
            <label htmlFor="workspace-input" className="mt-4 block text-xs uppercase text-slate-400">
              {dialog === 'create' ? 'Workspace name' : 'Workspace slug'}
            </label>
            <input
              id="workspace-input"
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
                if (event.key === 'Escape') setDialog('none');
              }}
              className="mt-1 w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 transition-colors duration-200 focus:border-accent"
              placeholder={dialog === 'create' ? 'Nexora Team' : 'nexora-team'}
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog('none')}
                className="cursor-pointer rounded-md px-4 py-2 text-sm text-slate-300 transition-colors duration-200 hover:bg-surface-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:opacity-60"
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
