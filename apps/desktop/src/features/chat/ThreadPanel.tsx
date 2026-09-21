import { useEffect, useRef, useState } from 'react';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { PersonAvatar } from '../../components/Avatar';
import { MessageIcon, XIcon } from '../../components/icons';
import { SkeletonRows } from '../../components/Skeleton';
import { MessageText, Tombstone } from './ChatView';
import { clockTime } from './day';

export interface ThreadPanelProps {
  onClose?: () => void;
  className?: string;
}

/**
 * A thread, in the column the pinned list and the member list share.
 *
 * The root sits at the top exactly as it does in the channel, replies under it
 * oldest first, and a composer of its own at the bottom. Everything said here
 * is sealed with the channel's key - the server only knows which root a reply
 * hangs off. The composer is text only in this build; a reply that arrives with
 * files (from a phone) says how many rather than drawing them.
 */
export function ThreadPanel({
  onClose,
  className = 'w-80 shrink-0',
}: ThreadPanelProps = {}): JSX.Element {
  const thread = useChatStore((state) => state.thread);
  const closeThread = useChatStore((state) => state.closeThread);
  const loadOlder = useChatStore((state) => state.loadOlderThread);
  const send = useChatStore((state) => state.sendThreadReply);
  const me = useAuthStore((state) => state.user);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const count = thread?.replies.length ?? 0;
  const newest = thread?.replies[count - 1]?.id;

  // A new reply scrolls the thread to it; older pages loading above do not.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [newest]);

  if (!thread) return <aside className={`panel bg-surface-850 ${className}`} />;

  const handleClose = (): void => {
    closeThread();
    onClose?.();
  };

  const submit = async (): Promise<void> => {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    setFailure(null);
    try {
      await send(text);
      setContent('');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Reply failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className={`panel flex flex-col bg-surface-850 ${className}`} aria-label="Thread">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        <MessageIcon className="h-4 w-4 text-slate-400" />
        <h2 className="flex-1 text-sm font-semibold text-slate-100">Thread</h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close thread"
          className="flex h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7 cursor-pointer items-center justify-center rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-edge p-3">
          <ThreadMessage message={thread.root} me={me?.id} root />
          <p className="mt-2 text-xs text-slate-500">
            {count === 1 ? '1 reply' : `${count} replies`}
          </p>
        </div>

        {thread.cursor && (
          <button
            type="button"
            onClick={() => void loadOlder()}
            disabled={thread.loading}
            className="mx-3 mt-2 cursor-pointer text-xs text-accent hover:underline disabled:opacity-50"
          >
            Load earlier replies
          </button>
        )}

        {thread.loading && count === 0 ? (
          <SkeletonRows rows={3} label="Loading replies" className="p-3" />
        ) : thread.error ? (
          <p role="alert" className="p-3 text-sm text-danger">
            {thread.error}
          </p>
        ) : count === 0 ? (
          <p className="p-3 text-sm text-slate-400">No replies yet. Start the thread below.</p>
        ) : (
          <ul className="space-y-3 p-3">
            {thread.replies.map((reply) => (
              <li key={reply.id}>
                <ThreadMessage message={reply} me={me?.id} />
              </li>
            ))}
          </ul>
        )}
        <div ref={end} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="shrink-0 border-t border-edge p-2"
      >
        {failure && (
          <p role="alert" className="mb-1 text-xs text-danger">
            {failure}
          </p>
        )}
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={2}
          placeholder="Reply in thread"
          aria-label="Reply in thread"
          className="w-full resize-none rounded-lg border border-edge bg-surface-800 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-white/[0.14]"
        />
      </form>
    </aside>
  );
}

function ThreadMessage({
  message,
  me,
  root = false,
}: {
  message: DecryptedMessage;
  me: string | undefined;
  root?: boolean;
}): JSX.Element {
  const deleted = message.deletedAt !== null;
  return (
    <div className="flex items-start gap-2">
      <PersonAvatar
        userId={message.author.id}
        name={message.author.displayName}
        avatarUrl={message.author.avatarUrl}
        size="sm"
        ringColour="border-surface-850"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-1.5">
          <span
            className={`truncate text-sm font-semibold ${
              message.author.id === me ? 'text-accent' : 'text-slate-100'
            }`}
          >
            {message.author.id === me ? 'You' : message.author.displayName}
          </span>
          <time dateTime={message.createdAt} className="shrink-0 text-[11px] text-slate-500">
            {clockTime(message.createdAt)}
          </time>
        </p>
        {deleted ? (
          root ? (
            // The thread outlives its root: it is somebody else's conversation.
            <p className="text-sm italic text-slate-500">Original message deleted</p>
          ) : (
            <Tombstone message={message} />
          )
        ) : (
          <>
            {message.content.length > 0 && (
              <div className="break-words text-sm leading-relaxed text-slate-200">
                <MessageText message={message} />
              </div>
            )}
            {message.attachments.length > 0 && (
              <p className="text-xs italic text-slate-500">
                {message.attachments.length === 1
                  ? '1 attachment - open it in the channel'
                  : `${message.attachments.length} attachments - open them in the channel`}
              </p>
            )}
            {message.editedAt && <span className="text-[10px] text-slate-500">edited</span>}
          </>
        )}
      </div>
    </div>
  );
}
