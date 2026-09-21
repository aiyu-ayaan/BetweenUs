/**
 * The poll referee's rules, without a database.
 *
 * A vote is a list of numbers and the server never sees what they point at,
 * so these three numbers - how many options, one or many, open or closed - are
 * the whole of what stands between a ballot and the tally. Worth asserting
 * because a mistake in either direction is silent: too lax and one person
 * counts twice, too strict and a legal vote bounces.
 */
// `@Type` reads decorator metadata, which Nest loads at boot and a bare script does not.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { isPollClosed, pollChoicesOf, pollVoterCount } from '@betweenus/shared-types';
import { CreateMessageDto, VotePollDto } from './dto';
import { judgeBallot, judgePollSettings, pollIsClosed, tally, toPoll, type PollState } from './poll-rules';

const now = new Date('2026-09-22T12:00:00.000Z');
const single: PollState = { optionCount: 3, multiChoice: false, closesAt: null, closedAt: null };
const multi: PollState = { ...single, multiChoice: true };

// --- Settings ----------------------------------------------------------------

const settled = judgePollSettings({ optionCount: 4, durationSeconds: 3600 }, now);
assert.ok(settled.ok);
if (settled.ok) {
  assert.equal(settled.value.multiChoice, false, 'single choice unless asked');
  // The server's clock sets the close, not the client's.
  assert.equal(settled.value.closesAt?.toISOString(), '2026-09-22T13:00:00.000Z');
}
const open = judgePollSettings({ optionCount: 2, multiChoice: true, durationSeconds: null }, now);
assert.ok(open.ok && open.value.closesAt === null, 'no duration means no close');

for (const optionCount of [0, 1, 11, 2.5, Number.NaN]) {
  const refused = judgePollSettings({ optionCount }, now);
  assert.ok(!refused.ok && refused.code === 'INVALID_POLL', `${optionCount} options is not a poll`);
}
// A duration off the list is refused rather than rounded - a free number is a
// poll that closes in three seconds or never.
const odd = judgePollSettings({ optionCount: 3, durationSeconds: 3 }, now);
assert.ok(!odd.ok && odd.code === 'INVALID_POLL');

// --- Ballots -----------------------------------------------------------------

assert.deepEqual(judgeBallot(single, [1], now), { ok: true, value: [1] });
// Empty is legal: it is how a vote is retracted.
assert.deepEqual(judgeBallot(single, [], now), { ok: true, value: [] });
// Out of range, negative and fractional indexes point at no label.
for (const bad of [[3], [-1], [0.5], [Number.NaN]]) {
  const judged = judgeBallot(multi, bad, now);
  assert.ok(!judged.ok && judged.code === 'INVALID_VOTE', `${String(bad)} is not an option`);
}
// Single choice means one.
const greedy = judgeBallot(single, [0, 2], now);
assert.ok(!greedy.ok && greedy.code === 'SINGLE_CHOICE_POLL');
// The same option twice is one choice, not a way round single-choice.
assert.deepEqual(judgeBallot(single, [2, 2], now), { ok: true, value: [2] });
// Multi-choice is sorted and de-duplicated, so a ballot has one spelling.
assert.deepEqual(judgeBallot(multi, [2, 0, 2], now), { ok: true, value: [0, 2] });

// --- Closing -----------------------------------------------------------------

const closed = { ...single, closedAt: new Date('2026-09-22T11:00:00.000Z') };
const lapsed = { ...single, closesAt: new Date('2026-09-22T11:59:59.000Z') };
const running = { ...single, closesAt: new Date('2026-09-22T12:00:01.000Z') };
assert.equal(pollIsClosed(closed, now), true);
assert.equal(pollIsClosed(lapsed, now), true, 'a passed closesAt closes it with no sweeper');
assert.equal(pollIsClosed(running, now), false);
for (const shut of [closed, lapsed]) {
  const judged = judgeBallot(shut, [0], now);
  assert.ok(!judged.ok && judged.code === 'POLL_CLOSED');
  // Retracting is also a vote, and a closed poll takes none.
  const retract = judgeBallot(shut, [], now);
  assert.ok(!retract.ok && retract.code === 'POLL_CLOSED');
}

// --- Tallies -----------------------------------------------------------------

// Every option has a bar, including the ones nobody chose.
assert.deepEqual(tally(3, [{ userId: 'ada', option: 1 }]), [
  { option: 0, userIds: [] },
  { option: 1, userIds: ['ada'] },
  { option: 2, userIds: [] },
]);
// A row outside the range is dropped rather than drawn.
assert.deepEqual(tally(2, [{ userId: 'ada', option: 7 }]), [
  { option: 0, userIds: [] },
  { option: 1, userIds: [] },
]);

const wire = toPoll({
  optionCount: 3,
  multiChoice: true,
  closesAt: null,
  closedAt: null,
  closedById: null,
  votes: [
    { userId: 'ada', option: 0 },
    { userId: 'ada', option: 2 },
    { userId: 'grace', option: 2 },
  ],
});
// The wire shape is numbers and ids - nothing that could carry a label.
assert.deepEqual(Object.keys(wire).sort(), [
  'closedAt',
  'closedBy',
  'closesAt',
  'multiChoice',
  'optionCount',
  'tallies',
]);
assert.deepEqual(pollChoicesOf(wire, 'ada'), [0, 2]);
assert.deepEqual(pollChoicesOf(wire, 'linus'), []);
assert.equal(pollVoterCount(wire), 2, 'a multi-choice voter is one person');
assert.equal(isPollClosed(wire), false);
assert.equal(isPollClosed({ closesAt: '2000-01-01T00:00:00.000Z', closedAt: null }), true);

// --- DTOs --------------------------------------------------------------------

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

async function dtos(): Promise<void> {
  const channelId = '6f1c1a8e-2d3b-4c5d-8e9f-0a1b2c3d4e5f';
  assert.deepEqual(
    await errorsOf(CreateMessageDto, { channelId, content: 'x', poll: { optionCount: 3 } }),
    [],
  );
  // The nested settings are validated, not waved through.
  assert.deepEqual(
    await errorsOf(CreateMessageDto, { channelId, content: 'x', poll: { optionCount: 11 } }),
    ['poll'],
  );
  // A question smuggled in beside the settings is refused: the words belong in
  // the envelope, and the server will not hold them even when offered.
  assert.deepEqual(
    await errorsOf(CreateMessageDto, {
      channelId,
      content: 'x',
      poll: { optionCount: 2, question: 'lunch?' },
    }),
    ['poll'],
  );
  assert.deepEqual(await errorsOf(VotePollDto, { options: [0, 1] }), []);
  assert.deepEqual(await errorsOf(VotePollDto, { options: [] }), []);
  assert.deepEqual(await errorsOf(VotePollDto, { options: ['yes'] }), ['options']);
  assert.deepEqual(await errorsOf(VotePollDto, {}), ['options']);
}

void dtos().then(() => console.log('polls: ok'));
