import { useState, type FormEvent } from 'react';
import type { PublicUser } from '@nexora/shared-types';
import { api, session } from '../api';
import { messageOf } from '../App';

export function LoginScreen({
  onSignedIn,
}: {
  onSignedIn: (user: PublicUser) => void;
}): JSX.Element {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(identifier.trim(), password);
      if (result.user.role !== 'ADMIN') {
        // Signed in fine, but this is not their door.
        session.end();
        setError('That account is not an administrator.');
        return;
      }
      session.start(result);
      onSignedIn(result.user);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-surface-800 p-8 shadow-2xl" noValidate>
        <h1 className="mb-1 text-2xl font-semibold text-slate-50">Nexora Admin</h1>
        <p className="mb-6 text-sm text-slate-400">Sign in with your administrator account.</p>

        <label htmlFor="identifier" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Username or email
        </label>
        <input
          id="identifier"
          autoFocus
          autoComplete="username"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          className="mb-4 w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-accent"
          placeholder="nexoraadmin"
        />

        <label htmlFor="password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-slate-100 focus:border-accent"
        />

        {error && (
          <p role="alert" className="mt-4 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
