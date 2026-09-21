import { useEffect, useState } from 'react';
import { useScheduledStore, openMessage } from '../../stores/scheduled';
import { serverNow } from '../../services/server-clock';
import {
  SEND_PRESETS,
  REMIND_PRESETS,
  dueLabel,
  stateOf,
  type Scheduled,
  type ScheduledState,
} from '../../services/schedule';
import { ClockIcon, XIcon } from '../../components/icons';
import { WhenPicker } from './WhenPicker';

export interface ScheduledPanelProps {
  onClose?: () => void;
  className?: string;
}

const STATE_WORDS: Record<ScheduledState, string> = {
  waiting: '',
  due: 'Sending…',
  late: 'Overdue - goes as soon as this device can',
  retrying: 'Could not send - trying again',
  failed: 'Not sent',
};

/**
 * Scheduled messages and reminders across every conversation.
 *
 * Global rather than per channel: they are held by this device, not by a
 * channel, and "what is this machine going to do on my behalf" is one question.
 * The footer says the one thing that matters about that.
 */
export function ScheduledPanel({
  onClose,
  className = 'w-72 shrink-0',
}: ScheduledPanelProps = {}): JSX.Element {
  const items = useScheduledStore((state) => state.items);
  const sending = useScheduledStore((state) => state.sending);
  const { reschedule, sendNow, cancel } = useScheduledStore.getState();
  const [editing, setEditing] = useState<{ item: Scheduled; at: { x: number; y: number } } | null>(
    null,
  );
  // Re-drawn each minute so "Overdue" and "Today at" stay true while it is open.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const now = serverNow();
  const messages = items.filter((item) => item.kind === 'message');
  const reminders = items.filter((item) => item.kind === 'reminder');

  const row = (item: Scheduled): JSX.Element => {
    const state = stateOf(item, now);
    const busy = sending.includes(item.id);
    const where = item.serverId ? `#${item.channelName}` : item.channelName;
    const button =
      'cursor-pointer rounded px-1.5 py-0.5 text-xs text-slate-300 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 disabled:cursor-not-allowed disabled:text-slate-600';
    return (
      <li key={item.id} className="rounded-lg bg-surface-800 p-2.5">
        <button
          type="button"
          onClick={() =>
            void openMessage(item, item.kind === 'reminder' ? item.messageId : undefined)
          }
          className="block w-full cursor-pointer text-start"
        >
          <span className="block truncate text-xs text-slate-400">
            {item.kind === 'reminder' ? `About ${item.author} in ${where}` : `To ${where}`}
          </span>
          <span className="mt-1 block line-clamp-3 break-words text-sm text-slate-200">
            {item.kind === 'reminder' ? item.excerpt || 'A message' : item.text}
          </span>
        </button>
        <span className="mt-1.5 block text-xs text-slate-400">
          {dueLabel(item.dueAt, new Date(now))}
        </span>
        {item.kind === 'message' && (state !== 'waiting' || item.error) && (
          <span
            role={state === 'failed' ? 'alert' : undefined}
            className={`mt-0.5 block text-xs ${state === 'failed' ? 'text-danger' : 'text-slate-500'}`}
          >
            {state === 'failed' && item.error ? item.error : STATE_WORDS[state]}
          </span>
        )}
        <span className="mt-1.5 flex items-center gap-1">
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={(event) => setEditing({ item, at: { x: event.clientX, y: event.clientY } })}
          >
            Change time
          </button>
          {item.kind === 'message' && (
            <button type="button" className={button} disabled={busy} onClick={() => void sendNow(item.id)}>
              {state === 'failed' ? 'Try again' : 'Send now'}
            </button>
          )}
          <button
            type="button"
            className={`${button} ms-auto`}
            disabled={busy}
            onClick={() => void cancel(item.id)}
          >
            Cancel
          </button>
        </span>
      </li>
    );
  };

  const section = (title: string, list: Scheduled[]): JSX.Element | null =>
    list.length === 0 ? null : (
      <section>
        <h3 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h3>
        <ul className="space-y-2">{list.map(row)}</ul>
      </section>
    );

  return (
    <aside className={`panel flex flex-col bg-surface-850 ${className}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        <ClockIcon className="h-4 w-4 text-slate-400" />
        <h2 className="flex-1 text-sm font-semibold text-slate-100">Scheduled</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close scheduled messages"
          className="flex h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7 cursor-pointer items-center justify-center rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
        {items.length === 0 && (
          <p className="px-2 py-4 text-sm text-slate-400">
            Nothing scheduled. Right-click the send button to send a message later, or right-click
            a message and choose <em>Remind me</em>.
          </p>
        )}
        {section('Scheduled messages', messages)}
        {section('Reminders', reminders)}
      </div>

      <p className="shrink-0 border-t border-edge px-3 py-2 text-xs text-slate-500">
        These are kept on this device only, and sent from it - the server never holds them. This
        device has to be running at the time; if it was not, they go when it next is, and say so.
      </p>

      {editing && (
        <WhenPicker
          at={editing.at}
          title="Change time"
          presets={editing.item.kind === 'message' ? SEND_PRESETS : REMIND_PRESETS}
          confirmLabel="Set"
          initial={editing.item.dueAt}
          onPick={(dueAt) => void reschedule(editing.item.id, dueAt)}
          onClose={() => setEditing(null)}
        />
      )}
    </aside>
  );
}
