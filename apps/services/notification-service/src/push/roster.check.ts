/**
 * Self-check for the call fan-out's two decisions.
 *
 * Both fail quietly. A roster that is wrongly "unchanged" is a call nobody is
 * told about; one that is wrongly "changed" is a buzz per socket, and one
 * account with two windows open produces two of those for the same person
 * arriving once.
 *
 * Run with `pnpm --filter @betweenus/notification-service check`.
 */
import assert from 'node:assert/strict';
import { namesOf, rosterChanged } from './roster';

function aChannelNeverSeenBeforeIsNewsOnlyIfSomebodyIsInIt(): void {
  assert.equal(rosterChanged(undefined, ['ana']), true);
  // Nothing has been said about this channel and its call is already over.
  assert.equal(rosterChanged(undefined, []), false);
}

function theSameRosterTwiceIsNotNews(): void {
  assert.equal(rosterChanged(['ana', 'ben'], ['ana', 'ben']), false);
  // Order is the gateway's, not a fact about the room.
  assert.equal(rosterChanged(['ana', 'ben'], ['ben', 'ana']), false);
}

function arrivingAndLeavingAreBothNews(): void {
  assert.equal(rosterChanged(['ana'], ['ana', 'ben']), true);
  assert.equal(rosterChanged(['ana', 'ben'], ['ana']), true);
  assert.equal(rosterChanged(['ana'], []), true);
  // Same size, different people: a swap in one announcement.
  assert.equal(rosterChanged(['ana'], ['ben']), true);
}

function aRosterReadsLikeASentenceUntilItIsAList(): void {
  assert.equal(namesOf([]), '');
  assert.equal(namesOf(['Ana']), 'Ana');
  assert.equal(namesOf(['Ana', 'Ben']), 'Ana and Ben');
  assert.equal(namesOf(['Ana', 'Ben', 'Cara']), 'Ana, Ben and Cara');
  assert.equal(namesOf(['Ana', 'Ben', 'Cara', 'Dev']), 'Ana, Ben and 2 others');
}

aChannelNeverSeenBeforeIsNewsOnlyIfSomebodyIsInIt();
theSameRosterTwiceIsNotNews();
arrivingAndLeavingAreBothNews();
aRosterReadsLikeASentenceUntilItIsAList();

console.log('roster check ok');
