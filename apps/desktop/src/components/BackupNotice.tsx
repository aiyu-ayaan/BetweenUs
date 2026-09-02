import { useState } from 'react';
import { useIdentityStore } from '../stores/identity';
import { shouldWarnAboutBackup } from '../services/backup-warning';

/**
 * The one notice that says an account cannot be recovered.
 *
 * `ensureBackup` in `e2ee.ts` ends with a comment that is exactly right and is
 * exactly the problem: an account without a backup still works, it is only
 * unrecoverable, "and the settings panel says so". It does. Nothing brought
 * anybody to the settings panel.
 *
 * Almost nobody sees this. A password sign-in seals a backup on its own, so the
 * accounts it fires for are the ones with no password to derive from - a Google
 * or GitHub sign-in - which until now were never told that the machine in front
 * of them is the only thing holding their key.
 *
 * The wording is deliberately about the consequence rather than about
 * cryptography. "Set a recovery passphrase" is a chore; "if you lose this
 * computer you lose these conversations" is the reason to do it, and it is the
 * true one - the server holds ciphertext and no key, so there is no support
 * route that gets them back.
 */
export function BackupNotice({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element | null {
  const identity = useIdentityStore((state) => state.identity);
  // In memory rather than on disk, on purpose - see `backup-warning.ts`. A
  // permanently dismissible warning about unrecoverable loss is one somebody
  // clicks away on their first day while the risk stays exactly as it was.
  const [dismissed, setDismissed] = useState(false);

  if (!shouldWarnAboutBackup(identity, dismissed)) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-amber-500/15 px-3 py-1.5 text-sm text-amber-200"
    >
      <span>
        This computer holds the only copy of your encryption key. If you lose it, these
        conversations cannot be recovered — not by us either.
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-md bg-amber-500/20 px-2 py-0.5 font-medium hover:bg-amber-500/30"
        >
          Set up recovery
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Hide until next time"
          className="rounded-md px-2 py-0.5 font-medium text-amber-200/80 hover:bg-amber-500/15 hover:text-amber-100"
        >
          Not now
        </button>
      </span>
    </div>
  );
}
