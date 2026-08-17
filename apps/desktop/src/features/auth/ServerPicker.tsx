import { useState, type FormEvent } from 'react';
import {
  defaultServerUrl,
  forgetServer,
  isDefaultServer,
  normalizeServerUrl,
  probeServer,
  recentServers,
  serverUrl,
  setServerUrl,
} from '../../services/endpoint';
import { useAuthStore } from '../../stores/auth';
import { GlobeIcon, XIcon } from '../../components/icons';

/**
 * Points this window at a different deployment.
 *
 * Nexora is meant to be self-hosted, so the address the build shipped with is a
 * default and not a decision. The address is checked before it is stored - a
 * typo should be a line under the field, not an app that no longer starts.
 *
 * Switching signs the window out: tokens, device keys and every id in them
 * belong to the deployment that issued them, and none of it means anything on
 * another one. The window then reloads, which is the honest way to get every
 * store, socket and cache to let go of the old server at once.
 */
export function ServerPicker({ onClose }: { onClose: () => void }): JSX.Element {
  const [address, setAddress] = useState(serverUrl);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Everywhere this client has been, minus wherever it is now - offering to
  // connect to the address you are already on is a button that does nothing.
  const [recent, setRecent] = useState(() =>
    recentServers().filter((url) => url !== serverUrl()),
  );

  const signedIn = useAuthStore((state) => state.status) === 'authenticated';

  const connect = async (raw: string): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      // What the probe answers on, not what was typed: a redirect to another
      // origin would strip the Authorization header off every later request.
      const base = await probeServer(normalizeServerUrl(raw));

      // Ends the session on the server we are leaving, while we can still
      // reach it; a no-op when nobody is signed in.
      await useAuthStore.getState().logout();
      setServerUrl(base === defaultServerUrl() ? null : base);
      window.location.reload();
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That address did not work');
      setBusy(false);
    }
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void connect(address);
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md animate-pop rounded-xl border border-edge bg-surface-900 p-6 shadow-pop">
        <div className="mb-4 flex items-start gap-3">
          <GlobeIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-50">Connect to a server</h2>
            <p className="mt-1 text-sm text-slate-400">
              The address of the Nexora deployment this app talks to. Everything else - chat,
              voice, files - is behind it.
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
        </div>

        <form onSubmit={submit} className="space-y-3" noValidate>
          <label
            htmlFor="server-url"
            className="block text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            Server address
          </label>
          <input
            id="server-url"
            type="text"
            autoFocus
            spellCheck={false}
            autoComplete="url"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setNote(null);
            }}
            className="w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-slate-100 placeholder-slate-500 transition-colors duration-200 focus:border-accent"
            placeholder="nexora.example.com"
          />
          <p className="text-xs text-slate-500">
            No http:// means https://. This one is currently{' '}
            <span className="text-slate-300">{serverUrl()}</span>
            {isDefaultServer() && ', the default this app was built with'}.
          </p>

          {recent.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recently connected
              </p>
              <ul className="mt-2 space-y-1">
                {recent.map((url) => (
                  <li key={url} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        // Filled in rather than connected to: one click away
                        // from signing out of the server you are on is one
                        // click too few.
                        setAddress(url);
                        setNote(null);
                      }}
                      className="min-w-0 flex-1 cursor-pointer truncate rounded-md bg-surface-800 px-3 py-1.5 text-left text-sm text-slate-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-slate-100 disabled:opacity-60"
                    >
                      {url}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Forget ${url}`}
                      title="Forget this address"
                      onClick={() => {
                        forgetServer(url);
                        setRecent((list) => list.filter((item) => item !== url));
                      }}
                      className="cursor-pointer rounded-md p-1.5 text-slate-500 transition-colors duration-150 hover:text-danger disabled:opacity-60"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {signedIn && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Connecting somewhere else signs you out of this server.
            </p>
          )}

          {note && (
            <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {note}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'Connect'}
          </button>
        </form>

        {!isDefaultServer() && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void connect(defaultServerUrl())}
            className="mt-3 w-full cursor-pointer text-sm text-slate-400 transition-colors duration-200 hover:text-slate-200 disabled:opacity-60"
          >
            Back to {defaultServerUrl()}
          </button>
        )}
      </div>
    </div>
  );
}

/** The host this window is talking to, for a line under a sign-in form. */
export function serverLabel(): string {
  return serverUrl().replace(/^https?:\/\//i, '');
}
