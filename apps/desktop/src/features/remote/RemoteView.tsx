import { useEffect, useState } from 'react';
import type {
  RemoteAuditEntry,
  RemoteGrantSummary,
  RemoteMachineSummary,
  RemotePermission,
  UserSummary,
} from '@betweenus/shared-types';
import { useRemoteStore } from '../../stores/remote';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../services/api';
import { Avatar } from '../../components/Avatar';
import { MenuIcon, MonitorIcon, ShieldIcon, XIcon } from '../../components/icons';
import { SkeletonRows } from '../../components/Skeleton';
import { listState } from '../../services/list-state';

/** Labels, and the order they read in: what you can see, then what you can do. */
const PERMISSION_LABELS: Array<{ id: RemotePermission; label: string; hint: string }> = [
  { id: 'REMOTE_VIEW', label: 'View the screen', hint: 'Always needed; everything else adds to it' },
  { id: 'REMOTE_CONTROL', label: 'Mouse and keyboard', hint: 'Full control of the machine' },
  { id: 'REMOTE_CLIPBOARD', label: 'Clipboard', hint: 'Copy and paste in both directions' },
  {
    id: 'REMOTE_FILE_TRANSFER',
    label: 'File transfer',
    hint: 'Send files to the machine; they land in its downloads folder',
  },
  { id: 'REMOTE_AUDIO', label: 'Audio', hint: "Hear the machine's own sound" },
  { id: 'REMOTE_ADMIN', label: 'Manage access', hint: 'Hand this machine out to other people' },
];

