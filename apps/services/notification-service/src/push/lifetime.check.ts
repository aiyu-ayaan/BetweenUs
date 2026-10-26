/**
 * Self-check for how long each kind of push is held.
 *
 * A ring that outlives its call rings a phone for nobody, and a call that
 * ended while the phone was off must still be told it is over.
 *
 * Run with `pnpm --filter @betweenus/notification-service check`.
 */
import assert from 'node:assert/strict';
import type { PushData } from '@betweenus/shared-types';
import {
  DEFAULT_LIFETIME_SECONDS,
  HANDLED_SECONDS,
  RING_SECONDS,
  ROSTER_LIVE_SECONDS,
  lifetimeSeconds,
} from './lifetime';

const ring: PushData = {
  type: 'call.ring',
  channelId: 'c1',
  channelName: 'dm',
  callerId: 'u1',
  callerName: 'Ana',
};

function aRingLivesAsLongAsItRings(): void {
  assert.equal(lifetimeSeconds(ring), RING_SECONDS);
  assert.equal(RING_SECONDS, 45, 'the clients stop ringing at forty-five seconds');
}

function aCancelDoesNotOutliveTheMomentItIsAbout(): void {
  const handled: PushData = { type: 'call.handled', channelId: 'c1', how: 'declined' };
  assert.equal(lifetimeSeconds(handled), HANDLED_SECONDS);
  assert.ok(HANDLED_SECONDS < DEFAULT_LIFETIME_SECONDS);
}

function aCallIsAnnouncedWhileItCanStillBeJoined(): void {
  const started: PushData = {
    type: 'call.roster',
    channelId: 'c1',
    channelName: 'dm',
    participants: 'Ana',
    count: '1',
  };
  assert.equal(lifetimeSeconds(started), ROSTER_LIVE_SECONDS);
}

function aCallThatEndedIsStillToldToAPhoneThatWasAway(): void {
  const ended: PushData = {
    type: 'call.roster',
    channelId: 'c1',
    channelName: 'dm',
    participants: '',
    count: '0',
  };
  assert.equal(lifetimeSeconds(ended), DEFAULT_LIFETIME_SECONDS);
}

function everythingElseKeepsItsDay(): void {
  const friend: PushData = {
    type: 'friend.request',
    actorId: 'u1',
    actorName: 'Ana',
  };
  assert.equal(lifetimeSeconds(friend), DEFAULT_LIFETIME_SECONDS);
}

aRingLivesAsLongAsItRings();
aCancelDoesNotOutliveTheMomentItIsAbout();
aCallIsAnnouncedWhileItCanStillBeJoined();
aCallThatEndedIsStillToldToAPhoneThatWasAway();
everythingElseKeepsItsDay();

console.log('lifetime check ok');
