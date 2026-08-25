import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { Channel, LinkPreview, MessageAttachment, MessageReply } from '@betweenus/shared-types';
import { useChatStore, type DecryptedMessage } from '../../stores/chat';
import { UNDECRYPTABLE } from '../../services/e2ee';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { usePresenceStore } from '../../stores/presence';
import { useIsMobile } from '../../services/responsive';
import { Avatar } from '../../components/Avatar';
import { AttachmentList } from './Attachments';
import { EmojiPicker } from './EmojiPicker';
import { MessageMenu } from './MessageMenu';
import { SendPreview, isPreviewable, isImage } from './SendPreview';
import { EmojiSuggest } from './EmojiSuggest';
import {
  emojiFor,
  isOnlyEmoji,
  onEmojiChanged,
  splitMessage,
} from '../../services/server-emoji';
import { absoluteUrl } from '../../services/endpoint';
import { emojiQueryAt } from './emoji-names';
import { nextFollow } from './follow';
import { anchorReceipts, seenBy } from './receipts';
import { SeenByDialog, SeenByRow } from './SeenBy';
import { formatBytes, uploadAttachment } from '../../services/attachments';
import { OVERFLOW_CHARS, overflowFile, replyPreview } from '../../services/message-body';
import { reactorNames } from '../../services/reactions';
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
  MenuIcon,
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
      className={`flex h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 ${
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
      onClick={() => showPanel(open ? 'none' : panel)}
      aria-pressed={open}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 ${
        open ? 'bg-white/[0.07] text-slate-100' : 'text-slate-400'
      }`}
    >
      {icon}
    </button>
  );
}

export interface ChatViewProps {
  onToggleMembers?: () => void;
  showMembers?: boolean;
  onOpenMenu?: () => void;
}