export function RemoteView({ onOpenMenu }: { onOpenMenu?: () => void } = {}): JSX.Element {
  const machines = useRemoteStore((state) => state.machines);
  const loading = useRemoteStore((state) => state.loading);
  const error = useRemoteStore((state) => state.error);
  const load = useRemoteStore((state) => state.load);
  const connect = useRemoteStore((state) => state.connect);

  const [managing, setManaging] = useState<RemoteMachineSummary | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // A live session is drawn over the whole window by `App`, not here: it can be
  // started from a screen share in a voice channel too, and that has no machine
  // list to take over.
  return (
    <div className="panel flex min-w-0 flex-1 flex-col bg-surface-900">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-2.5 md:px-4">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            title="Open menu"
            className="flex h-9 w-9 min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md text-slate-300 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 md:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        )}
        <MonitorIcon className="h-5 w-5 text-slate-400" />
        <h1 className="font-semibold text-slate-100">Remote machines</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="ms-auto cursor-pointer rounded px-3 py-1.5 text-sm text-slate-300 transition-colors duration-200 hover:bg-white/[0.1] min-h-[36px]"
        >
          Refresh
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {error && (
          <p role="alert" className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {/* The first list this screen draws is a fetch away, and it used to be
            drawn as nothing at all - a blank panel with a Refresh button, which
            reads as a screen that failed rather than one that is working. */}
        {listState(machines.length, loading) === 'loading' && (
          <SkeletonRows rows={3} label="Loading machines" className="mx-auto max-w-md pt-8" />
        )}

        {listState(machines.length, loading) === 'empty' && (
          <div className="mx-auto max-w-md pt-16 text-center">
            <MonitorIcon className="mx-auto h-10 w-10 text-slate-600" />
            <h2 className="mt-3 text-lg font-semibold text-slate-200">No machines yet</h2>
            <p className="mt-2 text-sm text-slate-400">
              Turn on <span className="text-slate-200">Allow remote access</span> in Settings →
              Remote on a machine to enrol it. It appears here, on every device you sign in on.
            </p>
          </div>
        )}

        <ul className="space-y-3">
          {machines.map((machine) => (
            <li
              key={machine.id}
              className="flex items-center gap-4 rounded-lg bg-surface-800 px-4 py-3"
            >
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  machine.online ? 'bg-status-online' : 'bg-status-offline'
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-100">{machine.name}</p>
                <p className="truncate text-xs text-slate-400">
                  {machine.platform} · {machine.ownerUsername}
                  {machine.online ? ' · online' : lastSeen(machine.lastSeenAt)}
                  {machine.expiresAt ? ` · access until ${formatWhen(machine.expiresAt)}` : ''}
                </p>
              </div>

              <span className="hidden text-xs text-slate-500 sm:block">
                {machine.permissions.includes('REMOTE_CONTROL') ? 'Control' : 'View only'}
              </span>

              {(machine.permissions.includes('REMOTE_ADMIN') ||
                machine.ownerId === useAuthStore.getState().user?.id) && (
                <button
                  type="button"
                  onClick={() => setManaging(machine)}
                  className="cursor-pointer rounded bg-white/[0.07] px-3 py-1.5 text-sm text-slate-200 transition-colors duration-200 hover:bg-white/[0.1]"
                >
                  Access
                </button>
              )}

              <button
                type="button"
                disabled={!machine.online}
                onClick={() => void connect(machine.id)}
                className="cursor-pointer rounded bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Connect
              </button>
            </li>
          ))}
        </ul>
      </div>

      {managing && (
        <AccessDialog
          machine={managing}
          onClose={() => {
            setManaging(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Who may reach this machine, and what they may do once they are on it.
 *
 * Everything here is one call per person: a permission set and an optional
 * expiry, replaced wholesale. Unticking everything is the revocation, which is
 * also what ends a session that person is holding right now.
 */
function AccessDialog({
  machine,
  onClose,
}: {
  machine: RemoteMachineSummary;
  onClose: () => void;
}): JSX.Element {
  const [grants, setGrants] = useState<RemoteGrantSummary[]>([]);
  const [audit, setAudit] = useState<RemoteAuditEntry[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [tab, setTab] = useState<'people' | 'audit'>('people');

  useEffect(() => {
    void api.machineGrants(machine.id).then(setGrants).catch(() => undefined);
    void api.machineAudit(machine.id).then(setAudit).catch(() => undefined);
  }, [machine.id]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .searchUsers(query.trim())
        .then((found) =>
          setResults(
            found.filter(
              (user) =>
                user.id !== machine.ownerId && !grants.some((grant) => grant.userId === user.id),
            ),
          ),
        )
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, grants, machine.ownerId]);

  const save = async (
    userId: string,
    permissions: RemotePermission[],
    expiresAt: string | null,
  ): Promise<void> => {
    setNote(null);
    try {
      setGrants(await api.setMachineGrant(machine.id, userId, permissions, expiresAt));
      setQuery('');
      setAudit(await api.machineAudit(machine.id));
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That could not be saved');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl animate-pop flex-col rounded-xl border border-edge bg-surface-900 shadow-pop">
        <header className="flex items-center gap-3 border-b border-edge px-5 py-4">
          <ShieldIcon className="h-5 w-5 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-50">{machine.name}</h2>
            <p className="text-xs text-slate-400">
              Remote access is granted per person and never comes from a server role.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex gap-1 border-b border-edge px-5 py-2">
          {(['people', 'audit'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              aria-current={tab === entry ? 'page' : undefined}
              className={`cursor-pointer rounded px-3 py-1 text-sm transition-colors duration-200 ${
                tab === entry ? 'bg-surface-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {entry === 'people' ? 'People' : 'History'}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {note && (
            <p role="alert" className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {note}
            </p>
          )}

          {tab === 'people' ? (
            <>
              <label htmlFor="remote-search" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Give someone access
              </label>
              <input
                id="remote-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by username"
                className="w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-slate-100 placeholder-slate-500 transition-colors duration-200 focus:border-accent"
              />
              {results.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {results.map((user) => (
                    <li key={user.id}>
                      <button
                        type="button"
                        onClick={() => void save(user.id, ['REMOTE_VIEW'], null)}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-start transition-colors duration-200 hover:bg-white/[0.06]"
                      >
                        <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-100">
                          {user.displayName}
                          <span className="ms-1 text-slate-500">@{user.username}</span>
                        </span>
                        <span className="text-xs text-slate-400">Add as viewer</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5 space-y-4">
                {grants.length === 0 && (
                  <p className="text-sm text-slate-400">
                    Nobody else can reach this machine. You can, because you own it.
                  </p>
                )}
                {grants.map((grant) => (
                  <GrantRow key={grant.userId} grant={grant} onSave={save} />
                ))}
              </div>
            </>
          ) : (
            <ol className="space-y-2">
              {audit.length === 0 && <p className="text-sm text-slate-400">Nothing yet.</p>}
              {audit.map((entry) => (
                <li key={entry.id} className="rounded bg-surface-850 px-3 py-2 text-sm">
                  <span className="text-slate-200">{entry.action}</span>
                  {entry.actorUsername && (
                    <span className="text-slate-400"> · {entry.actorUsername}</span>
                  )}
                  <span className="ms-2 text-xs text-slate-500">{formatWhen(entry.createdAt)}</span>
                  {entry.detail && (
                    <pre className="mt-1 overflow-x-auto text-xs text-slate-500">
                      {JSON.stringify(entry.detail)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function GrantRow({
  grant,
  onSave,
}: {
  grant: RemoteGrantSummary;
  onSave: (
    userId: string,
    permissions: RemotePermission[],
    expiresAt: string | null,
  ) => Promise<void>;
}): JSX.Element {
  const toggle = (permission: RemotePermission): void => {
    const next = grant.permissions.includes(permission)
      ? grant.permissions.filter((value) => value !== permission)
      : [...grant.permissions, permission];
    void onSave(grant.userId, next, grant.expiresAt);
  };

  return (
    <div className="rounded-lg bg-surface-850 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={grant.displayName} avatarUrl={grant.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">{grant.displayName}</p>
          <p className="truncate text-xs text-slate-500">@{grant.username}</p>
        </div>
        <button
          type="button"
          onClick={() => void onSave(grant.userId, [], null)}
          className="cursor-pointer rounded px-2 py-1 text-xs text-red-300 transition-colors duration-200 hover:bg-red-500/10"
        >
          Revoke
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        {PERMISSION_LABELS.map((permission) => (
          <label
            key={permission.id}
            className="flex cursor-pointer items-start gap-2 text-sm text-slate-300"
          >
            <input
              type="checkbox"
              checked={grant.permissions.includes(permission.id)}
              onChange={() => toggle(permission.id)}
              className="mt-1 cursor-pointer accent-[color:var(--accent,#5865f2)]"
            />
            <span>
              {permission.label}
              <span className="block text-xs text-slate-500">{permission.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <label className="mt-3 block text-xs text-slate-400">
        Access until
        <input
          type="datetime-local"
          defaultValue={toLocalInput(grant.expiresAt)}
          onChange={(event) =>
            void onSave(
              grant.userId,
              grant.permissions,
              event.target.value ? new Date(event.target.value).toISOString() : null,
            )
          }
          className="mt-1 block w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-1.5 text-sm text-slate-100"
        />
        <span className="mt-1 block text-slate-500">Empty means it does not expire.</span>
      </label>
    </div>
  );
}

function lastSeen(iso: string | null): string {
  if (!iso) return ' · never connected';
  return ` · last seen ${formatWhen(iso)}`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** `datetime-local` wants a local, second-less ISO string, or nothing at all. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
