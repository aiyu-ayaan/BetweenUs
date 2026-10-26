/**
 * Self-check for what the person who rang is told.
 *
 * Each ring must end exactly once and in the right way: a caller told "declined"
 * for somebody who answered, or told nothing for somebody whose phone was off,
 * is the bug this exists to remove.
 *
 * Run with `pnpm --filter @betweenus/call-service check`.
 */
import assert from 'node:assert/strict';
import { RingTracker, type RingOutcome } from './ring-tracker';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function tracker(timeoutMs = 40): { tracker: RingTracker; seen: RingOutcome[] } {
  const seen: RingOutcome[] = [];
  return { tracker: new RingTracker((outcome) => seen.push(outcome), timeoutMs), seen };
}

const states = (seen: RingOutcome[]): string[] => seen.map((outcome) => outcome.state);

async function aRingIsReportedAsRingingFirst(): Promise<void> {
  const { tracker: t, seen } = tracker();
  t.start('c1', 'ana', 'ben', 'Ben');
  assert.deepEqual(states(seen), ['ringing']);
  assert.equal(seen[0]?.callerId, 'ana', 'it is told to whoever rang');
  assert.equal(seen[0]?.targetName, 'Ben');
  t.joined('c1', 'ben');
}

async function sayingNoEndsItAndTellsTheCaller(): Promise<void> {
  const { tracker: t, seen } = tracker();
  t.start('c1', 'ana', 'ben', 'Ben');
  t.declined('c1', 'ben');
  assert.deepEqual(states(seen), ['ringing', 'declined']);
  assert.equal(t.outstanding, 0);
  await sleep(80);
  assert.deepEqual(states(seen), ['ringing', 'declined'], 'the clock must not fire for a ring that ended');
}

async function joiningTheCallAnswersIt(): Promise<void> {
  const { tracker: t, seen } = tracker();
  t.start('c1', 'ana', 'ben', 'Ben');
  t.joined('c1', 'ben');
  assert.deepEqual(states(seen), ['ringing', 'answered']);
}

async function aRingNobodyDealtWithRingsOut(): Promise<void> {
  const { tracker: t, seen } = tracker(30);
  t.start('c1', 'ana', 'ben', 'Ben');
  await sleep(80);
  assert.deepEqual(states(seen), ['ringing', 'unanswered']);
  assert.equal(t.outstanding, 0);
}

async function aRingEndsExactlyOnce(): Promise<void> {
  const { tracker: t, seen } = tracker(30);
  t.start('c1', 'ana', 'ben', 'Ben');
  t.declined('c1', 'ben');
  t.joined('c1', 'ben');
  t.declined('c1', 'ben');
  await sleep(80);
  assert.deepEqual(states(seen), ['ringing', 'declined']);
}

async function joiningACallNobodyRangYouForSaysNothing(): Promise<void> {
  const { tracker: t, seen } = tracker();
  t.joined('c1', 'ben');
  t.declined('c1', 'ben');
  assert.deepEqual(seen, []);
}

async function ringsAreKeptApartPerChannelAndPerPerson(): Promise<void> {
  const { tracker: t, seen } = tracker();
  t.start('c1', 'ana', 'ben', 'Ben');
  t.start('c1', 'ana', 'cy', 'Cy');
  t.start('c2', 'ana', 'ben', 'Ben');
  t.declined('c1', 'ben');
  assert.equal(t.outstanding, 2, 'Cy and the other channel are still ringing');
  assert.equal(seen.at(-1)?.targetId, 'ben');
  t.joined('c1', 'cy');
  t.joined('c2', 'ben');
  assert.equal(t.outstanding, 0);
}

async function ringingAgainRestartsTheClock(): Promise<void> {
  const { tracker: t, seen } = tracker(50);
  t.start('c1', 'ana', 'ben', 'Ben');
  await sleep(30);
  t.start('c1', 'ana', 'ben', 'Ben');
  await sleep(30);
  assert.deepEqual(states(seen), ['ringing', 'ringing'], 'the first clock must not end the second ring');
  await sleep(60);
  assert.deepEqual(states(seen), ['ringing', 'ringing', 'unanswered']);
}

async function main(): Promise<void> {
  await aRingIsReportedAsRingingFirst();
  await sayingNoEndsItAndTellsTheCaller();
  await joiningTheCallAnswersIt();
  await aRingNobodyDealtWithRingsOut();
  await aRingEndsExactlyOnce();
  await joiningACallNobodyRangYouForSaysNothing();
  await ringsAreKeptApartPerChannelAndPerPerson();
  await ringingAgainRestartsTheClock();

  console.log('ring tracker check ok');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
