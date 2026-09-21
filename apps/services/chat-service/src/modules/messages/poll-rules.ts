/**
 * The referee's rules for a poll, with no database in them.
 *
 * Play Together keeps its rules pure so the gateway and every client judge a
 * move the same way; this is the same idea at a smaller size. A vote is a list
 * of option indexes, and whether it is legal depends on three numbers the
 * server holds and nothing it would have to decrypt. Split out so the policy
 * can be asserted on without Postgres - see `poll.check.ts`.
 */
import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  isPollDuration,
  type CreatePollSettings,
  type MessagePoll,
  type MessagePollTally,
} from '@betweenus/shared-types';

/** Why a ballot or a poll was refused. Each is an error `code` on the wire. */
export type PollRefusal =
  | 'INVALID_POLL'
  | 'POLL_CLOSED'
  | 'INVALID_VOTE'
  | 'SINGLE_CHOICE_POLL';

export type Judged<T> = { ok: true; value: T } | { ok: false; code: PollRefusal; message: string };

/** The settings a poll is created with, once checked. */
export interface PollSpec {
  optionCount: number;
  multiChoice: boolean;
  closesAt: Date | null;
}

/**
 * Checks what a client asked for when it sent a poll. The duration is turned
 * into a moment here, on the server's clock, so a client cannot backdate a
 * poll into being closed or stretch it past the longest duration offered.
 */
export function judgePollSettings(settings: CreatePollSettings, now: Date): Judged<PollSpec> {
  const count = settings.optionCount;
  if (!Number.isInteger(count) || count < POLL_MIN_OPTIONS || count > POLL_MAX_OPTIONS) {
    return {
      ok: false,
      code: 'INVALID_POLL',
      message: `A poll needs ${POLL_MIN_OPTIONS}-${POLL_MAX_OPTIONS} options`,
    };
  }
  if (!isPollDuration(settings.durationSeconds)) {
    return { ok: false, code: 'INVALID_POLL', message: 'That is not a poll duration' };
  }
  const seconds = settings.durationSeconds ?? null;
  return {
    ok: true,
    value: {
      optionCount: count,
      multiChoice: settings.multiChoice ?? false,
      closesAt: seconds === null ? null : new Date(now.getTime() + seconds * 1000),
    },
  };
}

/** The server-side state a ballot is judged against. */
export interface PollState {
  optionCount: number;
  multiChoice: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
}

export function pollIsClosed(poll: Pick<PollState, 'closesAt' | 'closedAt'>, now: Date): boolean {
  if (poll.closedAt !== null) return true;
  return poll.closesAt !== null && poll.closesAt.getTime() <= now.getTime();
}

/**
 * Checks one person's ballot and returns it normalised - sorted, without
 * duplicates. An empty ballot is legal: it is how a vote is taken back.
 *
 * The order of the checks is the order of the questions a person would ask:
 * is it still open, is every choice a real option, and did I pick more than
 * I was allowed.
 */
export function judgeBallot(poll: PollState, options: number[], now: Date): Judged<number[]> {
  if (pollIsClosed(poll, now)) {
    return { ok: false, code: 'POLL_CLOSED', message: 'This poll is closed' };
  }
  for (const option of options) {
    if (!Number.isInteger(option) || option < 0 || option >= poll.optionCount) {
      return { ok: false, code: 'INVALID_VOTE', message: 'That option is not in this poll' };
    }
  }
  const ballot = [...new Set(options)].sort((left, right) => left - right);
  if (!poll.multiChoice && ballot.length > 1) {
    return {
      ok: false,
      code: 'SINGLE_CHOICE_POLL',
      message: 'This poll takes one choice',
    };
  }
  return { ok: true, value: ballot };
}

/**
 * Groups vote rows into one tally per option, in option order, including the
 * options nobody chose - so a client can draw an empty bar without having to
 * know the count from somewhere else. A row outside the range (which the
 * checks above never write) is dropped rather than drawn.
 */
export function tally(
  optionCount: number,
  votes: Array<{ userId: string; option: number }>,
): MessagePollTally[] {
  const tallies: MessagePollTally[] = Array.from({ length: optionCount }, (_, option) => ({
    option,
    userIds: [],
  }));
  for (const vote of votes) {
    tallies[vote.option]?.userIds.push(vote.userId);
  }
  return tallies;
}

/** The row shape a poll is read out of the database in. */
export interface PollRow {
  optionCount: number;
  multiChoice: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
  closedById: string | null;
  votes: Array<{ userId: string; option: number }>;
}

export function toPoll(row: PollRow): MessagePoll {
  return {
    optionCount: row.optionCount,
    multiChoice: row.multiChoice,
    closesAt: row.closesAt ? row.closesAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closedBy: row.closedById,
    tallies: tally(row.optionCount, row.votes),
  };
}
