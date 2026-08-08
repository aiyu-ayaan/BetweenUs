import { useEffect, useState } from 'react';
import type { AdminOAuthProvider } from '@nexora/shared-types';
import { api } from '../api';
import { messageOf } from '../App';

/**
 * Google and GitHub sign-in, configured here rather than in the environment.
 * Turning a provider on makes its button appear on every client's login screen.
 */
export function OAuthScreen(): JSX.Element {
  const [providers, setProviders] = useState<AdminOAuthProvider[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .oauthProviders()
      .then(setProviders)
      .catch((caught: unknown) => setError(messageOf(caught)));
  }, []);

  return (
    <section className="space-y-6">
      {error && (
        <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {providers.map((provider) => (
        <ProviderCard
          key={provider.provider}
          provider={provider}
          onSaved={(saved) =>
            setProviders((current) =>
              current.map((item) => (item.provider === saved.provider ? saved : item)),
            )
          }
        />
      ))}
    </section>
  );
}

function ProviderCard({
  provider,
  onSaved,
}: {
  provider: AdminOAuthProvider;
  onSaved: (provider: AdminOAuthProvider) => void;
}): JSX.Element {
  const [clientId, setClientId] = useState(provider.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [enabled, setEnabled] = useState(provider.enabled);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      // An empty secret field means "keep the stored one" - it can never be
      // shown back, so the form has to be savable without retyping it.
      const saved = await api.updateOAuthProvider(provider.provider, {
        enabled,
        clientId: clientId.trim(),
        ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
      });
      setClientSecret('');
      setStatus('Saved.');
      onSaved(saved);
    } catch (caught) {
      setError(messageOf(caught));
      setEnabled(provider.enabled);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-lg border border-surface-700 bg-surface-800 p-6">
      <header className="mb-4 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-50">{provider.label}</h2>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            provider.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-surface-700 text-slate-400'
          }`}
        >
          {provider.enabled ? 'enabled' : 'disabled'}
        </span>
      </header>

      <p className="mb-4 text-sm text-slate-400">
        Add this as the authorised redirect URI in the {provider.label} console:
      </p>
      <pre className="mb-5 overflow-x-auto rounded bg-surface-950 px-3 py-2 font-mono text-xs text-emerald-300">
        {provider.callbackUrl}
      </pre>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`${provider.provider}-id`}
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            Client ID
          </label>
          <input
            id={`${provider.provider}-id`}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            className="w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-slate-100 focus:border-accent"
          />
        </div>

        <div>
          <label
            htmlFor={`${provider.provider}-secret`}
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            Client secret
          </label>
          <input
            id={`${provider.provider}-secret`}
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder={provider.hasSecret ? 'Stored - leave blank to keep' : 'Required'}
            className="w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-accent"
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 cursor-pointer accent-accent"
          />
          Offer {provider.label} sign-in
        </label>

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>

        {status && <span className="text-sm text-emerald-300">{status}</span>}
        {error && (
          <span role="alert" className="text-sm text-red-300">
            {error}
          </span>
        )}
      </div>
    </article>
  );
}
