/** Run with `tsx electron/flavor.check.ts`. Which application this process is. */
import assert from 'node:assert/strict';
import {
  DEV_PRODUCT_NAME,
  STABLE_PRODUCT_NAME,
  appUserModelIdFor,
  flavorOf,
  productNameFor,
} from './flavor';

// Running from source is developing, whatever the name says. This is the case
// the whole thing exists for: `pnpm dev` must not share a userData directory,
// a single-instance lock or a key store with the installed application.
assert.equal(flavorOf(false, STABLE_PRODUCT_NAME), 'dev');
assert.equal(flavorOf(false, '@betweenus/desktop'), 'dev');

// A packaged build is whatever its product name declares, and the released one
// is the only one that is not Dev.
assert.equal(flavorOf(true, STABLE_PRODUCT_NAME), 'stable');
assert.equal(flavorOf(true, DEV_PRODUCT_NAME), 'dev');

// The names round trip, because the packaged build is recognised by the name
// the build config wrote - the two must not drift apart.
assert.equal(flavorOf(true, productNameFor('dev')), 'dev');
assert.equal(flavorOf(true, productNameFor('stable')), 'stable');

// Separate Windows identities, or a Dev toast raises the stable window.
assert.notEqual(appUserModelIdFor('dev'), appUserModelIdFor('stable'));
assert.equal(appUserModelIdFor('stable'), 'com.betweenus.desktop');
assert.equal(appUserModelIdFor('dev'), 'com.betweenus.desktop.dev');

// `pnpm dev:duo` narrows it again: two accounts on one machine, and a toast
// for one of them must not raise the other's window.
assert.equal(appUserModelIdFor('dev', 'duo-a'), 'com.betweenus.desktop.dev.duo-a');
assert.notEqual(appUserModelIdFor('dev', 'duo-a'), appUserModelIdFor('dev', 'duo-b'));

console.log('flavor.check.ts ok');
