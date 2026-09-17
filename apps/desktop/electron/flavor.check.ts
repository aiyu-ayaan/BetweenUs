/** Run with `tsx electron/flavor.check.ts`. Which application this process is. */
import assert from 'node:assert/strict';
import { DEV_PRODUCT_NAME, appUserModelIdFor, flavorOf } from './flavor';

// Running from source is developing, whatever the name says. This is the case
// the whole thing exists for: `pnpm dev` must not share a userData directory,
// a single-instance lock or a key store with the installed application - and
// it did, because both answered to `@betweenus/desktop`.
assert.equal(flavorOf(false, '@betweenus/desktop'), 'dev');
assert.equal(flavorOf(false, DEV_PRODUCT_NAME), 'dev');

// `@betweenus/desktop` is the installed client's real name - the one its
// userData directory is already named after, rather than the product name on
// its shortcut. Reading it as anything but stable would point the released
// application at a different directory and lose every account on it.
assert.equal(flavorOf(true, '@betweenus/desktop'), 'stable');
assert.equal(flavorOf(true, 'BetweenUs'), 'stable');

// A packaged build is the Dev channel only when it was built as one, which is
// the name `electron-builder.dev.yml` writes into the packaged manifest.
assert.equal(flavorOf(true, DEV_PRODUCT_NAME), 'dev');

// Separate Windows identities, or a Dev toast raises the stable window.
assert.notEqual(appUserModelIdFor('dev'), appUserModelIdFor('stable'));
assert.equal(appUserModelIdFor('stable'), 'com.betweenus.desktop');
assert.equal(appUserModelIdFor('dev'), 'com.betweenus.desktop.dev');

// `pnpm dev:duo` narrows it again: two accounts on one machine, and a toast
// for one of them must not raise the other's window.
assert.equal(appUserModelIdFor('dev', 'duo-a'), 'com.betweenus.desktop.dev.duo-a');
assert.notEqual(appUserModelIdFor('dev', 'duo-a'), appUserModelIdFor('dev', 'duo-b'));

console.log('flavor.check.ts ok');
