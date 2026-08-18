/**
 * Self-check for "one call per account, across devices".
 *
 * The rule fails silently in both directions, which is why it is pinned down:
 * a scan that finds nobody leaves two devices in the room talking over each
 * other, and one that finds too much - the joining socket itself, or another
 * person on the same channel - hangs up on somebody who never joined anything.
 *
 * Run with `pnpm --filter @betweenus/call-service check`.
 */
import assert from 'node:assert/strict';
import { otherDevicesInCall } from './devices';

/** Stand-ins for sockets: identity is all the function uses them for. */
const desktop = { name: 'desktop' };
const laptop = { name: 'laptop' };
const phone = { name: 'phone' };
const someoneElse = { name: 'someone else' };

const owner = new Map<object, string>([
  [desktop, 'ana'],
  [laptop, 'ana'],
  [phone, 'ana'],
  [someoneElse, 'ben'],
]);

const userIdOf = (socket: object): string | undefined => owner.get(socket);

function theJoiningDeviceIsNeverItsOwnVictim(): void {
  const calls = [new Set<object>([desktop, someoneElse])];
  assert.deepEqual(otherDevicesInCall(calls, userIdOf, 'ana', desktop), []);
}

function anotherDeviceOfTheSameAccountIsFound(): void {
  const calls = [new Set<object>([desktop, someoneElse])];
  assert.deepEqual(otherDevicesInCall(calls, userIdOf, 'ana', laptop), [desktop]);
}

function aCallInAnotherChannelCountsToo(): void {
  // The point of the rule: the second device is joining a *different* channel,
  // and the first one still has to be taken out of the one it is in.
  const calls = [new Set<object>([someoneElse]), new Set<object>([desktop])];
  assert.deepEqual(otherDevicesInCall(calls, userIdOf, 'ana', laptop), [desktop]);
}

function everyOtherDeviceGoes(): void {
  const calls = [new Set<object>([desktop]), new Set<object>([phone, someoneElse])];
  assert.deepEqual(otherDevicesInCall(calls, userIdOf, 'ana', laptop), [desktop, phone]);
}

function nobodyElseIsTouched(): void {
  const calls = [new Set<object>([someoneElse])];
  assert.deepEqual(
    otherDevicesInCall(calls, userIdOf, 'ana', laptop),
    [],
    'another person in the same call is not another device of this account',
  );
}

function main(): void {
  theJoiningDeviceIsNeverItsOwnVictim();
  anotherDeviceOfTheSameAccountIsFound();
  aCallInAnotherChannelCountsToo();
  everyOtherDeviceGoes();
  nobodyElseIsTouched();
  console.log('call-service device self-check passed');
}

main();
