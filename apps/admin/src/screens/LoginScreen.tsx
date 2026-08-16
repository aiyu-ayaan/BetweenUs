import { useEffect, useState, type FormEvent } from 'react';
import type { OAuthProviderSummary, PublicUser } from '@nexora/shared-types';
import { api } from '../api';
import { adminOnly, messageOf } from '../App';

export function LoginScreen({
  onSignedIn,
  initialError,
}: {
  onSignedIn: (user: PublicUser) => void;
  /** A provider round trip that came back refused; it happened before this screen. */
  initialError?: string | null;
}): JSX.Element {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<OAuthProviderSummary[]>([]);

  // Providers are whatever the operator switched on, so the buttons are drawn
  // from the server rather than hard-coded; none configured means none shown.
  useEffect(() => {
    api
      .signInProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.login(identifier.trim(), password);
      const refused = adminOnly(result);
      if (refused) {
        setError(refused);
        return;
      }
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

        {providers.length > 0 && (
          <>
            <p className="my-4 text-center text-xs uppercase tracking-wide text-slate-500">or</p>
            {providers.map((provider) => (
              <a
                key={provider.provider}
                // A full navigation, not fetch: the provider's own screen has to
                // be a real browser page the person can see the address of.
                href={api.signInUrl(provider.provider)}
                className="mb-2 block rounded-md border border-surface-700 px-4 py-2.5 text-center text-slate-200 transition-colors duration-200 hover:border-accent"
              >
                Continue with {provider.label}
              </a>
            ))}
          </>
        )}
      </form>
    </div>
  );
}
