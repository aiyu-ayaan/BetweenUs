import { useState } from 'react';
import { restoreIdentity } from '../../services/e2ee';
import { useIdentityStore } from '../../stores/identity';

/**
 * "This machine has no key for your account yet."
 *
 * Shown when a session resumes without the secret that opens the account's
 * sealed identity - a launch from a stored token, or a provider sign-in for an
 * account whose backup is keyed to a passphrase. The alternative to asking is
 * minting a new identity, which reads as working right up until every message
 * in every channel shows the lock placeholder, so this asks.
 *
 * Dismissable: a person who only wants to read new messages on a spare machine
 * should not be held at a password box. Nothing is generated either way until
 * they act.
 */
export function IdentityUnlock(): JSX.Element | null {
  const identity = useIdentityStore((state) => state.identity);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (identity.status !== 'locked' || dismissed) return null;

  const isPassword = identity.kind === 'password';

  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await restoreIdentity({ value: secret, kind: identity.kind });
      setSecret('');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That did not open the key');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4">
      <form
        className="w-full max-w-md rounded-xl border border-surface-700/50 bg-surface-800 p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-lg font-semibold text-slate-50">Unlock your messages</h2>
        <p className="mt-2 text-sm text-slate-300">
          {isPassword
            ? 'This machine has no encryption key for your account yet. Your account password opens the sealed copy the server holds.'
            : 'This machine has no encryption key for your account yet. Your recovery passphrase opens the sealed copy the server holds.'}
        </p>

        <input
          type="password"
          autoFocus
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={isPassword ? 'Account password' : 'Recovery passphrase'}
          className="mt-4 w-full rounded bg-surface-950 px-3 py-2.5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {problem && <p className="mt-2 text-sm text-rose-300">{problem}</p>}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex-1 cursor-pointer rounded-md bg-surface-700 px-4 py-2.5 font-medium text-slate-100 transition-colors duration-200 hover:bg-surface-600"
          >
            Not now
          </button>
          <button
            type="submit"
            disabled={busy || secret.length === 0}
            className="flex-1 cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  );
}
