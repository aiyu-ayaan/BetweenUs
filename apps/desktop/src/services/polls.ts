/**
 * What a poll card draws, and what the poll composer will let through.
 *
 * No app wiring on purpose, so it runs under Node for
 * `pnpm --filter @betweenus/desktop check`. The server referees the votes and
 * holds only numbers; everything with a word in it happens here, after the
 * envelope is opened, and before it is sealed.
 */
import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_CHARS,
  POLL_QUESTION_MAX_CHARS,
  isPollClosed,
  pollChoicesOf,
  pollVoterCount,
  type MessagePoll,
  type PollDuration,
} from '@betweenus/shared-types';

/** One bar on the card. */
export interface PollBar {
  option: number;
  label: string;
  count: number;
  /** Share of the people who voted, 0-100, rounded. Not of the ballots cast. */
  percent: number;
  mine: boolean;
  /** The option with the most votes, ties included. Nothing leads a poll nobody has answered. */
  leading: boolean;
  userIds: string[];
}

export interface PollView {
  bars: PollBar[];
  voters: number;
  closed: boolean;
  multiChoice: boolean;
  mine: number[];
}

/**
 * The card's numbers. Percentages are of *people*, not of ballots: in a
 * multi-choice poll three people choosing two options each is six ballots, and
 * "50%" should mean half of the people who answered, which is the question a
 * reader is asking.
 *
 * The labels come from the envelope and the counts from the server; a server
 * tally with more options than labels is cut to the labels, and the missing
 * labels read as "Option N" rather than disappearing.
 */
export function pollView(
  poll: MessagePoll,
  labels: readonly string[],
  meId: string | undefined,
  now = Date.now(),
): PollView {
  const voters = pollVoterCount(poll);
  const top = Math.max(0, ...poll.tallies.map((tally) => tally.userIds.length));
  const bars = Array.from({ length: poll.optionCount }, (_, option): PollBar => {
    const userIds = poll.tallies.find((tally) => tally.option === option)?.userIds ?? [];
    return {
      option,
      label: labels[option] ?? `Option ${option + 1}`,
      count: userIds.length,
      percent: voters === 0 ? 0 : Math.round((userIds.length / voters) * 100),
      mine: meId !== undefined && userIds.includes(meId),
      leading: top > 0 && userIds.length === top,
      userIds,
    };
  });
  return {
    bars,
    voters,
    closed: isPollClosed(poll, now),
    multiChoice: poll.multiChoice,
    mine: meId === undefined ? [] : pollChoicesOf(poll, meId),
  };
}

/**
 * The ballot that clicking one option produces.
 *
 * Single choice: clicking your choice takes it back, clicking another moves
 * it. Multi choice: clicking toggles that one option and leaves the rest. The
 * whole ballot is what gets sent, so the server's answer is idempotent.
 */
export function nextBallot(view: Pick<PollView, 'mine' | 'multiChoice'>, option: number): number[] {
  const had = view.mine.includes(option);
  if (!view.multiChoice) return had ? [] : [option];
  return had
    ? view.mine.filter((chosen) => chosen !== option)
    : [...view.mine, option].sort((left, right) => left - right);
}

/** The composer's draft, as typed. */
export interface PollDraft {
  question: string;
  options: string[];
}

export type PollDraftResult =
  | { ok: true; question: string; options: string[] }
  | { ok: false; reason: string };

/**
 * Checks a draft and returns the words to seal.
 *
 * Empty option rows are dropped rather than refused - the composer always
 * shows a spare empty row to type into - and duplicates are refused, because
 * two identical labels are a poll whose result nobody can read.
 */
export function readyPoll(draft: PollDraft): PollDraftResult {
  const question = draft.question.trim();
  if (!question) return { ok: false, reason: 'Ask a question' };
  if (question.length > POLL_QUESTION_MAX_CHARS) {
    return { ok: false, reason: `Keep the question under ${POLL_QUESTION_MAX_CHARS} characters` };
  }
  const options = draft.options.map((option) => option.trim()).filter((option) => option.length > 0);
  if (options.length < POLL_MIN_OPTIONS) {
    return { ok: false, reason: `Give at least ${POLL_MIN_OPTIONS} options` };
  }
  if (options.length > POLL_MAX_OPTIONS) {
    return { ok: false, reason: `A poll has at most ${POLL_MAX_OPTIONS} options` };
  }
  if (options.some((option) => option.length > POLL_OPTION_MAX_CHARS)) {
    return { ok: false, reason: `Keep each option under ${POLL_OPTION_MAX_CHARS} characters` };
  }
  const seen = new Set(options.map((option) => option.toLocaleLowerCase()));
  if (seen.size !== options.length) return { ok: false, reason: 'Two options say the same thing' };
  return { ok: true, question, options };
}

/** What each duration is called in the picker. Null is "no limit". */
export const POLL_DURATION_LABELS: ReadonlyArray<{ seconds: PollDuration | null; label: string }> = [
  { seconds: null, label: 'No limit' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86400, label: '1 day' },
  { seconds: 259200, label: '3 days' },
  { seconds: 604800, label: '1 week' },
];

/** "Closes in 3h", "Closed", or null when it runs until somebody closes it. */
export function pollDeadline(poll: Pick<MessagePoll, 'closesAt' | 'closedAt'>, now = Date.now()): string | null {
  if (isPollClosed(poll, now)) return 'Closed';
  if (poll.closesAt === null) return null;
  const left = Date.parse(poll.closesAt) - now;
  const minutes = Math.max(1, Math.ceil(left / 60_000));
  if (minutes < 60) return `Closes in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `Closes in ${hours}h`;
  return `Closes in ${Math.ceil(hours / 24)}d`;
}

/**
 * A poll's line in a notification or a reply quote. Built on this machine,
 * from the opened envelope: the push that woke it carried only ciphertext, so
 * the question is never in anything a server or a push relay holds.
 */
export function pollPreview(question: string): string {
  return `Poll: ${question}`;
}
