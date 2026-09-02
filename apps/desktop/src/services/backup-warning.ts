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
  dismissedThisSession: boolean,
): boolean {
  // Nothing to lose yet, or nothing this notice can help with. `absent` is a
  // client that has not unlocked an identity - it has its own screen - and
  // `revoked` is a machine that has been shut out deliberately.
  if (identity.status !== 'ready') return false;
  if (identity.backedUp) return false;
  return !dismissedThisSession;
}

/**
 * Why the dismissal is remembered for the session and not for ever.
 *
 * A permanently dismissible warning about unrecoverable data loss is one
 * somebody clicks away on their first day and never sees again, while the risk
 * it described stays exactly as it was. A non-dismissible one is a nag, and a
 * nag gets ignored in place, which is worse - it is still on screen and no
 * longer read.
 *
 * Per session is the honest middle: it goes away when asked, comes back the
 * next time the app starts because the account is still unrecoverable, and
 * stops for good the moment a backup exists - which is the only thing that
 * actually changes the fact.
 */
export const DISMISSAL_IS_PER_SESSION = true;
