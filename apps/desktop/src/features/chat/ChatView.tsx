import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { Channel, MessageAttachment, MessageReply } from '@nexora/shared-types';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { usePresenceStore } from '../../stores/presence';
import { Avatar } from '../../components/Avatar';
import { AttachmentList } from './Attachments';
import { EmojiPicker } from './EmojiPicker';
import { MessageMenu } from './MessageMenu';
import { formatBytes, uploadAttachment } from '../../services/attachments';
import { OVERFLOW_CHARS, overflowFile, replyPreview } from '../../services/message-body';
import {
  CHANNEL_LEVELS,
  channelLevel,
  onPreferencesChanged,
  setChannelLevel,
} from '../../services/notifications';
import {
  BellIcon,
  BellOffIcon,
  FileIcon,
  HashIcon,
  ImageIcon,
  LockIcon,
  MessageIcon,
  PaperclipIcon,
  PinIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SmileIcon,
  TrashIcon,
  UsersIcon,
  XIcon,
} from '../../components/icons';

/** What each level says when the pointer rests on the bell. */
const LEVEL_LABELS = {
  all: 'Every message notifies. Click for mentions only',
  mentions: 'Only mentions notify. Click to silence',
  none: 'Silenced. Click to notify on every message',
} as const;

/**
 * How loud this channel is, for the account rather than for this window: the
 * setting is stored by notification-service, so the next machine to sign in
 * honours it.
 *
 * Three states on one button, cycling loudest to quietest, because a busy
 * channel wants the middle one and a two-way switch never offered it: either
 * read every message of the channel the whole server talks in, or miss the one
 * addressed to you.
 */
function MuteButton({ channelId }: { channelId: string }): JSX.Element {
  const [level, setLevel] = useState(() => channelLevel(channelId));

  // Re-read on every preference change, including the one this button caused
  // and the ones the settings screen makes.
  useEffect(() => onPreferencesChanged(() => setLevel(channelLevel(channelId))), [channelId]);

  const next = CHANNEL_LEVELS[(CHANNEL_LEVELS.indexOf(level) + 1) % CHANNEL_LEVELS.length]!;

  return (
    <button
      type="button"
      onClick={() => void setChannelLevel(channelId, next).catch(() => undefined)}
      aria-label={LEVEL_LABELS[level]}
      title={LEVEL_LABELS[level]}
      className={`cursor-pointer rounded-md p-1.5 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 ${
        level === 'none' ? 'text-slate-600' : level === 'mentions' ? 'text-accent' : 'text-slate-400'
      }`}
    >
      {level === 'none' ? <BellOffIcon className="h-5 w-5" /> : <BellIcon className="h-5 w-5" />}
    </button>
  );
}

/**
 * A header toggle for one of the right-hand panels. Clicking the panel that is
 * already open goes back to the member list, which is where the column started.
 */
function PanelButton({
  panel,
  label,
  icon,
}: {
  panel: 'pins' | 'search';
  label: string;
  icon: JSX.Element;
}): JSX.Element {
  const current = useChatStore((state) => state.rightPanel);
  const showPanel = useChatStore((state) => state.showPanel);
  const open = current === panel;

  return (
    <button
      type="button"
      onClick={() => showPanel(open ? 'members' : panel)}
      aria-pressed={open}
      aria-label={label}
      title={label}
      className={`cursor-pointer rounded-md p-1.5 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 ${
        open ? 'bg-white/[0.07] text-slate-100' : 'text-slate-400'
      }`}
    >
      {icon}
    </button>
  );
}

