/**
 * Self-check for the call fan-out's decisions.
 *
 * Both fail quietly. A roster that is wrongly "unchanged" is a call nobody is
 * told about; one that is wrongly "changed" is a buzz per socket, and one
 * account with two windows open produces two of those for the same person
 * arriving once.
 *
 * Run with `pnpm --filter @betweenus/notification-service check`.
 */
import assert from 'node:assert/strict';
import { joined, namesOf, rosterChanged, worthAnnouncing } from './roster';

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

function answeringSomewhereIsWhatTakesTheRingerDownEverywhereElse(): void {
  // Ana rings Ben; Ben answers on his phone. His laptop is still ringing and
  // nothing else will ever tell it otherwise - he is in the roster now, so the
  // announcement below deliberately skips him.
  assert.deepEqual(joined(['ana'], ['ana', 'ben']), ['ben']);
  // The first person in is answering their own call, which is still the event
  // that silences the ring their other devices are showing.
  assert.deepEqual(joined(undefined, ['ana']), ['ana']);
  assert.deepEqual(joined([], ['ana']), ['ana']);
  // Leaving is not answering, and neither is standing still.
  assert.deepEqual(joined(['ana', 'ben'], ['ana']), []);
  assert.deepEqual(joined(['ana'], ['ana']), []);
  assert.deepEqual(joined(['ana'], []), []);
}

function theRoomIsToldWhenACallStartsAndWhenItEnds(): void {
  assert.equal(worthAnnouncing(undefined, ['ana']), true, 'a call starting is news');
  assert.equal(worthAnnouncing([], ['ana']), true, 'and so is one starting again');
  assert.equal(worthAnnouncing(['ana'], []), true, 'the end cancels the notification');

  // The bug this exists for: Ben leaves a call Ana is still on, stops being a
  // participant, becomes audience, and is sent "Ana is in the call" about the
  // call he has just put down.
  assert.equal(
    worthAnnouncing(['ana', 'ben'], ['ana']),
    false,
    'leaving a call must never notify the person who left about the one they left',
  );
  assert.equal(
    worthAnnouncing(['ana'], ['ana', 'ben']),
    false,
    'somebody joining a call already under way is not a second announcement',
  );
}

aChannelNeverSeenBeforeIsNewsOnlyIfSomebodyIsInIt();
answeringSomewhereIsWhatTakesTheRingerDownEverywhereElse();
theRoomIsToldWhenACallStartsAndWhenItEnds();
theSameRosterTwiceIsNotNews();
arrivingAndLeavingAreBothNews();
aRosterReadsLikeASentenceUntilItIsAList();

console.log('roster check ok');
