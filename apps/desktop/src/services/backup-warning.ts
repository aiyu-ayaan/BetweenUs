/**
 * Whether to tell somebody their account cannot be recovered.
 *
 * `ensureBackup` in `e2ee.ts` ends with a comment that is exactly right and
 * exactly the problem: *"an account without a backup still works, it is only
 * unrecoverable, and the settings panel says so."* The settings panel does say
 * so. Nothing brings anybody to the settings panel.
 *
 * So this is the rule for the one notice that does. It is deliberately narrow -
 * it fires for the accounts that genuinely have no way back in, and for nobody
 * else, because a warning shown to people who are already safe is a warning
 * everybody learns to scroll past.
 *
 * ## Who is actually at risk
 *
 * Signing in with a password seals a backup on its own, so most accounts are
 * covered without anybody doing anything. The accounts that are not are the
 * ones with no password to derive from - a Google or GitHub sign-in - and they
 * are never told. If that machine is lost, every conversation it could read
 * goes with it, and there is no support route that recovers it: the server
 * holds ciphertext and no key.
 *
 * That is the whole justification for interrupting somebody at all.
 */

/** The shape this needs of the identity store. */
export interface IdentityLike {
  status: 'absent' | 'ready' | 'revoked';
  /** Whether *this machine's* key is in a backup the account can restore from. */
  backedUp?: boolean;
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
  // client that has not unlocked an identity - it has its own screen - and
  // `revoked` is a machine that has been shut out deliberately.
  if (identity.status !== 'ready') return false;
  if (identity.backedUp) return false;
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
 * Nothing here overrides that last part: `backedUp` short-circuits above the
 * snooze, so setting up recovery removes the notice immediately whatever is
 * stored.
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
