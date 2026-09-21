/**
 * A poll in the message list: bars, counts, who chose what, your own choice
 * highlighted, and the controls to change it, take it back, or close the poll.
 *
 * Everything drawn here is the referee's: the counts arrive with the message
 * and every vote is a request the server answers with the new tally, which
 * reaches this card over the same socket event a reaction does. There is no
 * optimistic bar, so what is on screen is always what was counted.
 */
import { useState } from 'react';
import type { MessagePoll } from '@betweenus/shared-types';
import { useChatStore } from '../../stores/chat';
import { nextBallot, pollDeadline, pollView } from '../../services/polls';
import { reactorNames } from '../../services/reactions';

export function PollCard({
  messageId,
  poll,
  labels,
  meId,
  authorId,
  canModerate,
}: {
  messageId: string;
  poll: MessagePoll;
  labels: string[];
  meId: string | undefined;
  authorId: string;
  /** Holds MANAGE_MESSAGE in this server. Always false in a direct message. */
  canModerate: boolean;
}): JSX.Element {
  const members = useChatStore((state) => state.members);
  const votePoll = useChatStore((state) => state.votePoll);
  const closePoll = useChatStore((state) => state.closePoll);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const view = pollView(poll, labels, meId);
  const deadline = pollDeadline(poll);
  const canClose = !view.closed && (authorId === meId || canModerate);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 w-full min-w-[16rem] max-w-md space-y-1.5" role="group" aria-label="Poll">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {view.multiChoice ? 'Choose any' : 'Choose one'}
        {deadline ? ` · ${deadline}` : ''}
      </p>
      <ul className="space-y-1.5">
        {view.bars.map((bar) => {
          const who = reactorNames(bar.userIds, members, meId);
          return (
            <li key={bar.option}>
              <button
                type="button"
                disabled={busy || view.closed}
                onClick={() => void run(() => votePoll(messageId, nextBallot(view, bar.option)))}
                aria-pressed={bar.mine}
                title={who ? `${who} chose ${bar.label}` : undefined}
                className={`relative w-full cursor-pointer overflow-hidden rounded-md border px-3 py-2 text-start text-sm transition-colors duration-150 disabled:cursor-default ${
                  bar.mine ? 'border-accent text-slate-50' : 'border-edge text-slate-200 hover:border-surface-600'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 start-0 transition-[width] duration-300 ${
                    bar.mine ? 'bg-accent/30' : bar.leading && view.closed ? 'bg-surface-600' : 'bg-surface-700'
                  }`}
                  style={{ width: `${bar.percent}%` }}
                />
                <span className="relative flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {bar.mine ? '✓ ' : ''}
                    {bar.label}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">
                    {bar.count} · {bar.percent}%
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>
          {view.voters} {view.voters === 1 ? 'vote' : 'votes'}
        </span>
        {!view.closed && view.mine.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => votePoll(messageId, []))}
            className="cursor-pointer underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Retract vote
          </button>
        )}
        {canClose && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => closePoll(messageId))}
            className="ms-auto cursor-pointer underline-offset-2 hover:text-danger hover:underline"
          >
            Close poll
          </button>
        )}
      </div>
      {failure && (
        <p role="alert" className="text-xs text-danger">
          {failure}
        </p>
      )}
    </div>
  );
}
