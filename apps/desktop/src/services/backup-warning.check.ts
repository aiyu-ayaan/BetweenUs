import assert from 'node:assert/strict';
import { shouldWarnAboutBackup, type IdentityLike } from './backup-warning';

const ready = (backedUp: boolean): IdentityLike => ({ status: 'ready', backedUp });

// --- the case the notice exists for -----------------------------------------

// A key this machine holds and nothing else has a copy of. Lose the machine,
// lose every conversation it could read - and no support route recovers it,
// because the server holds ciphertext and no key.
assert.equal(shouldWarnAboutBackup(ready(false), false), true);

// --- and everybody it must not interrupt ------------------------------------

// The common case by far: a password sign-in seals a backup on its own. A
// warning shown to people who are already safe is one everybody learns to
// scroll past, which costs the people who are not.
assert.equal(shouldWarnAboutBackup(ready(true), false), false);

// No identity unlocked yet - that has its own screen, and there is nothing to
// have lost.
assert.equal(shouldWarnAboutBackup({ status: 'absent' }, false), false);
assert.equal(shouldWarnAboutBackup({ status: 'absent', backedUp: false }, false), false);

// A machine shut out on purpose. Telling it to make a backup is advice about a
// key it is not allowed to use.
assert.equal(shouldWarnAboutBackup({ status: 'revoked' }, false), false);
assert.equal(shouldWarnAboutBackup({ status: 'revoked', backedUp: false }, false), false);

// An identity that never said either way is not assumed to be safe. `backedUp`
// missing means unknown, and unknown here has to read as at-risk: the failure
// of warning somebody unnecessarily is an ignored banner, and the failure of
// staying quiet is somebody losing everything.
assert.equal(shouldWarnAboutBackup({ status: 'ready' }, false), true);

// --- dismissal ---------------------------------------------------------------

assert.equal(shouldWarnAboutBackup(ready(false), true), false, 'dismissing hides it now');

// Dismissal never outranks the fact. Once a backup exists the notice is gone
// whether or not it was ever dismissed, and while none exists dismissal is the
// only thing holding it back - which is why the caller keeps that flag in
// memory rather than on disk.
assert.equal(shouldWarnAboutBackup(ready(true), true), false);

console.log('backup-warning.check.ts ok');
