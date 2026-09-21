/**
 * The create-a-poll dialog: a question, two to ten options, a multi-choice
 * switch and an optional duration.
 *
 * The words never leave this machine unsealed. `sendPoll` puts them in the
 * message envelope and tells the server only how many options there are.
 */
import { useState } from 'react';
import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_CHARS,
  POLL_QUESTION_MAX_CHARS,
} from '@betweenus/shared-types';
import { useChatStore } from '../../stores/chat';
import { POLL_DURATION_LABELS, readyPoll } from '../../services/polls';
import { useFocusTrap } from '../../services/focus-trap';
import { XIcon } from '../../components/icons';

export function PollComposer({ onClose }: { onClose: () => void }): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const sendPoll = useChatStore((state) => state.sendPoll);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiChoice, setMultiChoice] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const ready = readyPoll({ question, options });

  const submit = async (): Promise<void> => {
    if (!ready.ok) {
      setFailure(ready.reason);
      return;
    }
    setSending(true);
    try {
      await sendPoll(ready.question, ready.options, multiChoice, duration);
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The poll was not sent');
      setSending(false);
    }
  };

  const setOption = (index: number, value: string): void =>
    setOptions((current) => current.map((option, at) => (at === index ? value : option)));

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label="Create a poll"
      className="fixed inset-0 z-50 flex animate-fade items-end justify-center bg-black/60 px-4 sm:items-center"
      onClick={onClose}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md animate-pop flex-col overflow-y-auto rounded-t-xl border border-edge bg-surface-900 p-5 shadow-pop sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-50">Create a poll</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer text-slate-400 hover:text-slate-100"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-4 text-xs font-semibold text-slate-400" htmlFor="poll-question">
          Question
        </label>
        <input
          id="poll-question"
          autoFocus
          value={question}
          maxLength={POLL_QUESTION_MAX_CHARS}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What should we have for lunch?"
          className="mt-1 rounded-lg border border-edge bg-surface-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-accent"
        />

        <p className="mt-4 text-xs font-semibold text-slate-400">Options</p>
        <ul className="mt-1 space-y-1.5">
          {options.map((option, index) => (
            <li key={index} className="flex items-center gap-2">
              <input
                value={option}
                maxLength={POLL_OPTION_MAX_CHARS}
                onChange={(event) => setOption(index, event.target.value)}
                placeholder={`Option ${index + 1}`}
                aria-label={`Option ${index + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-accent"
              />
              {options.length > POLL_MIN_OPTIONS && (
                <button
                  type="button"
                  onClick={() => setOptions((current) => current.filter((_, at) => at !== index))}
                  aria-label={`Remove option ${index + 1}`}
                  className="cursor-pointer text-slate-500 hover:text-danger"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {options.length < POLL_MAX_OPTIONS && (
          <button
            type="button"
            onClick={() => setOptions((current) => [...current, ''])}
            className="mt-2 cursor-pointer self-start text-sm text-accent hover:underline"
          >
            Add an option
          </button>
        )}

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={multiChoice}
            onChange={(event) => setMultiChoice(event.target.checked)}
          />
          Allow more than one choice
        </label>

        <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
          Closes
          <select
            value={duration ?? ''}
            onChange={(event) =>
              setDuration(event.target.value === '' ? null : Number(event.target.value))
            }
            className="rounded-md border border-edge bg-surface-950 px-2 py-1 text-sm text-slate-100"
          >
            {POLL_DURATION_LABELS.map((entry) => (
              <option key={entry.label} value={entry.seconds ?? ''}>
                {entry.seconds === null ? 'When I close it' : `After ${entry.label}`}
              </option>
            ))}
          </select>
        </label>

        <p className="mt-3 text-xs text-slate-500">
          The question and options are encrypted like any message. The server only counts votes.
        </p>
        {failure && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {failure}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-slate-300 hover:text-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={sending || !ready.ok}
            onClick={() => void submit()}
            className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send poll'}
          </button>
        </div>
      </div>
    </div>
  );
}
