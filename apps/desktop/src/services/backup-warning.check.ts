import assert from 'node:assert/strict';
import {
  readDismissedUntil,
  shouldWarnAboutBackup,
  SNOOZE_KEY,
  SNOOZE_MS,
  type IdentityLike,
} from './backup-warning';

const ready = (recoverable: boolean): IdentityLike => ({ status: 'ready', recoverable });

// --- the case the notice exists for -----------------------------------------

// An account whose only way in is a machine it still has: every portable
// factor taken away deliberately. Lose the machines, lose every conversation
// they could read - and no support route recovers it, because the server holds
// ciphertext and no key.
assert.equal(shouldWarnAboutBackup(ready(false), null), true);

// --- and everybody it must not interrupt ------------------------------------

// The common case by far, and far more common than it was: every vault is
// created with a recovery code whether anybody asked for one or not. A warning
// shown to people who are already safe is one everybody learns to scroll past,
// which costs the people who are not.
assert.equal(shouldWarnAboutBackup(ready(true), null), false);

// No identity unlocked yet - that has its own screen, and there is nothing to
// have lost.
assert.equal(shouldWarnAboutBackup({ status: 'absent' }, null), false);
assert.equal(shouldWarnAboutBackup({ status: 'absent', recoverable: false }, null), false);

// A machine shut out on purpose. Telling it to make a backup is advice about a
// key it is not allowed to use.
assert.equal(shouldWarnAboutBackup({ status: 'revoked' }, null), false);
assert.equal(shouldWarnAboutBackup({ status: 'revoked', recoverable: false }, null), false);

// A machine waiting to be let into the vault. It has its own screen, with the
// three ways in on it, and a banner about recovery underneath would be advice
// about an account it cannot read yet.
assert.equal(shouldWarnAboutBackup({ status: 'locked' }, null), false);
assert.equal(shouldWarnAboutBackup({ status: 'locked', recoverable: false }, null), false);

// A vault that never said either way is not assumed to be safe. `recoverable`
// missing means unknown, and unknown here has to read as at-risk: the failure
// of warning somebody unnecessarily is an ignored banner, and the failure of
// staying quiet is somebody losing everything.
assert.equal(shouldWarnAboutBackup({ status: 'ready' }, null), true);

// --- dismissal, which now survives a restart ---------------------------------

const now = 1_800_000_000_000;

// "Not now" hides it, and keeps hiding it across launches for SNOOZE_MS. It
// used to be one session, so it came back on every single start - a warning
// that returns that often is a nag, and a nag gets ignored in place, which is
// the failure per-session dismissal was written to avoid.
assert.equal(shouldWarnAboutBackup(ready(false), now + SNOOZE_MS, now), false);
assert.equal(shouldWarnAboutBackup(ready(false), now + 1, now), false, 'still snoozed');

// And it comes back when the snooze runs out, because the account is still
// unrecoverable and that has not stopped being true.
assert.equal(shouldWarnAboutBackup(ready(false), now, now), true, 'due exactly on the stamp');
assert.equal(shouldWarnAboutBackup(ready(false), now - 1, now), true, 'and after it');

// Dismissal never outranks the fact. Once a backup exists the notice is gone
// whether or not it was ever dismissed - so setting up recovery removes it
// immediately rather than in thirty days.
assert.equal(shouldWarnAboutBackup(ready(true), now + SNOOZE_MS, now), false);

// --- reading the stamp back --------------------------------------------------

// Storage holding junk, or throwing outright, must not stop a warning being
// drawn: unreadable reads as "never dismissed", which errs towards showing it.
const store = (value: string | null): Pick<Storage, 'getItem'> => ({ getItem: () => value });
assert.equal(readDismissedUntil(store(String(now))), now);
assert.equal(readDismissedUntil(store(null)), null, 'never dismissed');
assert.equal(readDismissedUntil(store('later')), null, 'junk reads as never dismissed');
assert.equal(
  readDismissedUntil({
    getItem: () => {
      throw new Error('storage is disabled');
    },
  }),
  null,
  'a throwing store never hides the warning',
);
assert.equal(typeof SNOOZE_KEY, 'string');

console.log('backup-warning.check.ts ok');