export function ChatView({ onToggleMembers }: { onToggleMembers?: () => void }): JSX.Element {
  const { messages, loadingMessages, error } = useChatStore();
  const channel = useChatStore((state) => state.activeChannel());

  if (!channel) {
    return (
      <section className="panel flex flex-1 items-center justify-center bg-surface-900">
        <div className="text-center">
          <UsersIcon className="mx-auto h-10 w-10 text-slate-600" />
          <p className="mt-3 text-slate-400">Pick a channel to start talking.</p>
        </div>
      </section>
    );
  }

  const isDirect = channel.type === 'DM';

  return (
    <section className="panel flex min-w-0 flex-1 flex-col bg-surface-900">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-3.5">
        {isDirect ? (
          <Avatar name={channel.name} size="sm" ringColour="border-surface-900" />
        ) : channel.isPrivate ? (
          <LockIcon className="h-5 w-5 text-slate-500" />
        ) : (
          <HashIcon className="h-5 w-5 text-slate-500" />
        )}
        <h1 className="truncate text-[15px] font-semibold text-slate-50">{channel.name}</h1>

        {channel.topic && (
          <>
            <span aria-hidden="true" className="h-4 w-px bg-white/10" />
            <p className="truncate text-sm text-slate-400">{channel.topic}</p>
          </>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <PanelButton
            panel="pins"
            label="Pinned messages"
            icon={<PinIcon className="h-5 w-5" />}
          />
          <PanelButton panel="search" label="Search" icon={<SearchIcon className="h-5 w-5" />} />
          <MuteButton channelId={channel.id} />

          {onToggleMembers && !isDirect && (
            <button
              type="button"
              onClick={onToggleMembers}
              aria-label="Toggle member list"
              title="Members"
              className="cursor-pointer rounded-md p-1.5 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
            >
              <UsersIcon className="h-5 w-5" />
            </button>
          )}
        </div>
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

/** How far off the bottom still counts as reading the newest message. */
const FOLLOW_SLACK_PX = 120;

function MessageList({
  messages,
  loading,
  error,
  channel,
}: {
  messages: DecryptedMessage[];
  loading: boolean;
  error: string | null;
  channel: Channel;
}): JSX.Element {
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  /**
   * Whether the view is pinned to the newest message. It stops being pinned the
   * moment somebody scrolls up to read something, because dragging them back
   * down every time a message arrives is worse than not following at all.
   */
  const following = useRef(true);
  const me = useAuthStore((state) => state.user);
  // Own messages anywhere; anyone else's only with the moderator permission,
  // which no direct message ever carries.
  const canModerate = useChatStore((state) => state.canModerateMessages());
  const canPin = useChatStore((state) => state.canPin());
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const togglePin = useChatStore((state) => state.togglePin);
  const react = useChatStore((state) => state.react);
  const setReplyTo = useChatStore((state) => state.setReplyTo);
  const jumpTo = useChatStore((state) => state.jumpTo);
  const clearJump = useChatStore((state) => state.clearJump);
  const dividerId = useChatStore((state) => state.divider[channel.id] ?? null);

  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Menu actions used to be fired and forgotten, so a refused pin or delete
   * looked like a menu that did nothing at all. Every one of them reports here.
   */
  const report = (work: Promise<unknown>): void => {
    setFailure(null);
    void work.catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : 'That did not work');
      window.setTimeout(() => setFailure(null), 6000);
    });
  };

  /**
   * Opening a channel starts at the newest message, without an animation - a
   * conversation you have just walked into has no "before" to scroll from.
   *
   * `loading` is in the dependencies because the skeleton renders a different
   * element: the viewport this scrolls does not exist until history is on
   * screen, and the effect that ran while it was missing scrolled nothing.
   */
  useLayoutEffect(() => {
    following.current = true;
    const box = viewport.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [channel.id, loading]);

  const newest = messages[messages.length - 1]?.id ?? null;

  /**
   * A message arrived. Keyed on the newest id rather than the count, because
   * switching between two channels that hold the same number of messages
   * changes neither the length nor the scroll position - which is why the list
   * used to open somewhere in the middle of a conversation.
   */
  useEffect(() => {
    const box = viewport.current;
    if (!box || !following.current) return;
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }, [newest]);

  /**
   * Attachments decrypt after their row is drawn, so the list grows under a
   * scroll that had already finished. While the view is pinned to the bottom,
   * every one of those growths takes it back down.
   */
  useEffect(() => {
    const box = viewport.current;
    const items = list.current;
    if (!box || !items || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (following.current) box.scrollTop = box.scrollHeight;
    });
    observer.observe(items);
    return () => observer.disconnect();
  }, [loading]);

  // A pin or a search result asked for a message: scroll to it and flash it, so
  // it is findable in a wall of text that otherwise looks the same.
  useEffect(() => {
    if (!jumpTo) return;
    const row = document.getElementById(`message-${jumpTo}`);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlighted(jumpTo);
    clearJump();
    const timer = window.setTimeout(() => setHighlighted(null), 2000);
    return () => window.clearTimeout(timer);
  }, [jumpTo, clearJump]);

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
    <div
      ref={viewport}
      onScroll={(event) => {
        const box = event.currentTarget;
        // "Near enough the bottom" rather than exactly at it: a smooth scroll
        // that is still finishing, or a row that grew by a pixel, must not
        // count as somebody scrolling away.
        following.current = box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW_SLACK_PX;
      }}
      className="relative flex-1 overflow-y-auto px-4 py-4"
      role="log"
      aria-live="polite"
    >
      {failure && (
        <p
          role="alert"
          className="sticky top-0 z-10 mb-2 rounded-md bg-danger/15 px-3 py-2 text-sm text-danger"
        >
          {failure}
        </p>
      )}

      {messages.length === 0 && <EmptyChannel channel={channel} />}

      <ul ref={list}>
        {messages.map((message, index) => {
          // Consecutive messages from one author collapse into a group.
          const previous = messages[index - 1];
          const grouped =
            previous?.author.id === message.author.id &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
              5 * 60 * 1000;

          const deleted = message.deletedAt !== null;

          return (
            <Fragment key={message.id}>
              {dividerId === message.id && <NewMessagesDivider />}
            <li
              id={`message-${message.id}`}
              onContextMenu={(event) => {
                // A tombstone has nothing left to act on.
                if (deleted) return;
                event.preventDefault();
                setArmedDelete(null);
                setMenu({ id: message.id, at: { x: event.clientX, y: event.clientY } });
              }}
              className={`relative rounded-lg px-2 transition-colors duration-500 ${
                highlighted === message.id
                  ? 'bg-accent/20'
                  : message.pinnedAt
                    ? 'bg-amber-400/[0.04] hover:bg-white/[0.03]'
                    : 'hover:bg-white/[0.025]'
              } ${grouped ? 'py-0.5 pl-[60px]' : 'mt-4 flex gap-3 py-0.5'}`}
            >
              {!grouped && (
                <Avatar
                  name={message.author.displayName}
                  avatarUrl={message.author.avatarUrl}
                  ringColour="border-surface-900"
                />
              )}
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <p className="flex items-baseline gap-2">
                    <span
                      className={`font-medium ${
                        message.author.id === me?.id ? 'font-semibold text-accent' : 'text-slate-50'
                      }`}
                    >
                      {message.author.id === me?.id ? 'You' : message.author.displayName}
                    </span>
                    <time dateTime={message.createdAt} className="text-xs text-slate-500">
                      {formatTime(message.createdAt)}
                    </time>
                    {message.pinnedAt && (
                      <span className="flex items-center gap-1 text-xs text-amber-400/80">
                        <PinIcon className="h-3 w-3" />
                        Pinned
                      </span>
                    )}
                  </p>
                )}

                {/* Above the author line would put it above the avatar; it
                    belongs to the message, so it sits on top of the body. */}
                {!deleted && message.replyTo && <QuotedMessage reply={message.replyTo} />}

                {deleted ? (
                  <Tombstone message={message} />
                ) : editing === message.id ? (
                  <MessageEditor message={message} onDone={() => setEditing(null)} />
                ) : (
                  <>
                    {/* A message that is only files has no text line at all. */}
                    {message.content.length > 0 && (
                      <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-200">
                        {message.content}
                        {message.editedAt && (
                          <span className="ml-1.5 align-baseline text-xs text-slate-500">
                            (edited)
                          </span>
                        )}
                      </p>
                    )}
                    <AttachmentList channelId={channel.id} attachments={message.attachments} />
                    <ReactionRow
                      message={message}
                      meId={me?.id}
                      onToggle={(emoji) => report(react(message.id, emoji))}
                      onMore={(at) => setPicker({ id: message.id, at })}
                    />
                  </>
                )}
              </div>
            </li>
            </Fragment>
          );
        })}
      </ul>

      {menu && (
        <MessageMenu
          at={menu.at}
          armedDelete={armedDelete === menu.id}
          onArmDelete={() => setArmedDelete(menu.id)}
          onClose={() => {
            setMenu(null);
            setArmedDelete(null);
          }}
          actions={{
            pinned: messages.find((item) => item.id === menu.id)?.pinnedAt != null,
            onReact: (emoji) => report(react(menu.id, emoji)),
            onReply: () => {
              const target = messages.find((item) => item.id === menu.id);
              if (target) setReplyTo(quoteOf(target));
            },
            onMoreEmoji: (at) => setPicker({ id: menu.id, at }),
            onEdit:
              messages.find((item) => item.id === menu.id)?.author.id === me?.id
                ? () => setEditing(menu.id)
                : undefined,
            onPin: canPin ? () => report(togglePin(menu.id)) : undefined,
            pinDisabledReason: 'Needs the “Pin and unpin messages” permission',
            onCopy: () => {
              const text = messages.find((item) => item.id === menu.id)?.content ?? '';
              void navigator.clipboard.writeText(text);
            },
            onDelete:
              messages.find((item) => item.id === menu.id)?.author.id === me?.id || canModerate
                ? () => report(deleteMessage(menu.id))
                : undefined,
          }}
        />
      )}

      {picker && (
        <EmojiPicker
          anchor={picker.at}
          onPick={(emoji) => report(react(picker.id, emoji))}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/**
 * Where the unread messages start. It is placed when the channel is opened and
 * stays put while it is open, so it marks the place you left off rather than
 * chasing the newest message down the screen. Opening the channel again, once
 * everything has been read, is what takes it away.
 */
function NewMessagesDivider(): JSX.Element {
  return (
    <li aria-label="New messages" className="my-2 flex items-center gap-2 px-2">
      <span aria-hidden="true" className="h-px flex-1 bg-danger" />
      <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        New
      </span>
    </li>
  );
}

/**
 * What is left where a message was. The conversation keeps its shape, and who
 * removed it is not hidden: a moderator taking somebody's message down is a
 * different event from an author taking their own back, and reading the thread
 * afterwards should not make them look the same.
 */
function Tombstone({ message }: { message: DecryptedMessage }): JSX.Element {
  const by = message.deletedBy;
  return (
    <p className="flex items-center gap-1.5 text-sm italic text-slate-500">
      <TrashIcon className="h-3.5 w-3.5" />
      {by ? `Message deleted by ${by.displayName || by.username}` : 'Message deleted'}
    </p>
  );
}

/**
 * Editing in place. The text is re-encrypted and sent as a replacement, and the
 * attachments ride along untouched - an edit changes the words, not the files.
 */
function MessageEditor({
  message,
  onDone,
}: {
  message: DecryptedMessage;
  onDone: () => void;
}): JSX.Element {
  const editMessage = useChatStore((state) => state.editMessage);
  const [draft, setDraft] = useState(message.content);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === message.content) {
      onDone();
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await editMessage(message.id, trimmed);
      onDone();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That edit was refused');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-1">
      <textarea
        autoFocus
        rows={Math.min(8, draft.split('\n').length)}
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
          if (event.key === 'Escape') onDone();
        }}
        aria-label="Edit message"
        className="w-full resize-none rounded bg-surface-600 px-3 py-2 text-slate-100 focus:outline-none"
      />
      <p className="mt-1 text-xs text-slate-500">
        Enter to save · Escape to cancel
        {failure && <span className="ml-2 text-danger">{failure}</span>}
      </p>
    </div>
  );
}

