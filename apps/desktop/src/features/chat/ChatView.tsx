import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Message } from '@nexora/shared-types';
import { useChatStore } from '../../stores/chat';
import { HashIcon, SendIcon, UsersIcon } from '../../components/icons';

export function ChatView(): JSX.Element {
  const { channels, messages, activeChannelId, loadingMessages, error } = useChatStore();
  const channel = channels.find((item) => item.id === activeChannelId);

  if (!channel) {
    return (
      <section className="flex flex-1 items-center justify-center bg-surface-900">
        <div className="text-center">
          <UsersIcon className="mx-auto h-10 w-10 text-slate-600" />
          <p className="mt-3 text-slate-400">Pick a channel to start talking.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-900">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/30 px-4">
        <HashIcon className="h-5 w-5 text-slate-500" />
        <h1 className="truncate font-semibold text-slate-100">{channel.name}</h1>
        {channel.topic && (
          <>
            <span aria-hidden="true" className="h-4 w-px bg-surface-700" />
            <p className="truncate text-sm text-slate-400">{channel.topic}</p>
          </>
        )}
      </header>

      <MessageList messages={messages} loading={loadingMessages} error={error} />
      <MessageComposer channelName={channel.name} />
    </section>
  );
}

function MessageList({
  messages,
  loading,
  error,
}: {
  messages: Message[];
  loading: boolean;
  error: string | null;
}): JSX.Element {
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (loading) {
    // Skeleton rows keep the layout from jumping when history arrives.
    return (
      <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-busy="true">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex gap-3">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-surface-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 animate-pulse rounded bg-surface-800" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-800" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" role="log" aria-live="polite">
      {messages.length === 0 && (
        <p className="py-10 text-center text-slate-500">
          No messages yet. Say something first.
        </p>
      )}

      <ul className="space-y-4">
        {messages.map((message, index) => {
          // Consecutive messages from one author collapse into a group.
          const previous = messages[index - 1];
          const grouped =
            previous?.author.id === message.author.id &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
              5 * 60 * 1000;

          return (
            <li key={message.id} className={grouped ? 'pl-[52px]' : 'flex gap-3'}>
              {!grouped && (
                <div
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-700 text-sm font-semibold text-slate-200"
                >
                  {message.author.displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                {!grouped && (
                  <p className="flex items-baseline gap-2">
                    <span className="font-semibold text-slate-100">
                      {message.author.displayName}
                    </span>
                    <time
                      dateTime={message.createdAt}
                      className="font-mono text-xs text-slate-500"
                    >
                      {formatTime(message.createdAt)}
                    </time>
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words text-slate-200">{message.content}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={bottom} />
    </div>
  );
}

function MessageComposer({ channelName }: { channelName: string }): JSX.Element {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setFailure(null);
    try {
      await sendMessage(trimmed);
      setContent('');
    } catch (error) {
      // Keep the text in the box so the user does not lose what they typed.
      setFailure(error instanceof Error ? error.message : 'Message failed to send');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="shrink-0 px-4 pb-4">
      {failure && (
        <p role="alert" className="mb-2 text-sm text-red-300">
          {failure}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-lg bg-surface-800 px-3 py-2">
        <label htmlFor="composer" className="sr-only">
          Message #{channelName}
        </label>
        <textarea
          id="composer"
          rows={1}
          value={content}
          maxLength={4000}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Message #${channelName}`}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-slate-100 placeholder-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || content.trim().length === 0}
          aria-label="Send message"
          className="cursor-pointer rounded-md p-2 text-accent transition-colors duration-200 hover:bg-surface-700 disabled:cursor-not-allowed disabled:text-slate-600"
        >
          <SendIcon className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Enter to send, Shift+Enter for a new line.</p>
    </form>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
