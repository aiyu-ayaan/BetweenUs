/** Run with `tsx src/socket-member.check.ts`. */
import assert from 'node:assert/strict';
import {
  accountIsOffline,
  distinctAccounts,
  parseSocketMember,
  socketMember,
} from './socket-member';

const member = socketMember('u1', 'a-b-c');
assert.equal(member, 'u1:a-b-c');
assert.deepEqual(parseSocketMember(member), { userId: 'u1', socketId: 'a-b-c' });
assert.equal(parseSocketMember('nocolon'), null);
assert.equal(parseSocketMember(':x'), null);
assert.equal(parseSocketMember('x:'), null);

// One account on three devices is three sockets and one account.
const three = ['u1:a', 'u1:b', 'u1:c'];
assert.equal(three.length, 3);
assert.equal(distinctAccounts(three), 1);
assert.equal(distinctAccounts([...three, 'u2:d', 'garbage']), 2);

// Offline only when nothing is left.
assert.equal(accountIsOffline(2), false);
assert.equal(accountIsOffline(1), false);
assert.equal(accountIsOffline(0), true);

console.log('socket-member.check.ts ok');