/** The chips under a message: one per emoji, yours highlighted. */
function ReactionRow({
  message,
  meId,
  onToggle,
  onMore,
}: {
  message: DecryptedMessage;
  meId: string | undefined;
  onToggle: (emoji: string) => void;
  onMore: (at: { x: number; y: number }) => void;
}): JSX.Element | null {
  if (message.reactions.length === 0) return null;

  return (
    <ul className="mt-1 flex flex-wrap items-center gap-1">
      {message.reactions.map((reaction) => {
        const mine = meId !== undefined && reaction.userIds.includes(meId);
        return (
          <li key={reaction.emoji}>
            <button
              type="button"
              onClick={() => onToggle(reaction.emoji)}
              aria-pressed={mine}
              aria-label={`${reaction.emoji} ${reaction.userIds.length}`}
              className={`flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-sm transition-colors duration-150 ${
                mine
                  ? 'border-accent bg-accent/20 text-slate-100'
                  : 'border-transparent bg-surface-800 text-slate-300 hover:border-surface-600'
              }`}
            >
              <span>{reaction.emoji}</span>
              <span className="text-xs">{reaction.userIds.length}</span>
            </button>
          </li>
        );
      })}
      <li>
        <button
          type="button"
          onClick={(event) => onMore({ x: event.clientX, y: event.clientY })}
          aria-label="Add a reaction"
          title="Add a reaction"
          className="cursor-pointer rounded-full bg-surface-800 p-1 text-slate-400 transition-colors duration-150 hover:text-slate-100"
        >
          <SmileIcon className="h-4 w-4" />
        </button>
      </li>
    </ul>
  );
}

