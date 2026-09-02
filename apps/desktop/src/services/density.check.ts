import assert from 'node:assert/strict';
import {
  DENSITIES,
  DENSITY_LABELS,
  asDensity,
  spacingFor,
  type Density,
} from './density';

// --- reading a stored value --------------------------------------------------

assert.equal(asDensity('cozy'), 'cozy');
assert.equal(asDensity('compact'), 'compact');

// Anything else is the default rather than an exception. An appearance
// preference is never worth failing to draw the app over.
assert.equal(asDensity(undefined), 'cozy');
assert.equal(asDensity(null), 'cozy');
assert.equal(asDensity('roomy'), 'cozy', 'a value from a newer build reads as the default');
assert.equal(asDensity(3), 'cozy');
assert.equal(asDensity({}), 'cozy');

// --- the two modes are complete and distinct ---------------------------------

assert.deepEqual(DENSITIES, ['cozy', 'compact']);
for (const density of DENSITIES) {
  const labels = DENSITY_LABELS[density];
  assert.ok(labels.label.length > 0, `${density} has a name`);
  assert.ok(labels.hint.length > 0, `${density} says what it does`);
}

{
  const cozy = spacingFor('cozy');
  const compact = spacingFor('compact');

  // Every measurement differs. A mode that changes three of four is one where
  // somebody added a fourth and forgot the second value - the reason both
  // numbers live side by side in one table.
  const keys = Object.keys(cozy) as (keyof typeof cozy)[];
  assert.equal(keys.length, 4);
  for (const key of keys) {
    assert.notEqual(compact[key], cozy[key], `compact differs from cozy in ${key}`);
    assert.ok(cozy[key].length > 0 && compact[key].length > 0);
  }
}

// --- nothing collapses to nothing -------------------------------------------

{
  // A run with no gap at all stops reading as several messages and starts
  // reading as one long one with odd line breaks. Compact is tighter than cozy
  // everywhere and zero nowhere.
  const compact = spacingFor('compact');
  for (const value of Object.values(compact)) {
    assert.ok(!/-0$/.test(value), `"${value}" would remove the space entirely`);
  }
}

// --- an unknown density is still drawable ------------------------------------

{
  const rescued = spacingFor('nonsense' as Density);
  assert.deepEqual(rescued, spacingFor('cozy'), 'an unknown mode still returns a full spacing set');
}

console.log('density.check.ts ok');
