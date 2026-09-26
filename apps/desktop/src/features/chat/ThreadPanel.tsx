import { useEffect, useRef, useState } from 'react';
import { MAX_ATTACHMENTS_PER_MESSAGE, type MessageAttachment } from '@betweenus/shared-types';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { PersonAvatar } from '../../components/Avatar';
import {
  BellIcon,
  BellOffIcon,
  FileIcon,
  MessageIcon,
  PaperclipIcon,
  XIcon,
} from '../../components/icons';
import { SkeletonRows } from '../../components/Skeleton';
import { formatBytes, uploadAttachment } from '../../services/attachments';
import { windowIsFocused } from '../../services/notifications';
import { MessageText, Tombstone } from './ChatView';
import { AttachmentList } from './Attachments';
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
 * hangs off. Files go through the same upload and sealing path as the channel
 * composer: each is encrypted under the channel key before it leaves, and the
 * manifest naming them rides inside the reply's envelope.
 *
 * Seeing the newest reply here is what moves this account's read marker in the
 * thread, so the unread dot on its chip goes on every device.
 */
export function ThreadPanel({
  onClose,
  className = 'w-80 shrink-0',
}: ThreadPanelProps = {}): JSX.Element {
  const thread = useChatStore((state) => state.thread);
  const closeThread = useChatStore((state) => state.closeThread);
  const loadOlder = useChatStore((state) => state.loadOlderThread);
  const send = useChatStore((state) => state.sendThreadReply);
  const follow = useChatStore((state) =>
    thread ? state.followedThreads[thread.root.id] : undefined,
  );
  const setFollowing = useChatStore((state) => state.setThreadFollowing);
  const markRead = useChatStore((state) => state.markThreadRead);
  const me = useAuthStore((state) => state.user);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [focused, setFocused] = useState(() => windowIsFocused());
  const end = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const count = thread?.replies.length ?? 0;
  const newest = thread?.replies[count - 1];

  // A new reply scrolls the thread to it; older pages loading above do not.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [newest?.id]);

  // "Seen" needs somebody looking: a panel left open behind another window is
  // not a thread being read.
  useEffect(() => {
    const update = (): void => setFocused(windowIsFocused());
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  // The newest reply is on screen once the first page is in: that is read.
  // `markThreadRead` does nothing for a thread that is not followed or has
  // nothing unread, so this can run on every change without writing.
  const rootId = thread?.root.id;
  const loading = thread?.loading ?? false;
  const unread = follow?.unreadCount ?? 0;
  useEffect(() => {
    if (!rootId || !newest || loading || !focused) return;
    markRead(rootId, newest);
  }, [rootId, newest, loading, focused, unread, markRead]);

  if (!thread) return <aside className={`panel bg-surface-850 ${className}`} />;

  const handleClose = (): void => {
    closeThread();
    onClose?.();
  };

  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) return;
    setFailure(null);
    setFiles((current) => {
      const room = MAX_ATTACHMENTS_PER_MESSAGE - current.length;
      if (incoming.length > room) {
        setFailure(`A message can carry ${MAX_ATTACHMENTS_PER_MESSAGE} files at most`);
      }
      if (room <= 0) return current;
      return [...current, ...incoming.slice(0, room)];
    });
  };

  const submit = async (): Promise<void> => {
    const text = content.trim();
    if ((!text && files.length === 0) || sending) return;
    setSending(true);
    setFailure(null);
    try {
      // The same path the channel composer takes: shrunk, sealed under the
      // channel key and stored, one file at a time with its progress shown.
      const attachments: MessageAttachment[] = [];
      for (const file of files) {
        setUploading({ name: file.name, percent: 0 });
        attachments.push(
          await uploadAttachment(thread.channelId, file, (fraction) =>
            setUploading({ name: file.name, percent: Math.round(fraction * 100) }),
          ),
        );
      }
      await send(text, attachments);
      setContent('');
      setFiles([]);
    } catch (error) {
      // Keep the words and the files; nothing chosen is lost.
      setFailure(error instanceof Error ? error.message : 'Reply failed to send');
    } finally {
      setUploading(null);
      setSending(false);
    }
  };

  const following = follow?.following ?? false;

  return (
    <aside className={`panel flex flex-col bg-surface-850 ${className}`} aria-label="Thread">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        <MessageIcon className="h-4 w-4 text-slate-400" />
        <h2 className="flex-1 text-sm font-semibold text-slate-100">Thread</h2>
        <button
          type="button"
          onClick={() => {
            void setFollowing(thread.root.id, !following).catch((error: unknown) =>
              setFailure(error instanceof Error ? error.message : 'Could not change that'),
            );
          }}
          aria-pressed={following}
          title={following ? 'Stop following this thread' : 'Follow this thread'}
          className="flex h-8 min-h-[44px] sm:min-h-0 sm:h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          {following ? (
            <BellOffIcon className="h-3.5 w-3.5" />
          ) : (
            <BellIcon className="h-3.5 w-3.5" />
          )}
          {following ? 'Unfollow' : 'Follow'}
        </button>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close thread"
          className="flex h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7 cursor-pointer items-center justify-center rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          addFiles([...event.dataTransfer.files]);
        }}
      >
        <div className="border-b border-edge p-3">
          <ThreadMessage message={thread.root} me={me?.id} channelId={thread.channelId} root />
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
                <ThreadMessage message={reply} me={me?.id} channelId={thread.channelId} />
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
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Files to send">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex max-w-full items-center gap-1.5 rounded-md border border-edge bg-surface-800 py-1 ps-2 pe-1 text-xs text-slate-200"
              >
                <FileIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="max-w-[9rem] truncate">{file.name}</span>
                <span className="shrink-0 text-slate-500">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, at) => at !== index))}
                  disabled={sending}
                  aria-label={`Remove ${file.name}`}
                  className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-slate-400 hover:bg-white/[0.07] hover:text-slate-100 disabled:opacity-50"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {uploading && (
          <p className="mb-1 truncate text-xs text-slate-400" aria-live="polite">
            Uploading {uploading.name} - {uploading.percent}%
          </p>
        )}
        <div className="flex items-end gap-1.5">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              // The same file picked twice in a row must still fire a change.
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={sending}
            aria-label="Attach files"
            title="Attach files"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 disabled:opacity-50"
          >
            <PaperclipIcon className="h-4 w-4" />
          </button>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onPaste={(event) => {
              const pasted = [...event.clipboardData.files];
              if (pasted.length === 0) return;
              event.preventDefault();
              addFiles(pasted);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder="Reply in thread"
            aria-label="Reply in thread"
            className="min-w-0 flex-1 resize-none rounded-lg border border-edge bg-surface-800 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-white/[0.14]"
          />
        </div>
      </form>
    </aside>
  );
}

function ThreadMessage({
  message,
  me,
  channelId,
  root = false,
}: {
  message: DecryptedMessage;
  me: string | undefined;
  channelId: string;
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
            {message.attachments.length > 0 &&
              (message.viewOnce ? (
                // A one-time root is not opened from a side panel: looking is
                // what destroys it, and that belongs in the channel.
                <p className="text-xs italic text-slate-500">One-time media - open it in the channel</p>
              ) : (
                <AttachmentList
                  channelId={channelId}
                  attachments={message.attachments}
                  author={message.author}
                  mine={message.author.id === me}
                />
              ))}
            {message.editedAt && <span className="text-[10px] text-slate-500">edited</span>}
          </>
        )}
      </div>
    </div>
  );
}
