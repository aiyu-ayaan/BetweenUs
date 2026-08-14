import { useEffect } from 'react';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { Avatar } from '../../components/Avatar';
import { PinIcon, XIcon } from '../../components/icons';

/**
 * Pinned messages, in the same column the member list uses - it is the same
 * kind of thing (a list about this channel), and two panels open at once would
 * leave nothing to read.
 *
 * Clicking one scrolls the conversation to it rather than opening a copy: a pin
 * is a bookmark into the channel, not a separate document.
 */
export function PinnedPanel(): JSX.Element {
  const pins = useChatStore((state) => state.pins);
  const loadPins = useChatStore((state) => state.loadPins);
  const jumpToMessage = useChatStore((state) => state.jumpToMessage);
  const showPanel = useChatStore((state) => state.showPanel);
  const channelId = useChatStore((state) => state.activeChannelId);

  useEffect(() => {
    void loadPins();
  }, [loadPins, channelId]);

  return (
    <aside className="panel flex w-60 shrink-0 flex-col bg-surface-850">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        <PinIcon className="h-4 w-4 text-slate-400" />
        <h2 className="flex-1 text-sm font-semibold text-slate-100">Pinned</h2>
        <button
          type="button"
          onClick={() => showPanel('members')}
          aria-label="Close pinned messages"
          className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </header>

      {pins.length === 0 ? (
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
                className="w-full cursor-pointer rounded-lg bg-surface-800 p-2.5 text-left transition-colors duration-200 hover:bg-white/[0.06]"
              >
                <span className="flex items-center gap-2">
                  <Avatar
                    name={message.author.displayName}
                    avatarUrl={message.author.avatarUrl}
                    size="sm"
                    ringColour="border-surface-800"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                    {message.author.displayName}
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
