import assert from 'node:assert/strict';
import { ARRIVAL_LINES, arrivalLine } from './arrival';

// Same id, same sentence. This is the whole contract: the wording is derived
// rather than stored, so a second look at the same row must not say something
// else.
const id = '3f1c0b2e-9a4d-4e7b-8c11-6d5a2f0e9b73';
assert.equal(arrivalLine(id), arrivalLine(id));

// And it is always one of the published lines, whatever the id looks like.
for (const candidate of [id, '', 'a', '\u{1F512}', 'z'.repeat(200)]) {
  assert.ok(
    (ARRIVAL_LINES as readonly string[]).includes(arrivalLine(candidate)),
    `arrivalLine picked something not on the list for ${JSON.stringify(candidate)}`,
  );
}

// The numbers the Android port has to land on as well. If this list is ever
// changed, `arrivalLine` in ArrivalRow.kt changes with it or the two clients
// draw different sentences for the same arrival.
//
// Computed by hand from the same 31-multiplier hash: these are the pins that
// catch a drift in either implementation.
assert.equal(arrivalLine('a'), ARRIVAL_LINES[97 % ARRIVAL_LINES.length]);
assert.equal(arrivalLine('ab'), ARRIVAL_LINES[(97 * 31 + 98) % ARRIVAL_LINES.length]);

console.log('arrival.check.ts ok');
