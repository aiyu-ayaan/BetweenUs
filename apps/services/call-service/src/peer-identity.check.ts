/**
 * Self-check for peer identity.
 *
 * Every failure here is silent and expensive. An id that changes across a
 * reconnect is a mesh rebuilt from nothing several times a call; an id that is
 * the *same* for two windows on one account is the second window disconnecting
 * the first; an id built from an unbounded client string is a peer list with a
 * kilobyte of somebody's choosing in it.
 *
 * Run with `pnpm --filter @betweenus/call-service check`.
 */
import assert from 'node:assert/strict';
import { deviceOf, peerIdFor } from './peer-identity';

// The whole point: the same device, twice, is the same peer. This is what a
// reconnect is, and the old per-socket id failed it every time.
assert.equal(peerIdFor('ana', 'phone-1'), peerIdFor('ana', 'phone-1'));

// Two windows on one account are still two peers.
assert.notEqual(peerIdFor('ana', 'phone-1'), peerIdFor('ana', 'laptop-1'));

// One shared machine, two accounts, two peers.
assert.notEqual(peerIdFor('ana', 'phone-1'), peerIdFor('ben', 'phone-1'));

// Handed to every other participant, so it carries neither the account nor the
// installation in the clear.
const id = peerIdFor('ana', 'phone-1');
assert.equal(/^[0-9a-f]{32}$/.test(id), true);
assert.equal(id.includes('ana'), false);
assert.equal(id.includes('phone-1'), false);

// A client that names no device gets the old behaviour: random, per socket.
assert.notEqual(peerIdFor('ana', null), peerIdFor('ana', null));

// What comes off the handshake.
assert.equal(deviceOf('/ws/call?token=abc&device=phone-1'), 'phone-1');
assert.equal(deviceOf('/ws/call?token=abc'), null);
assert.equal(deviceOf('/ws/call?device='), null);
assert.equal(deviceOf(undefined), null);
// Percent-encoded, because the clients encode it.
assert.equal(deviceOf('/ws/call?device=a%20b'), 'a b');
// Unbounded input is refused rather than truncated: half an id is a different
// peer, which is worse than no id at all.
assert.equal(deviceOf(`/ws/call?device=${'x'.repeat(128)}`), 'x'.repeat(128));
assert.equal(deviceOf(`/ws/call?device=${'x'.repeat(129)}`), null);

console.log('call-service peer identity self-check passed');
