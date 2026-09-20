/**
 * Whether to tell somebody their account cannot be recovered.
 *
 * Much rarer than it used to be, and worth saying why rather than leaving the
 * narrower rule to look like an oversight.
 *
 * Under v1 this fired for any machine whose key was not in a backup, which was
 * every machine of every provider account and a good many others besides -
 * because "backed up" was a fact about *this laptop's* key rather than about
 * the account. Under the vault, every account is created with a recovery code
 * whether anybody asked for one or not, so the ordinary state is recoverable
 * and the warning is for the case somebody has taken every portable factor
 * away deliberately.
 *
 * It is still worth having, and it is the same justification as before: if the
 * last portable factor is gone and the machines are lost, every conversation
 * goes with them. The server holds ciphertext and no key, and there is no
 * support route that recovers it.
 *
 * The notice stays narrow for the same reason it always did - one shown to
 * people who are already safe is one everybody learns to scroll past.
 */

/** The shape this needs of the identity store. */
export interface IdentityLike {
  status: 'absent' | 'ready' | 'locked' | 'revoked';
  /**
   * Whether a portable factor stands: a password, a passphrase or a recovery
   * code. False means the account's only way in is a machine it still has.
   */
  recoverable?: boolean;
}

export function shouldWarnAboutBackup(
  identity: IdentityLike,
  /**
   * When the last dismissal runs out, in epoch milliseconds, or null for "never
   * dismissed". See `SNOOZE_MS`.
   */
  dismissedUntil: number | null,
  now: number = Date.now(),
): boolean {
  // Nothing to lose yet, or nothing this notice can help with. `absent` is a
  // client with nobody signed in, `locked` is a machine that has not been let
  // into the vault - both have their own screen - and `revoked` is a machine
  // shut out deliberately.
  if (identity.status !== 'ready') return false;
  if (identity.recoverable) return false;
  // A stamp in the future is a dismissal that has not run out. A stamp in the
  // past, or none, is a notice that is due.
  return dismissedUntil === null || now >= dismissedUntil;
}

/**
 * How long "Not now" lasts.
 *
 * This used to be one session, and the reasoning was sound in one direction
 * only: a permanently dismissible warning about unrecoverable data loss is one
 * somebody clicks away on their first day while the risk stays exactly as it
 * was. What that missed is that a warning returning on every single launch is a
 * nag, and a nag gets ignored *in place* - still on screen, no longer read - so
 * per-session dismissal produced the failure it was trying to avoid, and made
 * the app feel broken while doing it.
 *
 * Thirty days is the honest middle. It goes away properly when asked, it comes
 * back long enough later that it reads as a fresh warning rather than as the
 * same one again, and it stops for good the moment a backup exists - which is
 * the only thing that actually changes the fact it is describing.
 *
 * Nothing here overrides that last part: `recoverable` short-circuits above
 * the snooze, so setting up recovery removes the notice immediately whatever
 * is stored.
 */
export const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** Where the stamp lives. Per machine, because the risk is about this machine. */
export const SNOOZE_KEY = 'betweenus.backupNotice.dismissedUntil';

/**
 * Reads the stored stamp. Never throws: storage can be unavailable or hold
 * junk, and neither is a reason to fail to draw a warning - an unreadable
 * value reads as "never dismissed", which errs towards showing it.
 */
export function readDismissedUntil(store: Pick<Storage, 'getItem'>): number | null {
  try {
    const raw = store.getItem(SNOOZE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
