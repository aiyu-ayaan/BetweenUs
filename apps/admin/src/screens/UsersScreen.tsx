import { useEffect, useState } from 'react';
import type { AdminUser } from '@nexora/shared-types';
import { api } from '../api';
import { messageOf } from '../App';

/** Every account on the platform: who they are, and what may be done to them. */
export function UsersScreen({ currentUserId }: { currentUserId: string }): JSX.Element {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Typing in the search box should not fire a request per keystroke.
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .users(query)
        .then((result) => {
          setUsers(result);
          setError(null);
        })
        .catch((caught: unknown) => setError(messageOf(caught)))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const act = async (action: Promise<AdminUser | void>, userId: string): Promise<void> => {
    setError(null);
    try {
      const updated = await action;
      setUsers((current) =>
        updated
          ? current.map((user) => (user.id === userId ? updated : user))
          : current.filter((user) => user.id !== userId),
      );
    } catch (caught) {
      setError(messageOf(caught));
    }
  };

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search users"
          placeholder="Search by name, username or email"
          className="w-80 rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-accent"
        />
        <span className="text-sm text-slate-500">
          {loading ? 'Loading…' : `${users.length} account${users.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-surface-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-800 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-3">User</th>
              <th scope="col" className="px-4 py-3">Sign-in</th>
              <th scope="col" className="px-4 py-3">Servers</th>
              <th scope="col" className="px-4 py-3">Joined</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-surface-700/60">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-100">{user.displayName}</div>
                  <div className="text-xs text-slate-500">
                    @{user.username} · {user.email}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {user.identities.length > 0 ? user.identities.join(', ') : 'password'}
                </td>
                <td className="px-4 py-3 text-slate-400">{user.serverCount}</td>
                <td className="px-4 py-3 text-slate-400">
                  {new Date(user.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {user.role === 'ADMIN' && <Badge tone="accent">admin</Badge>}
                    {user.disabledAt && <Badge tone="danger">disabled</Badge>}
                    {user.mustChangePassword && <Badge tone="muted">password pending</Badge>}
                    {user.id === currentUserId && <Badge tone="muted">you</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Action
                      onClick={() =>
                        void act(
                          api.updateUser(user.id, {
                            role: user.role === 'ADMIN' ? 'USER' : 'ADMIN',
                          }),
                          user.id,
                        )
                      }
                    >
                      {user.role === 'ADMIN' ? 'Revoke admin' : 'Make admin'}
                    </Action>
                    <Action
                      onClick={() =>
                        void act(
                          api.updateUser(user.id, { disabled: user.disabledAt === null }),
                          user.id,
                        )
                      }
                    >
                      {user.disabledAt ? 'Enable' : 'Disable'}
                    </Action>
                    <Action
                      danger
                      onClick={() => {
                        // Deletion cascades through messages and memberships.
                        if (!confirm(`Delete ${user.username}? This cannot be undone.`)) return;
                        void act(api.deleteUser(user.id), user.id);
                      }}
                    >
                      Delete
                    </Action>
                  </div>
                </td>
              </tr>
            ))}

            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No accounts match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'accent' | 'danger' | 'muted';
  children: string;
}): JSX.Element {
  const tones = {
    accent: 'bg-accent/15 text-accent',
    danger: 'bg-red-500/15 text-red-300',
    muted: 'bg-surface-700 text-slate-300',
  } as const;
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

function Action({
  children,
  onClick,
  danger,
}: {
  children: string;
  onClick: () => void;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded border border-surface-700 px-2 py-1 text-xs transition-colors duration-200 ${
        danger ? 'text-red-300 hover:border-red-500' : 'text-slate-300 hover:border-accent'
      }`}
    >
      {children}
    </button>
  );
}
