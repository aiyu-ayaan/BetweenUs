import { useEffect, useState } from 'react';
import { useIdentityStore } from '../stores/identity';
import {
  checkForGrant,
  unlockWithSecret,
  type VaultSecret,
} from '../services/e2ee';
import { normaliseRecoveryCode } from '../services/e2ee-crypto';

/**
 * The screen a machine sees when it has not been let into the account yet.
 *
 * This screen is the replacement for the worst behaviour this app ever had.
 * A machine that could not open the account's key used to mint one of its own
 * and carry on looking normal: it read a wall of padlocks, it dragged channels
 * onto epochs the rest of the account could not read, and the only thing said
 * about it was a grey line suggesting the reader go and open the app on the
 * laptop they were replacing. If that laptop had been wiped, the conversation
 * was gone, and nothing on screen ever admitted it.
 *
 * So: a machine that cannot read is a machine that says it cannot read, and
 * writes nothing while it waits. All three ways in are on this one screen,
 * because the routes suit different people and finding out which one you need
 * is not a task to hand somebody who has just lost their history:
 *
 * - **a recovery code**, which needs nobody else and no other machine
 * - **a passphrase**, for anybody who set one
 * - **approval** from a machine already signed in, which needs no typing here
 *
 * The password box is not offered. A sign-in that had a password to hand has
 * already tried it, so a box for it here is a box that fails for everybody who
 * would use it.
 */
export function VaultLocked(): JSX.Element | null {
  const identity = useIdentityStore((state) => state.identity);
  const [code, setCode] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = identity.status === 'locked';

  // Somebody may approve this machine from the next room while this screen is
  // open, and it should come to life without anybody restarting anything. One
  // row by primary key every few seconds is cheap enough to be the thing that
  // makes that true.
  useEffect(() => {
    if (!locked) return undefined;
    const timer = setInterval(() => void checkForGrant(), 4000);
    return () => clearInterval(timer);
  }, [locked]);

  if (!locked) return null;

  const unlock = async (secret: VaultSecret): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await unlockWithSecret(secret);
    } catch {
      // Deliberately one message for every failure. "Wrong code" and "no
      // factor of that kind" are the same thing to the person typing, and
      // distinguishing them out loud tells somebody holding a stolen laptop
      // which of the two they got wrong.
      setError('That did not open your account. Check it and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/95 p-6">
      <div className="w-full max-w-md rounded-xl bg-surface-900 p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-slate-50">Unlock this device</h1>
        <p className="mt-2 text-sm text-slate-400">
          Your messages are encrypted with a key only you hold. This device has not been given
          it yet, so it cannot read anything until one of these is done. Nothing is lost while
          you decide — your history is waiting behind the key.
        </p>

        <label className="mt-5 block text-sm font-medium text-slate-300" htmlFor="recovery-code">
          Recovery code
        </label>
        <p className="mt-0.5 text-xs text-slate-500">
          The code shown when you created your account. Needs nothing else.
        </p>
        <input
          id="recovery-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX"
          className="mt-1.5 w-full rounded-md bg-surface-800 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="button"
          disabled={busy || code.trim().length === 0}
          // Normalised here rather than demanded of the reader: somebody
          // copying this off paper will use spaces, lowercase, or their own
          // dashes, and a correct code failing on its punctuation is
          // indistinguishable - to them - from having lost the account.
          onClick={() => void unlock({ value: normaliseRecoveryCode(code), kind: 'recovery-code' })}
          className="mt-2 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Unlock with recovery code
        </button>

        <label className="mt-5 block text-sm font-medium text-slate-300" htmlFor="passphrase">
          Recovery passphrase
        </label>
        <input
          id="passphrase"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="mt-1.5 w-full rounded-md bg-surface-800 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="button"
          disabled={busy || passphrase.length === 0}
          onClick={() => void unlock({ value: passphrase, kind: 'passphrase' })}
          className="mt-2 w-full rounded-md bg-surface-800 px-3 py-2 text-sm font-medium text-slate-100 disabled:opacity-50"
        >
          Unlock with passphrase
        </button>

        <p className="mt-5 border-t border-surface-800 pt-4 text-sm text-slate-400">
          Or open BetweenUs on a device you are already signed in on and approve this one. It
          is waiting there now, and this screen will let you in as soon as you do.
        </p>

        {error && (
          <p role="alert" className="mt-4 text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
