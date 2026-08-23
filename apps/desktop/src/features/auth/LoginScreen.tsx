import { useEffect, useState, type FormEvent } from 'react';
import type { OAuthProviderSummary } from '@betweenus/shared-types';
import { rememberedEmail, useAuthStore } from '../../stores/auth';
import { api } from '../../services/api';
import { GlobeIcon, BetweenUsLogoIcon } from '../../components/icons';
import { ServerPicker, serverLabel } from './ServerPicker';

export function LoginScreen(): JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [pickingServer, setPickingServer] = useState(false);
  // Signing in again on this machine should not mean typing the address again.
  const [email, setEmail] = useState(rememberedEmail);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  /** Empty until the server answers; nothing is offered that is not configured. */
  const [providers, setProviders] = useState<OAuthProviderSummary[]>([]);

  const { login, loginWithProvider, register, status, error, clearError } = useAuthStore();
  const busy = status === 'loading';

  useEffect(() => {
    void api
      .oauthProviders()
      .then(setProviders)
      // A server that cannot answer just means no provider buttons.
      .catch(() => setProviders([]));
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (mode === 'login') await login(email, password);
    else await register(email, username, password);
  };

  return (
    <div className="relative flex h-full items-center justify-center bg-ground px-4">
      {/* The window has no native title bar, and this screen has no top bar of
          its own, so without this strip there is nowhere to grab the window. */}
      <div className="drag-region absolute inset-x-0 top-0 h-10" />
      <div className="w-full max-w-md animate-pop rounded-2xl border border-edge bg-surface-900 p-8 shadow-pop">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-edge bg-accent/15 p-2.5">
            <BetweenUsLogoIcon className="h-full w-full text-accent" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-50">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {mode === 'login'
              ? 'Sign in to continue to BetweenUs'
              : 'Pick a username your teammates will see'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
              {mode === 'login' ? 'Email or username' : 'Email'}
            </label>
            {/*
              Signing in takes either, and the server has accepted either all
              along - it is the same field, and an address contains an @ where a
              username may not. What did not take either was this input: `email`
              asks the browser for an address, offers only addresses to autofill,
              and puts an address keyboard on a phone. Registering still asks
              for an address, because that one really is one.
            */}
            <input
              id="email"
              type={mode === 'login' ? 'text' : 'email'}
              required
              autoComplete={mode === 'login' ? 'username' : 'email'}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                clearError();
              }}
              className="w-full rounded-md border border-edge bg-surface-950 px-3 py-2 text-slate-100 placeholder-slate-500 transition-colors duration-200 focus:border-accent"
              placeholder={mode === 'login' ? 'you@example.com or ayaan' : 'you@example.com'}
            />
          </div>

          {mode === 'register' && (
            <div>
              <label
                htmlFor="username"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                required
                minLength={3}
                maxLength={32}
                autoComplete="username"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  clearError();
                }}
                className="w-full rounded-md border border-edge bg-surface-950 px-3 py-2 text-slate-100 placeholder-slate-500 transition-colors duration-200 focus:border-accent"
                placeholder="ayaan"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearError();
              }}
              className="w-full rounded-md border border-edge bg-surface-950 px-3 py-2 text-slate-100 placeholder-slate-500 transition-colors duration-200 focus:border-accent"
              placeholder="At least 8 characters"
            />
            {mode === 'register' && (
              <p className="mt-1 text-xs text-slate-500">Must contain a letter and a number.</p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {providers.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-white/10" />
              <span className="text-xs uppercase tracking-wide text-slate-500">or continue with</span>
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <div className="space-y-2">
              {providers.map((provider) => (
                <button
                  key={provider.provider}
                  type="button"
                  disabled={busy}
                  onClick={() => void loginWithProvider(provider.provider)}
                  className="w-full cursor-pointer rounded-md border border-edge bg-surface-950 px-4 py-2.5 font-medium text-slate-100 transition-colors duration-200 hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Continue with {provider.label}
                </button>
              ))}
            </div>

            <p className="mt-2 text-center text-xs text-slate-500">
              Opens your browser; come back here when it is done.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            clearError();
          }}
          className="mt-4 w-full cursor-pointer text-sm text-slate-400 transition-colors duration-200 hover:text-slate-200"
        >
          {mode === 'login' ? 'Need an account? Register' : 'Already registered? Sign in'}
        </button>

        {/* Which deployment this is. BetweenUs is meant to be self-hosted, so the
            address is worth showing even when nobody wants to change it. */}
        <div className="mt-6 border-t border-edge pt-4">
          <button
            type="button"
            onClick={() => setPickingServer(true)}
            className="mx-auto flex cursor-pointer items-center gap-2 text-sm text-slate-400 transition-colors duration-200 hover:text-slate-200"
          >
            <GlobeIcon className="h-4 w-4" />
            Connect to a self-hosted instance
          </button>
          <p className="mt-1.5 text-center text-xs text-slate-500">
            Signing in to <span className="text-slate-400">{serverLabel()}</span>
          </p>
        </div>
      </div>

      {pickingServer && <ServerPicker onClose={() => setPickingServer(false)} />}
    </div>
  );
}
