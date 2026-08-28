/**
 * Self-check: the cut-off two "clear" markers agree on.
 *
 * `laterOf` is four lines and one of them is a trap. Null here means "nothing
 * was ever cleared", not "cleared at the beginning of time" - and those are the
 * opposite answers: the first hides nothing, the second hides everything. A
 * `Math.max` over two nullable dates gets it exactly wrong, silently, and the
 * symptom is an empty conversation nobody can explain.
 *
 * The other half is precedence. Two markers exist because they answer different
 * questions - one write on the account for "clear everything", one write on the
 * row that already exists per (user, channel) for "clear this one" - and
 * neither subsumes the other. Later always wins, in both orders.
 */
import assert from 'node:assert/strict';
import { laterOf } from './messages.service';

const older = new Date('2026-01-01T00:00:00.000Z');
const newer = new Date('2026-06-01T00:00:00.000Z');

// Nothing cleared anywhere: no floor at all. This is every account today, and
// getting it wrong empties every conversation on the deployment.
assert.equal(laterOf(null, null), null);

// One marker set is that marker, whichever side it is on.
assert.equal(laterOf(older, null), older);
assert.equal(laterOf(null, older), older);

// Both set: the later one, in both orders.
assert.equal(laterOf(older, newer), newer);
assert.equal(laterOf(newer, older), newer);

// Equal instants: still a cut-off, and not null. "Clear everything" and "clear
// this conversation" landing in the same millisecond is not two people
// disagreeing, it is one answer said twice.
const same = new Date(newer);
assert.equal(laterOf(newer, same)?.getTime(), newer.getTime());

// The epoch is a real cut-off, not an absent one. `0` is falsy and a truthiness
// check here would read a genuine clear as "never cleared".
const epoch = new Date(0);
assert.equal(laterOf(epoch, null), epoch);
assert.equal(laterOf(epoch, newer), newer);

console.log('chat-service cleared check ok');
