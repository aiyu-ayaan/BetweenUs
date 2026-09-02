import { useEffect } from 'react';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { PersonAvatar } from '../../components/Avatar';
import { PinIcon, XIcon } from '../../components/icons';
import { SkeletonRows } from '../../components/Skeleton';
import { listState } from '../../services/list-state';

export interface PinnedPanelProps {
  onClose?: () => void;
  className?: string;
}

/**
 * Pinned messages, in the same column the member list uses - it is the same
 * kind of thing (a list about this channel), and two panels open at once would
 * leave nothing to read.
 *
 * Clicking one scrolls the conversation to it rather than opening a copy: a pin
 * is a bookmark into the channel, not a separate document.
 */
export function PinnedPanel({
  onClose,
  className = 'w-60 shrink-0',
}: PinnedPanelProps = {}): JSX.Element {
  const me = useAuthStore((state) => state.user);
  const pins = useChatStore((state) => state.pins);
  const loadingPins = useChatStore((state) => state.loadingPins);
  const loadPins = useChatStore((state) => state.loadPins);
  const jumpToMessage = useChatStore((state) => state.jumpToMessage);
  const showPanel = useChatStore((state) => state.showPanel);
  const channelId = useChatStore((state) => state.activeChannelId);

  useEffect(() => {
    void loadPins();
  }, [loadPins, channelId]);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      showPanel('members');
    }
  };

  return (
    <aside className={`panel flex flex-col bg-surface-850 ${className}`}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        <PinIcon className="h-4 w-4 text-slate-400" />
        <h2 className="flex-1 text-sm font-semibold text-slate-100">Pinned</h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close pinned messages"
          className="flex h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7 cursor-pointer items-center justify-center rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      {listState(pins.length, loadingPins) === 'loading' ? (
        <SkeletonRows rows={3} label="Loading pinned messages" className="p-3" />
      ) : listState(pins.length, loadingPins) === 'empty' ? (
        <p className="px-4 py-6 text-sm text-slate-400">
          Nothing pinned yet. Right-click a message and choose <em>Pin</em>.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {pins.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => jumpToMessage(message.id)}
                className="w-full cursor-pointer rounded-lg bg-surface-800 p-2.5 text-start transition-colors duration-200 hover:bg-white/[0.06]"
              >
                <span className="flex items-center gap-2">
                  <PersonAvatar
                    userId={message.author.id}
                    name={message.author.displayName}
                    avatarUrl={message.author.avatarUrl}
                    size="sm"
                    ringColour="border-surface-800"
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm font-medium ${
                      message.author.id === me?.id ? 'font-semibold text-accent' : 'text-slate-100'
                    }`}
                  >
                    {message.author.id === me?.id ? 'You' : message.author.displayName}
                  </span>
                </span>
                <span className="mt-1.5 block line-clamp-3 break-words text-sm text-slate-300">
                  {preview(message)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** A file-only message still needs a line of text to be recognised by. */
function preview(message: DecryptedMessage): string {
  if (message.content.trim()) return message.content;
  if (message.attachments.length === 1) return message.attachments[0]?.name ?? 'Attachment';
  if (message.attachments.length > 1) return `${message.attachments.length} attachments`;
  return 'Empty message';
}
