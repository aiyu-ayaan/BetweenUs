/**
 * Admin panel shell.
 *
 * Four states, in order: no administrator exists yet (explain the CLI), signed
 * out, signed in but still on a generated password, and the panel proper.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PublicUser } from '@nexora/shared-types';
import { ApiError, api, refreshSession, session } from './api';
import { LoginScreen } from './screens/LoginScreen';
import { BootstrapScreen } from './screens/BootstrapScreen';
import { ChangePasswordScreen } from './screens/ChangePasswordScreen';
import { UsersScreen } from './screens/UsersScreen';
import { OAuthScreen } from './screens/OAuthScreen';
import { AccountScreen } from './screens/AccountScreen';

type Tab = 'users' | 'oauth' | 'account';

export default function App(): JSX.Element {
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>('users');

  const load = useCallback(async (): Promise<void> => {
    const status = await api.status().catch(() => ({ hasAdmin: true }));
    setHasAdmin(status.hasAdmin);

    // A stored refresh token is worth one attempt; anything else means signed out.
    if (session.refreshToken) {
      try {
        if (await refreshSession()) setUser(await api.me());
      } catch {
        session.end();
      }
    }
    setBooting(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async (): Promise<void> => {
    const stored = session.refreshToken;
    session.end();
    setUser(null);
    if (stored) await api.logout(stored).catch(() => undefined);
  };

  if (booting) {
    return (
      <div className="grid h-full place-items-center" aria-busy="true">
        <p className="animate-pulse text-lg font-semibold text-slate-300">Nexora Admin</p>
      </div>
    );
  }

  if (hasAdmin === false && !user) return <BootstrapScreen onRetry={load} />;
  if (!user) return <LoginScreen onSignedIn={setUser} />;
  if (user.mustChangePassword) return <ChangePasswordScreen user={user} onDone={setUser} />;

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col px-6 py-6">
      <header className="mb-6 flex items-center gap-4">
        <h1 className="text-xl font-semibold text-slate-50">Nexora Admin</h1>

        <nav className="ml-6 flex gap-1" aria-label="Sections">
          {(
            [
              ['users', 'Users'],
              ['oauth', 'Sign-in providers'],
              ['account', 'My account'],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors duration-200 ${
                tab === key
                  ? 'bg-surface-800 text-slate-50'
                  : 'text-slate-400 hover:bg-surface-800/60 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm text-slate-400">
          <span>@{user.username}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="cursor-pointer rounded-md border border-surface-700 px-3 py-1.5 transition-colors duration-200 hover:border-red-500 hover:text-red-300"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'users' && <UsersScreen currentUserId={user.id} />}
        {tab === 'oauth' && <OAuthScreen />}
        {tab === 'account' && <AccountScreen user={user} onUpdated={setUser} />}
      </main>
    </div>
  );
}

/** Shared by the screens: an API error is a message, anything else is generic. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Could not reach the server.';
}
