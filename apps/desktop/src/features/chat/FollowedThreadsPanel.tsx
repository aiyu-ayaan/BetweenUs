import { useEffect } from 'react';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { PersonAvatar } from '../../components/Avatar';
import { HashIcon, MessageIcon, XIcon } from '../../components/icons';
import { SkeletonRows } from '../../components/Skeleton';
import { listState } from '../../services/list-state';
import { previewText } from '../../services/markup';
import { threadChipLabel, threadUnreadBadge } from './thread';

export interface FollowedThreadsPanelProps {
  onClose?: () => void;
  className?: string;
}

/**
 * The threads this account follows in the server on screen - or among the
 * direct messages, at home - most recently active first, each with its unread
 * count. Opening one goes to its channel and opens the thread beside it.
 *
 * Every root is decrypted here with the channel key, like any message; the
 * server only told this client which roots, and how many replies are unread.
 */
export function FollowedThreadsPanel({
  onClose,
  className = 'w-72 shrink-0',
}: FollowedThreadsPanelProps = {}): JSX.Element {
  const me = useAuthStore((state) => state.user);
  const list = useChatStore((state) => state.followedList);
  const follows = useChatStore((state) => state.followedThreads);
  const loadList = useChatStore((state) => state.loadFollowedList);
  const showPanel = useChatStore((state) => state.showPanel);
  const serverId = useChatStore((state) => (state.view === 'server' ? state.activeServerId : null));
  const channels = useChatStore((state) => state.channels);
  const directs = useChatStore((state) => state.directs);

  // A different server is a different list.
  useEffect(() => {
    void loadList();
  }, [loadList, serverId]);

  // Unfollowed elsewhere drops out of the list at once; the order is the
  // server's (most recent reply first) as of the last load.
  const items = list.items.filter((root) => follows[root.id]?.following);

  const handleClose = (): void => {
    if (onClose) onClose();
    else showPanel('none');
  };

  const open = async (root: DecryptedMessage): Promise<void> => {
    const state = useChatStore.getState();
    if (state.activeChannelId !== root.channelId) await state.selectChannel(root.channelId);
    await useChatStore.getState().openThread(root);
  };

  const channelName = (channelId: string): string =>
    [...channels, ...directs].find((channel) => channel.id === channelId)?.name ?? 'a channel';

  const shown = listState(items.length, list.loading);

  return (
    <aside className={`panel flex flex-col bg-surface-850 ${className}`} aria-label="Followed threads">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        <MessageIcon className="h-4 w-4 text-slate-400" />
        <h2 className="flex-1 text-sm font-semibold text-slate-100">Followed threads</h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close followed threads"
          className="flex h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7 cursor-pointer items-center justify-center rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      {list.error && items.length === 0 ? (
        <p role="alert" className="px-4 py-6 text-sm text-danger">
          {list.error}
        </p>
      ) : shown === 'loading' ? (
        <SkeletonRows rows={3} label="Loading followed threads" className="p-3" />
      ) : shown === 'empty' ? (
        <p className="px-4 py-6 text-sm text-slate-400">
          No followed threads here. You follow a thread when you start or reply to one, or
          with <em>Follow</em> in its panel.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {items.map((root) => {
            const badge = threadUnreadBadge(follows[root.id]);
            const chip = threadChipLabel(root.thread);
            return (
              <li key={root.id}>
                <button
                  type="button"
                  onClick={() => void open(root)}
                  aria-label={`Thread in ${channelName(root.channelId)}${badge ? `, ${badge} new` : ''}`}
                  className="w-full cursor-pointer rounded-lg bg-surface-800 p-2.5 text-start transition-colors duration-200 hover:bg-white/[0.06]"
                >
                  <span className="flex items-center gap-1 text-[11px] text-slate-500">
                    <HashIcon className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{channelName(root.channelId)}</span>
                    {badge && (
                      <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white">
                        {badge}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <PersonAvatar
                      userId={root.author.id}
                      name={root.author.displayName}
                      avatarUrl={root.author.avatarUrl}
                      size="sm"
                      ringColour="border-surface-800"
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-sm ${
                        badge ? 'font-semibold text-slate-50' : 'font-medium text-slate-200'
                      }`}
                    >
                      {root.author.id === me?.id ? 'You' : root.author.displayName}
                    </span>
                  </span>
                  <span className="mt-1.5 block line-clamp-2 break-words text-sm text-slate-300">
                    {preview(root)}
                  </span>
                  {chip && <span className="mt-1 block text-xs text-accent">{chip}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/** A root still needs a line to be recognised by: deleted, or files only. */
function preview(message: DecryptedMessage): string {
  if (message.deletedAt) return 'Original message deleted';
  if (message.content.trim()) return previewText(message.content);
  if (message.attachments.length === 1) return message.attachments[0]?.name ?? 'Attachment';
  if (message.attachments.length > 1) return `${message.attachments.length} attachments`;
  return 'Empty message';
}
