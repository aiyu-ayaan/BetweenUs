import { useState } from 'react';
import { useIdentityStore } from '../stores/identity';
import {
  readDismissedUntil,
  shouldWarnAboutBackup,
  SNOOZE_KEY,
  SNOOZE_MS,
} from '../services/backup-warning';

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
  // On disk now, and for thirty days - see `SNOOZE_MS`. It used to be per
  // session, which meant this returned on every single launch; a warning that
  // comes back that often is a nag, and a nag gets ignored in place, which is
  // the failure the per-session rule was written to avoid.
  //
  // Read once, lazily, rather than on every render: the stamp only changes when
  // this component writes it.
  const [dismissedUntil, setDismissedUntil] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : readDismissedUntil(window.localStorage),
  );

  const snooze = (): void => {
    const until = Date.now() + SNOOZE_MS;
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(until));
    } catch {
      // Storage can be unavailable. Hiding it for this session is still the
      // right answer to the button somebody just pressed.
    }
    setDismissedUntil(until);
  };

  if (!shouldWarnAboutBackup(identity, dismissedUntil)) return null;

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
          onClick={snooze}
          aria-label="Hide this for 30 days"
          title="Hidden for 30 days. It disappears for good once recovery is set up."
          className="rounded-md px-2 py-0.5 font-medium text-amber-200/80 hover:bg-amber-500/15 hover:text-amber-100"
        >
          Not now
        </button>
      </span>
    </div>
  );
}