/**
 * What a reply carries about the message it answers.
 *
 * Copied rather than referenced: the quoted message may be a thousand messages
 * back and not on this device at all, and the whole thing lives inside the
 * encrypted body - so the server never learns who is answering whom.
 */
function quoteOf(message: DecryptedMessage): MessageReply {
  return {
    id: message.id,
    author: message.author.displayName || message.author.username,
    preview: message.content.trim()
      ? replyPreview(message.content)
      : message.attachments.length > 0
        ? `${message.attachments.length} file${message.attachments.length === 1 ? '' : 's'}`
        : '',
  };
}

/**
 * The quote above a reply. Clicking it goes to what was answered, which is the
 * only reason a quote is worth drawing rather than only naming.
 */
function QuotedMessage({ reply }: { reply: MessageReply }): JSX.Element {
  const jumpToMessage = useChatStore((state) => state.jumpToMessage);

  return (
    <button
      type="button"
      onClick={() => jumpToMessage(reply.id)}
      title={`Go to ${reply.author}'s message`}
      className="mb-0.5 flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded border-l-2 border-accent/50 bg-white/[0.02] py-0.5 pl-2 pr-1 text-left transition-colors duration-150 hover:bg-white/[0.05]"
    >
      <ReplyIcon className="h-3 w-3 shrink-0 text-slate-500" />
      <span className="shrink-0 text-xs font-medium text-accent">{reply.author}</span>
      <span className="truncate text-xs text-slate-400">
        {reply.preview || 'Sent an attachment'}
      </span>
    </button>
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

/** More than this in one message and the point is a folder, not a chat. */
const MAX_FILES = 10;

function MessageComposer({ channel }: { channel: Channel }): JSX.Element {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const replyTo = useChatStore((state) => state.replyingTo[channel.id] ?? null);
  const setReplyTo = useChatStore((state) => state.setReplyTo);
  const notifyTyping = usePresenceStore((state) => state.notifyTyping);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<{ x: number; y: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const placeholder =
    channel.type === 'DM' ? `Message @${channel.name}` : `Message #${channel.name}`;

  // Choosing "Reply" in the menu is choosing to type, so the caret goes to the
  // box rather than leaving one more click between the two.
  useEffect(() => {
    if (replyTo) box.current?.focus();
  }, [replyTo]);

  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) return;
    setFailure(null);
    setFiles((current) => {
      const room = MAX_FILES - current.length;
      if (room <= 0) {
        setFailure(`A message can carry ${MAX_FILES} files at most`);
        return current;
      }
      return [...current, ...incoming.slice(0, room)];
    });
  };

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const trimmed = content.trim();
    if ((!trimmed && files.length === 0) || sending) return;

    // Past the limit the text becomes a file of its own, the way Discord does
    // it: nothing is truncated, and it arrives with a preview.
    const overflowing = trimmed.length > OVERFLOW_CHARS;
    const outgoing = overflowing ? [...files, overflowFile(trimmed)] : files;

    setSending(true);
    setFailure(null);
    try {
      const attachments: MessageAttachment[] = [];
      for (const [index, file] of outgoing.entries()) {
        setUploading({ name: file.name, percent: 0 });
        attachments.push(
          await uploadAttachment(
            channel.id,
            file,
            (fraction) => setUploading({ name: file.name, percent: Math.round(fraction * 100) }),
            { overflow: overflowing && index === outgoing.length - 1 },
          ),
        );
      }

      await sendMessage(overflowing ? '' : trimmed, attachments, replyTo ?? undefined);
      setContent('');
      setFiles([]);
      setReplyTo(null);
    } catch (error) {
      // Keep the text and the files in the box; nothing the user chose is lost.
      setFailure(error instanceof Error ? error.message : 'Message failed to send');
    } finally {
      setUploading(null);
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
    // Escape drops the reply rather than the draft: the text is the expensive
    // thing in the box and nothing else here throws it away.
    if (event.key === 'Escape' && replyTo) {
      event.preventDefault();
      setReplyTo(null);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        addFiles([...event.dataTransfer.files]);
      }}
      className="shrink-0 px-3.5 pb-4"
    >
      {failure && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {failure}
        </p>
      )}

      {uploading && (
        <p className="mb-2 truncate text-xs text-slate-400" aria-live="polite">
          Encrypting and uploading {uploading.name} — {uploading.percent}%
        </p>
      )}

      <div
        className={`rounded-xl border transition-colors duration-150 ${
          dropping
            ? 'border-accent bg-accent/[0.06]'
            : 'border-edge bg-surface-800 focus-within:border-white/[0.14]'
        }`}
      >
        {replyTo && (
          <div className="flex items-center gap-2 border-b border-edge px-4 py-2">
            <ReplyIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span className="shrink-0 text-xs text-slate-400">
              Replying to <span className="font-medium text-accent">{replyTo.author}</span>
            </span>
            <span className="truncate text-xs text-slate-500">
              {replyTo.preview || 'Sent an attachment'}
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              title="Cancel reply"
              className="ml-auto cursor-pointer text-slate-400 transition-colors duration-200 hover:text-danger"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-b border-edge px-4 py-2.5">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 rounded bg-surface-800 px-2 py-1.5"
              >
                {file.type.startsWith('image/') ? (
                  <ImageIcon className="h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
                )}
                <span className="max-w-[14rem] truncate text-xs text-slate-200">{file.name}</span>
                <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  disabled={sending}
                  onClick={() => setFiles(files.filter((_, at) => at !== index))}
                  className="cursor-pointer text-slate-400 transition-colors duration-200 hover:text-danger disabled:cursor-not-allowed"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2 px-4 py-2.5">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              // Reset, or picking the same file twice in a row does nothing.
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={sending}
            aria-label="Attach a file"
            title="Attach a file"
            className="cursor-pointer rounded-md p-1 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
          >
            <PaperclipIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={(event) => setEmoji({ x: event.clientX, y: event.clientY })}
            disabled={sending}
            aria-label="Insert an emoji"
            title="Emoji"
            className="cursor-pointer rounded-md p-1 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
          >
            <SmileIcon className="h-5 w-5" />
          </button>

          <label htmlFor="composer" className="sr-only">
            {placeholder}
          </label>
          <textarea
            id="composer"
            ref={box}
            rows={1}
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              if (event.target.value.length > 0) notifyTyping(channel.id);
            }}
            onKeyDown={onKeyDown}
            onPaste={(event) => {
              // A screenshot on the clipboard is a file, and pasting it is how
              // everyone expects to send one.
              const pasted = [...event.clipboardData.files];
              if (pasted.length === 0) return;
              event.preventDefault();
              addFiles(pasted);
            }}
            placeholder={placeholder}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || (content.trim().length === 0 && files.length === 0)}
            aria-label="Send message"
            className="cursor-pointer rounded-md p-1 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
          >
            <SendIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {content.trim().length > OVERFLOW_CHARS && (
        <p className="mt-1.5 text-xs text-slate-400">
          That is longer than {OVERFLOW_CHARS} characters — it will be sent as a text file.
        </p>
      )}

      {emoji && (
        <EmojiPicker
          anchor={emoji}
          onClose={() => setEmoji(null)}
          onPick={(symbol) => {
            // Inserted where the caret was, not appended: people reach for the
            // picker mid-sentence as often as at the end.
            const caret = box.current?.selectionStart ?? content.length;
            setContent(`${content.slice(0, caret)}${symbol}${content.slice(caret)}`);
            window.setTimeout(() => {
              box.current?.focus();
              box.current?.setSelectionRange(caret + symbol.length, caret + symbol.length);
            }, 0);
          }}
        />
      )}
    </form>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
