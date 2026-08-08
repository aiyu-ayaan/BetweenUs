import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Channel, Message } from '@nexora/shared-types';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { Avatar } from '../../components/Avatar';
import { HashIcon, LockIcon, MessageIcon, SendIcon, UsersIcon } from '../../components/icons';

export function ChatView({ onToggleMembers }: { onToggleMembers?: () => void }): JSX.Element {
  const { messages, loadingMessages, error } = useChatStore();
  const channel = useChatStore((state) => state.activeChannel());

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

  const isDirect = channel.type === 'DM';

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-900">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/20 px-4 shadow-sm">
        {isDirect ? (
          <Avatar name={channel.name} size="sm" ringColour="border-surface-900" />
        ) : channel.isPrivate ? (
          <LockIcon className="h-5 w-5 text-slate-500" />
        ) : (
          <HashIcon className="h-5 w-5 text-slate-500" />
        )}
        <h1 className="truncate font-semibold text-slate-50">{channel.name}</h1>

        {channel.topic && (
          <>
            <span aria-hidden="true" className="h-5 w-px bg-surface-700" />
            <p className="truncate text-sm text-slate-400">{channel.topic}</p>
          </>
        )}

        {onToggleMembers && !isDirect && (
          <button
            type="button"
            onClick={onToggleMembers}
            aria-label="Toggle member list"
            title="Members"
            className="ml-auto cursor-pointer rounded p-1.5 text-slate-300 transition-colors duration-200 hover:bg-surface-700 hover:text-slate-50"
          >
            <UsersIcon className="h-5 w-5" />
          </button>
        )}
      </header>

      <MessageList
        messages={messages}
        loading={loadingMessages}
        error={error}
        channel={channel}
      />
      <TypingIndicator channelId={channel.id} />
      <MessageComposer channel={channel} />
    </section>
  );
}

function MessageList({
  messages,
  loading,
  error,
  channel,
}: {
  messages: Message[];
  loading: boolean;
  error: string | null;
  channel: Channel;
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
        <p role="alert" className="rounded-md bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" role="log" aria-live="polite">
      {messages.length === 0 && <EmptyChannel channel={channel} />}

      <ul>
        {messages.map((message, index) => {
          // Consecutive messages from one author collapse into a group.
          const previous = messages[index - 1];
          const grouped =
            previous?.author.id === message.author.id &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
              5 * 60 * 1000;

          return (
            <li
              key={message.id}
              className={`group rounded px-2 hover:bg-surface-950/25 ${
                grouped ? 'py-0.5 pl-[60px]' : 'mt-4 flex gap-3 py-0.5'
              }`}
            >
              {!grouped && (
                <Avatar
                  name={message.author.displayName}
                  avatarUrl={message.author.avatarUrl}
                  ringColour="border-surface-900"
                />
              )}
              <div className="min-w-0">
                {!grouped && (
                  <p className="flex items-baseline gap-2">
                    <span className="font-medium text-slate-50">
                      {message.author.displayName}
                    </span>
                    <time dateTime={message.createdAt} className="text-xs text-slate-500">
                      {formatTime(message.createdAt)}
                    </time>
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-200">
                  {message.content}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={bottom} />
    </div>
  );
}

/** Discord puts the "this is the beginning" block here; so does this. */
function EmptyChannel({ channel }: { channel: Channel }): JSX.Element {
  const direct = channel.type === 'DM';

  return (
    <div className="px-2 py-10">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-700">
        {direct ? (
          <MessageIcon className="h-8 w-8 text-slate-300" />
        ) : (
          <HashIcon className="h-8 w-8 text-slate-300" />
        )}
      </div>
      <h2 className="mt-4 text-3xl font-bold text-slate-50">
        {direct ? channel.name : `Welcome to #${channel.name}`}
      </h2>
      <p className="mt-1 text-slate-400">
        {direct
          ? `This is the beginning of your conversation with ${channel.name}.`
          : `This is the start of the #${channel.name} channel.`}
      </p>
    </div>
  );
}

function TypingIndicator({ channelId }: { channelId: string }): JSX.Element {
  const typing = usePresenceStore((state) => state.typing.get(channelId));
  const names = [...(typing?.values() ?? [])]
    .filter((entry) => entry.until > Date.now())
    .map((entry) => entry.username);

  // Reserve the row even when empty, so the composer does not jump.
  return (
    <p className="h-5 px-5 text-xs text-slate-400" aria-live="polite">
      {names.length === 1 && `${names[0]} is typing…`}
      {names.length === 2 && `${names[0]} and ${names[1]} are typing…`}
      {names.length > 2 && 'Several people are typing…'}
    </p>
  );
}

function MessageComposer({ channel }: { channel: Channel }): JSX.Element {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const notifyTyping = usePresenceStore((state) => state.notifyTyping);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const placeholder =
    channel.type === 'DM' ? `Message @${channel.name}` : `Message #${channel.name}`;

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
    <form onSubmit={(event) => void submit(event)} className="shrink-0 px-4 pb-6">
      {failure && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {failure}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-lg bg-surface-600 px-4 py-2.5">
        <label htmlFor="composer" className="sr-only">
          {placeholder}
        </label>
        <textarea
          id="composer"
          rows={1}
          value={content}
          maxLength={4000}
          onChange={(event) => {
            setContent(event.target.value);
            if (event.target.value.length > 0) notifyTyping(channel.id);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-slate-100 placeholder-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={sending || content.trim().length === 0}
          aria-label="Send message"
          className="cursor-pointer rounded-md p-1 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
        >
          <SendIcon className="h-5 w-5" />
        </button>
      </div>
    </form>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
