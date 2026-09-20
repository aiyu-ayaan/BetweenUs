import { useEffect, useState } from 'react';
import { onRecoveryCode } from '../services/e2ee';

/**
 * Shows the recovery code, once, at the moment an account's vault is created.
 *
 * It is here rather than in a settings panel because of who ends up with one.
 * A factor offered later is a factor held by the people who go looking for it,
 * and the whole value of this one is that *everybody* has it: it is the way
 * back that survives a forgotten passphrase, a password reset, and losing
 * every machine at once. The server holds ciphertext and no key, so without it
 * there is no support route and no appeal.
 *
 * Nothing stores it. A recovery code this app can read back is a recovery code
 * that goes with the machine, which is precisely the failure it exists to
 * prevent - so it is shown here, and after this dialog is closed the only copy
 * in the world is wherever its owner put it.
 *
 * Dismissal is a deliberate acknowledgement rather than a close button in the
 * corner, and that is the one place this design is allowed to be slightly
 * annoying: it is the single screen in the app where clicking past without
 * reading has a consequence nobody can undo.
 */
export function RecoveryCodeDialog(): JSX.Element | null {
  const [code, setCode] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => onRecoveryCode(setCode), []);

  if (!code) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-code-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/95 p-6"
    >
      <div className="w-full max-w-md rounded-xl bg-surface-900 p-6 shadow-xl">
        <h1 id="recovery-code-title" className="text-lg font-semibold text-slate-50">
          Save your recovery code
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          This is the only way back into your messages if you forget your password and lose the
          devices you are signed in on. We cannot show it again and we cannot recover it for
          you — your messages are encrypted with a key this service does not have.
        </p>

        <p className="mt-4 select-all rounded-md bg-surface-800 p-3 text-center font-mono text-base tracking-wider text-slate-100">
          {code}
        </p>

        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(code).catch(() => undefined)}
          className="mt-2 w-full rounded-md bg-surface-800 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-surface-700"
        >
          Copy
        </button>

        <label className="mt-5 flex cursor-pointer items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 cursor-pointer accent-accent"
          />
          <span>I have written this down somewhere safe</span>
        </label>

        <button
          type="button"
          disabled={!acknowledged}
          onClick={() => setCode(null)}
          className="mt-3 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