export function ChatView({
  onToggleMembers,
  showMembers = false,
  onOpenMenu,
}: ChatViewProps): JSX.Element {
  const { messages, loadingMessages, error } = useChatStore();
  const channel = useChatStore((state) => state.activeChannel());
  const isMobile = useIsMobile();
  /**
   * How a file dropped anywhere in the conversation reaches the composer that
   * owns the pending list. A ref rather than lifted state on purpose: the drop
   * target is the whole panel, the files belong to the composer, and moving
   * that list up here would re-render every message on every keystroke.
   */
  const takeFiles = useRef<((files: File[]) => void) | null>(null);
  const [dropping, setDropping] = useState(false);

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
    <section
      onDragOver={(event) => {
        // Only a file drag. Dragging selected text across the panel is not an
        // attachment, and lighting the whole screen up for it is alarming.
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // Moving between children fires dragleave on the way out of each one;
        // only leaving the panel itself counts.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(false);
        takeFiles.current?.([...event.dataTransfer.files]);
      }}
      className="panel relative flex min-w-0 flex-1 flex-col bg-surface-900"
    >
      {dropping && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/[0.07]"
        >
          <p className="rounded-lg bg-surface-900/90 px-4 py-2 text-sm font-medium text-slate-100">
            Drop to attach to {channel.type === 'DM' ? `@${channel.name}` : `#${channel.name}`}
          </p>
        </div>
      )}

      <header className="flex h-12 md:h-11 shrink-0 items-center gap-1.5 md:gap-2 border-b border-edge px-2 md:px-3.5">
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            title="Open menu"
            className="flex h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 cursor-pointer items-center justify-center rounded-md text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 md:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
        )}

        <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
          {isDirect ? (
            <Avatar name={channel.name} size="sm" ringColour="border-surface-900" />
          ) : channel.isPrivate ? (
            <LockIcon className="h-5 w-5 shrink-0 text-slate-500" />
          ) : (
            <HashIcon className="h-5 w-5 shrink-0 text-slate-500" />
          )}
          <h1 className="truncate text-[15px] font-semibold text-slate-50">{channel.name}</h1>
        </div>

        {channel.topic && !isMobile && (
          <div className="hidden sm:flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-4 w-px bg-white/10" />
            <p className="truncate text-sm text-slate-400">{channel.topic}</p>
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <PanelButton
            panel="pins"
            label="Pinned messages"
            icon={<PinIcon className="h-5 w-5" />}
          />
          <PanelButton panel="search" label="Search" icon={<SearchIcon className="h-5 w-5" />} />
          <MuteButton channelId={channel.id} />

          {!isDirect && (
            <button
              type="button"
              onClick={() => {
                if (onToggleMembers) {
                  onToggleMembers();
                } else {
                  const current = useChatStore.getState().rightPanel;
                  useChatStore.getState().showPanel(current === 'members' ? 'none' : 'members');
                }
              }}
              aria-label="Toggle member list"
              aria-pressed={showMembers || useChatStore.getState().rightPanel === 'members'}
              title="Members"
              className={`flex h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors duration-150 ${
                showMembers || useChatStore.getState().rightPanel === 'members'
                  ? 'bg-white/[0.08] text-slate-100'
                  : 'text-slate-400 hover:bg-white/[0.07] hover:text-slate-100'
              }`}
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
      <MessageComposer channel={channel} takeFiles={takeFiles} />
    </section>
  );
}

/** How near the top the reader gets before the previous page is fetched. */
const PAGE_TRIGGER_PX = 400;

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
  const isDirect = channel.type === 'DM';
  const viewport = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  /**
   * Whether the view is pinned to the newest message. It stops being pinned the
   * moment somebody scrolls up to read something, because dragging them back
   * down every time a message arrives is worse than not following at all - and
   * only that, never a row growing underneath them. See `follow.ts`.
   */
  const following = useRef(true);
  /** The scroll position at the previous scroll event; see `nextFollow`. */
  const lastTop = useRef(0);
  /**
   * Distance from the bottom, recorded before an older page is asked for.
   * Prepending fifty messages moves everything on screen down by however tall
   * they turn out to be; measuring from the bottom is the one anchor that does
   * not need to know that height in advance.
   */
  const anchor = useRef<number | null>(null);
  const me = useAuthStore((state) => state.user);
  // Own messages anywhere; anyone else's only with the moderator permission,
  // which no direct message ever carries.
  const canModerate = useChatStore((state) => state.canModerateMessages());
  const canPin = useChatStore((state) => state.canPin());
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const togglePin = useChatStore((state) => state.togglePin);
  const react = useChatStore((state) => state.react);
  const setReplyTo = useChatStore((state) => state.setReplyTo);
  const loadOlder = useChatStore((state) => state.loadOlder);
  const loadingOlder = useChatStore((state) => state.loadingOlder);
  const exhausted = useChatStore((state) => state.cursors[channel.id] === null);
  const jumpTo = useChatStore((state) => state.jumpTo);
  const clearJump = useChatStore((state) => state.clearJump);
  const dividerId = useChatStore((state) => state.divider[channel.id] ?? null);
  const receipts = useChatStore((state) => state.receipts[channel.id]);
  const unreadCount = useChatStore((state) => state.unread[channel.id] ?? 0);

  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /** The message whose "seen by" dialog is open, if any. */
  const [seenFor, setSeenFor] = useState<string | null>(null);

  /**
   * Where each reader's face is drawn: once, against the newest message of
   * yours they have read. Recomputed on every render rather than memoised -
   * it is a pass over your own messages and a handful of markers, and it has
   * to move the moment either changes.
   */
  const anchors = anchorReceipts(
    messages.map((message) => ({
      id: message.id,
      createdAt: message.createdAt,
      authorId: message.author.id,
    })),
    receipts ?? [],
    me?.id,
  );

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
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    lastTop.current = box.scrollTop;
  }, [channel.id, loading]);

  const newest = messages[messages.length - 1]?.id ?? null;
  const oldest = messages[0]?.id ?? null;

  /**
   * An older page landed: put the reader back where they were reading rather
   * than fifty messages further down.
   */
  useLayoutEffect(() => {
    const box = viewport.current;
    if (!box || anchor.current === null) return;
    box.scrollTop = box.scrollHeight - anchor.current;
    lastTop.current = box.scrollTop;
    anchor.current = null;
  }, [oldest]);

  // A page that failed, or one the store refused, leaves an anchor nothing is
  // ever going to consume - and a stuck anchor stops every later page.
  useEffect(() => {
    if (!loadingOlder) anchor.current = null;
  }, [loadingOlder]);

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
   *
   * Both boxes, because the bottom of the list gets away in two different ways.
   * The list grows when a picture arrives; the viewport *shrinks* when a typing
   * indicator appears under it, or when the composer grows a preview of the
   * photo about to be sent. Watching only the list left the second one - which
   * is every time anybody attaches anything - putting the newest messages
   * behind the composer.
   */
  useEffect(() => {
    const box = viewport.current;
    const items = list.current;
    if (!box || !items || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!following.current) return;
      box.scrollTop = box.scrollHeight;
      lastTop.current = box.scrollTop;
    });
    observer.observe(items);
    observer.observe(box);
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
        // Near the top: fetch the page before this one. The store refuses when
        // a fetch is already running or the channel has been read to its start,
        // so firing this on every scroll event is free.
        if (
          !loadingOlder &&
          !exhausted &&
          box.scrollTop < PAGE_TRIGGER_PX &&
          anchor.current === null
        ) {
          anchor.current = box.scrollHeight - box.scrollTop;
          void loadOlder();
        }
        following.current = nextFollow(following.current, lastTop.current, box);
        lastTop.current = box.scrollTop;
      }}
      className="relative flex-1 overflow-y-auto px-2 sm:px-4 py-4"
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

      {/* Only once the channel has been read back to its first message is the
          "this is the beginning" block true. Before that the top of the list is
          just the top of a page. An empty channel is exhausted by definition,
          but says so before the first fetch has answered. */}
      {(exhausted || (messages.length === 0 && !loadingOlder)) && (
        <EmptyChannel channel={channel} />
      )}

      {/* Said once for the channel rather than once per message. What a row can
          say is that it is sealed; what somebody actually needs is why, and
          that it repairs itself - a machine holding these keys hands them over
          the next time it opens this channel, so there is nothing to do but
          open BetweenUs where you first signed in. */}
      {messages.some((message) => message.content === UNDECRYPTABLE) && (
        <p className="mb-2 rounded-md bg-surface-800 px-3 py-2 text-xs text-slate-400">
          Some of these messages were sealed for another of your devices. Open
          BetweenUs on the device you first signed in with and they will unlock here.
        </p>
      )}

      {loadingOlder && (
        <p className="py-2 text-center text-xs text-slate-500" aria-live="polite">
          Loading earlier messages…
        </p>
      )}

      {/* The line is a place, and a place is no use if you cannot get to it.
          Discord puts this bar at the top of the channel for the same reason:
          the unread messages are usually above the fold, and scrolling for them
          by hand is how people give up and mark everything read. */}
      {dividerId && (
        <button
          type="button"
          onClick={() => {
            const row = document.getElementById(`message-${dividerId}`);
            row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setHighlighted(dividerId);
            window.setTimeout(() => setHighlighted(null), 2000);
          }}
          className="sticky top-0 z-10 mb-2 flex w-full cursor-pointer items-center gap-2 rounded-md bg-danger/90 px-3 py-1.5 text-left text-xs font-medium text-white transition-colors duration-150 hover:bg-danger"
        >
          <span>
            {unreadCount > 0
              ? `${unreadCount} new message${unreadCount === 1 ? '' : 's'}`
              : 'New messages'}
          </span>
          <span className="ml-auto underline underline-offset-2">Jump to the first</span>
        </button>
      )}

      <ul ref={list}>
        {messages.map((message, index) => {
          // Consecutive messages from one author collapse into a group.
          const previous = messages[index - 1];
          const grouped =
            previous?.author.id === message.author.id &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
              5 * 60 * 1000;

          const deleted = message.deletedAt !== null;
          const isSelf = message.author.id === me?.id;
          // The avatar is for someone else's face in a channel - never your
          // own (the side of the screen already says that), and never in a
          // direct message, where there are only ever two people in it.
          const showAvatar = !isSelf && !isDirect;
          // The one square corner sits on the outer top edge of the first
          // bubble of a run; a continuation is round on every corner, which is
          // what makes a run read as one person talking rather than a stack
          // of separate cards.
          const bubbleRadius = grouped
            ? 'rounded-2xl'
            : isSelf
              ? 'rounded-2xl rounded-tr-md'
              : 'rounded-2xl rounded-tl-md';

          return (
            <Fragment key={message.id}>
              {dividerId === message.id && <NewMessagesDivider />}
              <li
                id={`message-${message.id}`}
                className={`flex items-start gap-2 px-2 ${grouped ? 'mt-0.5' : 'mt-3'} ${
                  isSelf ? 'justify-end' : 'justify-start'
                }`}
              >
                {showAvatar &&
                  (grouped ? (
                    <div aria-hidden="true" className="h-10 w-10 shrink-0" />
                  ) : (
                    <Avatar
                      name={message.author.displayName}
                      avatarUrl={message.author.avatarUrl}
                      ringColour="border-surface-900"
                    />
                  ))}

                <div className={`flex min-w-0 max-w-[78%] flex-col ${isSelf ? 'items-end' : 'items-start'}`}>
                  <div
                    onContextMenu={(event) => {
                      // A tombstone has nothing left to act on.
                      if (deleted) return;
                      event.preventDefault();
                      setArmedDelete(null);
                      setMenu({ id: message.id, at: { x: event.clientX, y: event.clientY } });
                    }}
                    onMouseDown={(event) => {
                      // The browser selects the word under the cursor on the
                      // second mousedown of a double-click, before
                      // onDoubleClick ever fires - so by the time that
                      // handler runs, the selection guard below always sees a
                      // non-collapsed selection and never fires. Suppressing
                      // native selection here, on the second click only,
                      // leaves ordinary click-drag selection untouched.
                      if (event.detail === 2) event.preventDefault();
                    }}
                    onDoubleClick={(event) => {
                      // The shortcut for the one action the menu is opened
                      // for most: reply. A double tap does the same on a
                      // touch screen, where there is no right button at all.
                      if (deleted) return;
                      // Not while something is being selected: a drag that
                      // was already selecting text when the double-click
                      // landed should keep selecting, not be hijacked into a
                      // reply.
                      if (!window.getSelection()?.isCollapsed) return;
                      event.preventDefault();
                      setReplyTo(quoteOf(message));
                    }}
                    className={`min-w-0 px-3 py-1.5 transition-colors duration-500 ${bubbleRadius} ${
                      highlighted === message.id
                        ? 'ring-2 ring-accent/70'
                        : ''
                    } ${deleted ? 'bg-surface-800/60' : isSelf ? 'bg-accent/25' : 'bg-surface-800'}`}
                  >
                    {/* Who is speaking, once per run and never for you - the
                        side of the screen your bubble is on already said
                        that. */}
                    {!isSelf && !grouped && (
                      <p className="mb-0.5 truncate text-sm font-semibold text-accent">
                        {message.author.displayName}
                      </p>
                    )}

                    {/* The quote belongs to the message, so it sits inside
                        the bubble and above everything the message says. */}
                    {!deleted && message.replyTo && <QuotedMessage reply={message.replyTo} />}

                    {deleted ? (
                      <Tombstone message={message} />
                    ) : editing === message.id ? (
                      <MessageEditor message={message} onDone={() => setEditing(null)} />
                    ) : (
                      <>
                        {/* A message that is only files has no text line at all. */}
                        {message.content.length > 0 && (
                          <>
                            <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-200">
                              <MessageText message={message} />
                            </p>
                            <MessageLinkPreviews content={message.content} />
                          </>
                        )}
                        <AttachmentList channelId={channel.id} attachments={message.attachments} />

                        {/* The footer, in the corner of the bubble: when it
                            was said, whether it has changed since, and
                            whether it is pinned. Inside, because a bubble
                            that hugs its own text has no margin left to hang
                            them in. */}
                        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-400/70">
                          {message.pinnedAt && <PinIcon className="h-2.5 w-2.5" aria-label="Pinned" />}
                          {message.editedAt && <span>edited</span>}
                          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                        </div>
                      </>
                    )}
                  </div>

                  {!deleted && editing !== message.id && (
                    <ReactionRow
                      message={message}
                      meId={me?.id}
                      onToggle={(emoji) => report(react(message.id, emoji))}
                      onMore={(at) => setPicker({ id: message.id, at })}
                    />
                  )}
                  {/* Only ever under your own message, and only once each
                      reader has got this far - see `anchorReceipts`. */}
                  {!deleted && editing !== message.id && (
                    <SeenByRow
                      receipts={anchors[message.id] ?? []}
                      onOpen={() => setSeenFor(message.id)}
                    />
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

      {seenFor &&
        (() => {
          const target = messages.find((item) => item.id === seenFor);
          if (!target) return null;
          return (
            <SeenByDialog
              sentAt={target.createdAt}
              receipts={seenBy(target, receipts ?? [])}
              onClose={() => setSeenFor(null)}
            />
          );
        })()}

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
  const members = useChatStore((state) => state.members);
  if (message.reactions.length === 0) return null;

  return (
    <ul className="mt-1 flex flex-wrap items-center gap-1">
      {message.reactions.map((reaction) => {
        const mine = meId !== undefined && reaction.userIds.includes(meId);
        // Who, not how many. A count answers "is this popular"; the question
        // people actually have about a reaction is who left it.
        const who = reactorNames(reaction.userIds, members, meId);
        return (
          <li key={reaction.emoji}>
            <button
              type="button"
              onClick={() => onToggle(reaction.emoji)}
              aria-pressed={mine}
              title={who ? `${who} reacted with ${reaction.emoji}` : undefined}
              aria-label={
                who
                  ? `${reaction.emoji}, ${who}`
                  : `${reaction.emoji} ${reaction.userIds.length}`
              }
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

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi;

function renderTextWithLinks(text: string): JSX.Element {
  const parts = text.split(URL_REGEX);
  return (
    <>
      {parts.map((part, i) => {
        if (part.match(/^https?:\/\//i)) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent-hover font-medium break-all transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

/**
 * A message's words, with its custom emoji drawn and URLs highlighted as hyperlinks.
 */
function MessageText({ message }: { message: DecryptedMessage }): JSX.Element {
  const pieces = splitMessage(message.content, message.emoji ?? []);
  const large = isOnlyEmoji(pieces);

  return (
    <>
      {pieces.map((piece, index) =>
        piece.kind === 'text' ? (
          <Fragment key={index}>{renderTextWithLinks(piece.text)}</Fragment>
        ) : (
          <img
            key={index}
            src={absoluteUrl(piece.emoji.url)}
            alt={`:${piece.emoji.name}:`}
            title={`:${piece.emoji.name}:`}
            className={`inline-block object-contain align-text-bottom ${
              large ? 'h-11 w-11' : 'h-[22px] w-[22px]'
            }`}
          />
        ),
      )}
    </>
  );
}

const previewCache = new Map<string, LinkPreview | null>();

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi);
  if (!matches) return [];
  return Array.from(new Set(matches)).slice(0, 2);
}

function LinkPreviewCard({ url }: { url: string }): JSX.Element | null {
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(() => previewCache.get(url));

  useEffect(() => {
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url));
      return;
    }
    let cancelled = false;
    api.unfurl(url).then(
      (res) => {
        previewCache.set(url, res);
        if (!cancelled) setPreview(res);
      },
      () => {
        previewCache.set(url, null);
        if (!cancelled) setPreview(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview || (!preview.title && !preview.description && !preview.image)) {
    return null;
  }

  let domain = '';
  try {
    domain = new URL(preview.url).hostname;
  } catch {
    domain = preview.url;
  }

  return (
    <div className="mt-2.5 max-w-lg rounded-r-lg border border-edge border-l-4 border-l-accent bg-surface-900/90 p-3 shadow-md transition-all hover:bg-surface-850">
      {/* Site Name & Favicon */}
      <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-400">
        {preview.favicon && (
          <img
            src={preview.favicon}
            alt=""
            className="h-3.5 w-3.5 rounded-sm object-contain"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        )}
        <span className="truncate">{preview.siteName || domain}</span>
      </div>

      {/* Title */}
      {preview.title && (
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block text-sm font-semibold text-accent hover:underline line-clamp-2"
          onClick={(e) => e.stopPropagation()}
        >
          {preview.title}
        </a>
      )}

      {/* Description */}
      {preview.description && (
        <p className="mt-1 text-xs text-slate-300 line-clamp-3 leading-relaxed">
          {preview.description}
        </p>
      )}

      {/* Image Preview */}
      {preview.image && (
        <div className="mt-2.5 overflow-hidden rounded-md border border-edge/60 bg-surface-950">
          <img
            src={preview.image}
            alt={preview.title || 'Preview image'}
            className="max-h-60 w-full object-cover"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        </div>
      )}
    </div>
  );
}

function MessageLinkPreviews({ content }: { content: string }): JSX.Element | null {
  const urls = extractUrls(content);
  if (urls.length === 0) return null;
  return (
    <div className="flex flex-col space-y-1">
      {urls.map((url) => (
        <LinkPreviewCard key={url} url={url} />
      ))}
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

/** More than this in one message and the point is a folder, not a chat. */
const MAX_FILES = 10;

function MessageComposer({
  channel,
  takeFiles,
}: {
  channel: Channel;
  /** Filled in here so a drop anywhere in the panel lands in this box. */
  takeFiles: { current: ((files: File[]) => void) | null };
}): JSX.Element {
  const sendMessage = useChatStore((state) => state.sendMessage);
  const replyTo = useChatStore((state) => state.replyingTo[channel.id] ?? null);
  const setReplyTo = useChatStore((state) => state.setReplyTo);
  const notifyTyping = usePresenceStore((state) => state.notifyTyping);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * The `:shortcode` being typed at the caret, if there is one. Held rather
   * than derived on render because it depends on where the caret is, which is a
   * property of the element and not of the value.
   */
  const [emojiQuery, setEmojiQuery] = useState<{ term: string; start: number } | null>(null);
  /**
   * This server's own emoji, for the `:` menu. Read through a subscription
   * rather than a store because the list belongs to the server rather than to
   * any one screen - see `services/server-emoji.ts`.
   */
  const serverId = useChatStore((state) => state.activeServerId);
  const [customEmoji, setCustomEmoji] = useState(() => emojiFor(serverId));
  useEffect(() => {
    setCustomEmoji(emojiFor(serverId));
    return onEmojiChanged(() => setCustomEmoji(emojiFor(serverId)));
  }, [serverId]);
  const [emoji, setEmoji] = useState<{ x: number; y: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  const placeholder =
    channel.type === 'DM'
      ? isMobile
        ? `@${channel.name}`
        : `Message @${channel.name}`
      : isMobile
        ? `#${channel.name}`
        : `Message #${channel.name}`;

  // Choosing "Reply" in the menu is choosing to type, so the caret goes to the
  // box rather than leaving one more click between the two.
  useEffect(() => {
    if (replyTo) box.current?.focus();
  }, [replyTo]);

  /**
   * The box grows with what is typed into it, up to the cap the stylesheet
   * sets, and scrolls after that - which is what every chat app does and what
   * a fixed `rows={1}` textarea cannot: a wrapped message past the first line
   * was written into a box too short to read it back in.
   *
   * `auto` first, because a textarea's `scrollHeight` never shrinks below the
   * height it is currently set to - measuring without resetting only ever
   * grows the box, never lets it back down when the text is deleted.
   */
  useLayoutEffect(() => {
    const area = box.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [content]);

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
    // Pictures and video get looked at before they are sent; a spreadsheet has
    // nothing to look at, so it stays a chip on the composer.
    if (incoming.some(isPreviewable)) setPreviewing(true);
  };

  // The drop target is the whole conversation panel, which is a component up.
  takeFiles.current = addFiles;

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
      setPreviewing(false);
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
    /* Dropping is handled by the panel, not by this box: a file aimed at the
       conversation is aimed at the conversation, and a two-centimetre target at
       the bottom of it was never the intent. */
    <form onSubmit={(event) => void submit(event)} className="relative shrink-0 px-2 sm:px-3.5 pb-2 sm:pb-4">
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

      <div className="rounded-xl border border-edge bg-surface-800 transition-colors duration-150 focus-within:border-white/[0.14]">
        {replyTo && (
          <div className="flex items-center gap-2 border-b border-edge px-3 sm:px-4 py-2">
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
              className="ml-auto flex h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-auto sm:w-auto cursor-pointer items-center justify-center text-slate-400 transition-colors duration-200 hover:text-danger"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-b border-edge px-3 sm:px-4 py-2.5">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 rounded bg-surface-800 px-2 py-1.5"
              >
                {isImage(file) ? (
                  <ImageIcon className="h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
                )}
                {isPreviewable(file) ? (
                  <button
                    type="button"
                    onClick={() => setPreviewing(true)}
                    title={`Look at ${file.name} before sending`}
                    className="max-w-[14rem] cursor-pointer truncate text-xs text-slate-200 underline-offset-2 hover:underline"
                  >
                    {file.name}
                  </button>
                ) : (
                  <span className="max-w-[14rem] truncate text-xs text-slate-200">{file.name}</span>
                )}
                <span className="text-xs text-slate-500">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  disabled={sending}
                  onClick={() => setFiles(files.filter((_, at) => at !== index))}
                  className="flex h-7 w-7 min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 sm:h-auto sm:w-auto cursor-pointer items-center justify-center text-slate-400 transition-colors duration-200 hover:text-danger disabled:cursor-not-allowed"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-1 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5">
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
            className="flex h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-auto sm:w-auto cursor-pointer items-center justify-center rounded-md p-1.5 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
          >
            <PaperclipIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={(event) => setEmoji({ x: event.clientX, y: event.clientY })}
            disabled={sending}
            aria-label="Insert an emoji"
            title="Emoji"
            className="flex h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-auto sm:w-auto cursor-pointer items-center justify-center rounded-md p-1.5 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
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
              setEmojiQuery(emojiQueryAt(event.target.value, event.target.selectionStart ?? 0));
              if (event.target.value.length > 0) notifyTyping(channel.id);
            }}
            onSelect={(event) => {
              // Moving the caret in or out of a shortcode changes the answer as
              // much as typing does - clicking behind a `:word` should offer it.
              const box = event.currentTarget;
              setEmojiQuery(emojiQueryAt(box.value, box.selectionStart ?? 0));
            }}
            onBlur={() => setEmojiQuery(null)}
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
            className="max-h-40 min-h-[32px] sm:min-h-[24px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 sm:py-0.5 text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || (content.trim().length === 0 && files.length === 0)}
            aria-label="Send message"
            className="flex h-9 w-9 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-auto sm:w-auto cursor-pointer items-center justify-center rounded-md p-1.5 text-slate-300 transition-colors duration-200 hover:text-accent disabled:cursor-not-allowed disabled:text-slate-600"
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

      {emojiQuery && (
        <EmojiSuggest
          term={emojiQuery.term}
          custom={customEmoji}
          onClose={() => setEmojiQuery(null)}
          onPick={(emoji) => {
            // The shortcode is replaced, not appended to: what is on screen is
            // `:fir`, and leaving that behind next to a 🔥 is the bug every
            // half-finished version of this feature ships with.
            const end = emojiQuery.start + emojiQuery.term.length + 1;
            const next = `${content.slice(0, emojiQuery.start)}${emoji}${content.slice(end)}`;
            const caret = emojiQuery.start + emoji.length;
            setContent(next);
            setEmojiQuery(null);
            window.setTimeout(() => {
              box.current?.focus();
              box.current?.setSelectionRange(caret, caret);
            }, 0);
          }}
        />
      )}

      {previewing && files.length > 0 && (
        <SendPreview
          files={files}
          caption={content}
          placeholder={`Add a caption${channel.type === 'DM' ? '' : ` for #${channel.name}`}`}
          sending={sending}
          uploading={uploading}
          failure={failure}
          onCaption={setContent}
          onAdd={() => picker.current?.click()}
          onRemove={(index) => {
            const left = files.filter((_, at) => at !== index);
            setFiles(left);
            if (left.length === 0) setPreviewing(false);
          }}
          onReplace={(index, edited) =>
            setFiles(files.map((file, at) => (at === index ? edited : file)))
          }
          onSend={() => void submit()}
          onClose={() => {
            setFiles([]);
            setPreviewing(false);
          }}
        />
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
