import assert from 'node:assert/strict';
import { handleOf, labelOf } from '@betweenus/shared-types';

const person = (username: string, displayName: string) => ({ username, displayName });

// The name is what a person set; the username is the fallback, not a second line.
assert.equal(labelOf(person('ada', 'Ada Lovelace')), 'Ada Lovelace');
assert.equal(labelOf(person('ada', '   ')), 'ada');

assert.equal(handleOf(person('ada', 'Ada Lovelace')), '@ada');

// The three ways a handle would only repeat the name above it.
assert.equal(handleOf(person('test', '')), null);
assert.equal(handleOf(person('test', '  ')), null);
assert.equal(handleOf(person('test', 'Test')), null);

console.log('person-name ok');
