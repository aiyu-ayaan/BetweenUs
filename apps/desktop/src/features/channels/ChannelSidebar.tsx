import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, ChannelCategory, ChannelType } from '@betweenus/shared-types';
import { PERMISSIONS } from '@betweenus/permissions';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { useVoiceStore } from '../../stores/voice';
import { VoicePanel } from '../voice/VoicePanel';
import { UserPanel } from '../settings/UserPanel';
import { CreateChannelDialog } from './CreateChannelDialog';
import { CategoryDialog } from './CategoryDialog';
import {
  buildSections,
  collapsedSummary,
  layoutFrom,
  moveCategoryBefore,
  moveChannelBefore,
  moveChannelToEnd,
  parseCollapsed,
  sameLayout,
  stepCategory,
  stepChannel,
  type Section,
} from './sidebar-layout';
import { Avatar } from '../../components/Avatar';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  HashIcon,
  LockIcon,
  MoreIcon,
  SettingsIcon,
  SpeakerIcon,
  XIcon,
} from '../../components/icons';

export function ChannelSidebar({
  onOpenUserSettings,
  onOpenServerSettings,
  onNavigate,
  className = 'w-60',
}: {
  onOpenUserSettings: () => void;
  onOpenServerSettings: () => void;
  /** Called on any click in the channel list - see `ServerRail`'s prop of
      the same name for why this can't just be an effect on the chat store. */
  onNavigate?: () => void;
  className?: string;
}): JSX.Element {
  const {
    servers,
    channels,
    categories,
    activeServerId,
    activeChannelId,
    unread,
    selectChannel,
    arrangeChannels,
    createCategory,
    renameCategory,
    deleteCategory,
  } = useChatStore();

  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; category: ChannelCategory } | null
  >(null);
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [arrangeError, setArrangeError] = useState<string | null>(null);
  const { collapsed, toggleCollapsed } = useCollapsedCategories(activeServerId);
  const focusAfter = useRef<string | null>(null);

  const server = servers.find((item) => item.id === activeServerId);
  const canManageChannels = server?.permissions.includes(PERMISSIONS.MANAGE_CHANNEL) ?? false;

  const sections = useMemo(() => buildSections(categories, channels), [categories, channels]);

  // A keyboard move re-orders the DOM under the focused row; put focus back.
  useEffect(() => {
    const key = focusAfter.current;
    if (!key) return;
    focusAfter.current = null;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"] button`)?.focus();
    });
  });

  /** Applies an arrangement optimistically; the store rolls it back on failure. */
  const commit = useCallback(
    (next: Section[], focusKey?: string, label?: string): void => {
      setDrag(null);
      if (sameLayout(next, sections)) return;
      setArrangeError(null);
      if (focusKey) focusAfter.current = focusKey;
      if (label) setAnnouncement(`Moved ${label}`);
      arrangeChannels(layoutFrom(next)).catch((failure: unknown) => {
        setAnnouncement('');
        setArrangeError(
          failure instanceof Error ? failure.message : 'The channels could not be rearranged',
        );
      });
    },
    [sections, arrangeChannels],
  );

  /** Draggable only for somebody who could save the result. */
  const dragProps = (
    item: DragItem | null,
    onDrop: () => void,
  ): React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean } => {
    if (!canManageChannels) return {};
    return {
      ...(item
        ? {
            draggable: true,
            onDragStart: (event: React.DragEvent) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = 'move';
              // Firefox will not start a drag without data.
              event.dataTransfer.setData('text/plain', item.id);
              setDrag(item);
            },
            onDragEnd: () => setDrag(null),
          }
        : {}),
      onDragOver: (event: React.DragEvent) => {
        if (!drag) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      },
    };
  };

  const removeCategory = async (category: ChannelCategory): Promise<void> => {
    if (
      !confirm(
        `Delete the category "${category.name}"? Its channels stay, and move to the top of the list.`,
      )
    ) {
      return;
    }
    setArrangeError(null);
    try {
      await deleteCategory(category.id);
    } catch (failure) {
      setArrangeError(
        failure instanceof Error ? failure.message : 'The category could not be deleted',
      );
    }
  };

  return (
    <aside className={`panel flex shrink-0 flex-col bg-surface-900 border-e border-edge/60 ${className}`}>
      <ServerHeader
        name={server?.name ?? 'Server'}
        open={menuOpen}
        onToggle={() => setMenuOpen((value) => !value)}
        onOpenSettings={() => {
          setMenuOpen(false);
          onOpenServerSettings();
        }}
      />

      <nav
        aria-label="Channels"
        onClickCapture={onNavigate}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        <div className="flex items-center justify-between px-1 pb-1 pt-3.5">
          <span className="text-[11px] font-bold tracking-wider text-slate-400">CHANNELS</span>
          {canManageChannels && (
            <div className="flex items-center gap-0.5">
              <HeadingButton label="Create text channel" onClick={() => setCreating('TEXT')}>
                <HashIcon className="h-3.5 w-3.5" />
              </HeadingButton>
              <HeadingButton label="Create voice channel" onClick={() => setCreating('VOICE')}>
                <SpeakerIcon className="h-3.5 w-3.5" />
              </HeadingButton>
              <HeadingButton
                label="Create category"
                onClick={() => setCategoryDialog({ mode: 'create' })}
              >
                <FolderIcon className="h-3.5 w-3.5" />
              </HeadingButton>
            </div>
          )}
        </div>

        {/* Read out by screen readers after a keyboard move, since the row
            they were on has just changed places. */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {arrangeError && (
          <p role="alert" className="mx-1 mb-1 rounded bg-danger/10 px-2 py-1.5 text-xs text-danger">
            {arrangeError}
          </p>
        )}

        {sections.map((section) => {
          const category = section.category;
          const folded = category !== null && collapsed.has(category.id);
          const summary = collapsedSummary(section, unread, activeChannelId);
          // A folded category still shows the channel you are standing in.
          const visible = folded
            ? section.channels.filter((channel) => channel.id === activeChannelId)
            : section.channels;

          return (
            <div key={category?.id ?? 'loose'} className={category ? 'mt-2' : ''}>
              {category && (
                <CategoryHeader
                  category={category}
                  folded={folded}
                  unread={folded ? summary.unread : 0}
                  containsActive={folded && summary.containsActive}
                  canManage={canManageChannels}
                  dragging={drag?.kind === 'category' && drag.id === category.id}
                  onToggle={() => toggleCollapsed(category.id)}
                  onKeyDown={(event) => {
                    const delta = keyboardDelta(event, canManageChannels);
                    if (delta === 0) return;
                    event.preventDefault();
                    commit(
                      stepCategory(sections, category.id, delta),
                      `category:${category.id}`,
                      category.name,
                    );
                  }}
                  onRename={() => setCategoryDialog({ mode: 'rename', category })}
                  onDelete={() => void removeCategory(category)}
                  onMove={(delta) =>
                    commit(
                      stepCategory(sections, category.id, delta),
                      `category:${category.id}`,
                      category.name,
                    )
                  }
                  dragProps={dragProps({ kind: 'category', id: category.id }, () => {
                    if (drag?.kind === 'category') {
                      commit(moveCategoryBefore(sections, drag.id, category.id));
                    } else if (drag?.kind === 'channel') {
                      commit(moveChannelToEnd(sections, drag.id, category.id));
                    }
                  })}
                />
              )}

              <div
                className="space-y-0.5"
                // The loose list is a drop target of its own, or an empty one
                // could never receive anything.
                {...(category === null
                  ? dragProps(null, () => {
                      if (drag?.kind === 'channel') {
                        commit(moveChannelToEnd(sections, drag.id, null));
                      }
                    })
                  : {})}
              >
                {visible.map((channel) => (
                  <div
                    key={channel.id}
                    data-focus-key={`channel:${channel.id}`}
                    onKeyDown={(event) => {
                      const delta = keyboardDelta(event, canManageChannels);
                      if (delta === 0) return;
                      event.preventDefault();
                      commit(
                        stepChannel(sections, channel.id, delta),
                        `channel:${channel.id}`,
                        channel.name,
                      );
                    }}
                    className={drag?.kind === 'channel' && drag.id === channel.id ? 'opacity-40' : ''}
                    {...dragProps({ kind: 'channel', id: channel.id }, () => {
                      if (drag?.kind === 'channel') {
                        commit(moveChannelBefore(sections, drag.id, channel.id));
                      }
                    })}
                  >
                    {channel.type === 'VOICE' ? (
                      <VoiceChannelRow channel={channel} />
                    ) : (
                      <TextChannelRow
                        channel={channel}
                        isActive={activeChannelId === channel.id}
                        unreadCount={unread[channel.id] ?? 0}
                        onSelect={() => void selectChannel(channel.id)}
                      />
                    )}
                  </div>
                ))}

                {category === null && section.channels.length === 0 && categories.length === 0 && (
                  <p className="px-2.5 py-2 text-xs text-slate-500">No channels yet</p>
                )}
                {category !== null && !folded && section.channels.length === 0 && (
                  <p className="px-2.5 py-1 text-xs text-slate-500">
                    {canManageChannels ? 'Empty - drag a channel here' : 'No channels'}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        <VoiceError />
      </nav>

      <VoicePanel />
      <UserPanel onOpenSettings={onOpenUserSettings} />

      {creating && (
        <CreateChannelDialog type={creating} onClose={() => setCreating(null)} />
      )}

      {categoryDialog && (
        <CategoryDialog
          title={categoryDialog.mode === 'create' ? 'Create category' : 'Rename category'}
          action={categoryDialog.mode === 'create' ? 'Create' : 'Save'}
          initial={categoryDialog.mode === 'rename' ? categoryDialog.category.name : ''}
          onSubmit={(name) =>
            categoryDialog.mode === 'create'
              ? createCategory(name)
              : renameCategory(categoryDialog.category.id, name)
          }
          onClose={() => setCategoryDialog(null)}
        />
      )}
    </aside>
  );
}

function ServerHeader({
  name,
  open,
  onToggle,
  onOpenSettings,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
}): JSX.Element {
  const activeServerId = useChatStore((state) => state.activeServerId);
  const servers = useChatStore((state) => state.servers);
  const members = useChatStore((state) => state.members);
  const online = usePresenceStore((state) => state.online);
  const leaveServer = useChatStore((state) => state.leaveServer);
  const server = servers.find((item) => item.id === activeServerId);
  const isOwner = server?.role === 'OWNER';

  const onlineCount = members.filter((m) => online.has(m.userId)).length;
  const subtitle =
    members.length > 0
      ? `${onlineCount} Online • ${members.length} Members`
      : 'End-to-End Encrypted';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-14 w-full cursor-pointer items-center justify-between border-b border-edge/60 px-4 text-start transition-colors duration-200 hover:bg-white/[0.05]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-bold text-slate-100">{name}</h2>
            <span
              className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm"
              title="Verified E2EE Mesh"
            >
              <CheckIcon className="h-2 w-2 stroke-[3]" />
            </span>
          </div>
          <p className="truncate text-[11px] font-medium text-slate-400">
            {subtitle}
          </p>
        </div>
        {open ? (
          <XIcon className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute inset-x-2 top-full z-30 mt-1 animate-pop overflow-hidden rounded-xl border border-edge bg-surface-950 py-1.5 shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onOpenSettings}
            className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm text-slate-200 hover:bg-accent hover:text-white"
          >
            Server settings
            <SettingsIcon className="h-4 w-4" />
          </button>
          {!isOwner && (
            <button
              type="button"
              role="menuitem"
              onClick={() => void leaveServer()}
              className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm text-danger hover:bg-danger hover:text-white"
            >
              Leave server
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type DragItem = { kind: 'channel' | 'category'; id: string };

/** Alt+Up / Alt+Down, for somebody who may rearrange. Anything else is 0. */
function keyboardDelta(event: React.KeyboardEvent, canManage: boolean): -1 | 0 | 1 {
  if (!canManage || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  if (event.key === 'ArrowUp') return -1;
  if (event.key === 'ArrowDown') return 1;
  return 0;
}

const COLLAPSED_KEY = 'betweenus.collapsed-categories';

/**
 * Which categories this person has folded away, in this server, on this
 * device. Local on purpose: how tidy somebody wants their own sidebar is
 * nobody else's business, and it needs no permission and no migration.
 */
function useCollapsedCategories(serverId: string | null): {
  collapsed: Set<string>;
  toggleCollapsed: (categoryId: string) => void;
} {
  const key = `${COLLAPSED_KEY}.${serverId ?? ''}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(key));

  useEffect(() => setCollapsed(readCollapsed(key)), [key]);

  const toggleCollapsed = (categoryId: string): void => {
    const next = new Set(collapsed);
    if (next.has(categoryId)) next.delete(categoryId);
    else next.add(categoryId);
    setCollapsed(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      // No storage: it still folds for this session.
    }
  };

  return { collapsed, toggleCollapsed };
}

function readCollapsed(key: string): Set<string> {
  try {
    return parseCollapsed(localStorage.getItem(key));
  } catch {
    return new Set();
  }
}

function HeadingButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="cursor-pointer rounded-md p-0.5 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100 active:scale-95"
    >
      {children}
    </button>
  );
}

function TextChannelRow({
  channel,
  isActive,
  unreadCount,
  onSelect,
}: {
  channel: Channel;
  isActive: boolean;
  unreadCount: number;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isActive ? 'page' : undefined}
      className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px] font-medium transition-all duration-150 active:scale-[0.98] ${
        isActive
          ? 'border border-accent/20 bg-accent/20 text-white shadow-sm'
          : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
      }`}
    >
      <HashIcon className={`h-4 w-4 shrink-0 ${isActive ? 'text-accent' : 'text-slate-500'}`} />
      <span className={`truncate flex-1 ${isActive ? 'font-semibold text-white' : ''}`}>
        {channel.name}
      </span>
      {channel.isPrivate && <LockIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
      {unreadCount > 0 && (
        <span className="ms-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-sm">
          {unreadCount}
        </span>
      )}
    </button>
  );
}

/**
 * A category's heading: the button that folds it, and - for somebody who may
 * manage channels - a menu with the same moves drag does, so the keyboard and
 * a screen reader have every action a pointer has.
 */
function CategoryHeader({
  category,
  folded,
  unread,
  containsActive,
  canManage,
  dragging,
  onToggle,
  onKeyDown,
  onRename,
  onDelete,
  onMove,
  dragProps,
}: {
  category: ChannelCategory;
  folded: boolean;
  unread: number;
  containsActive: boolean;
  canManage: boolean;
  dragging: boolean;
  onToggle: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onRename: () => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}): JSX.Element {
  const [menu, setMenu] = useState(false);
  const Chevron = folded ? ChevronRightIcon : ChevronDownIcon;

  return (
    <div
      data-focus-key={`category:${category.id}`}
      {...dragProps}
      className={`group relative flex items-center justify-between px-1 pb-1 pt-1.5 ${dragging ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={onKeyDown}
        aria-expanded={!folded}
        title={canManage ? 'Alt+Up / Alt+Down to move' : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 text-start text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-slate-100"
      >
        <Chevron className="h-3 w-3 shrink-0" />
        <span className="truncate">{category.name}</span>
        {unread > 0 && (
          <span className="ms-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold normal-case text-white">
            {unread}
          </span>
        )}
        {containsActive && unread === 0 && (
          <span aria-hidden="true" className="ms-1 h-1.5 w-1.5 rounded-full bg-accent" />
        )}
      </button>

      {canManage && (
        <>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={`${category.name} options`}
            onClick={() => setMenu((value) => !value)}
            className="cursor-pointer rounded-md p-0.5 text-slate-400 opacity-0 transition-opacity hover:bg-white/[0.07] hover:text-slate-100 focus:opacity-100 group-hover:opacity-100"
          >
            <MoreIcon className="h-3.5 w-3.5" />
          </button>
          {menu && (
            <div
              role="menu"
              aria-label={`${category.name} options`}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setMenu(false);
              }}
              className="absolute end-0 top-full z-30 mt-0.5 w-40 overflow-hidden rounded-lg border border-edge bg-surface-950 py-1 shadow-pop"
            >
              {[
                { label: 'Rename', run: onRename, danger: false },
                { label: 'Move up', run: () => onMove(-1), danger: false },
                { label: 'Move down', run: () => onMove(1), danger: false },
                { label: 'Delete category', run: onDelete, danger: true },
              ].map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  autoFocus={index === 0}
                  onClick={() => {
                    setMenu(false);
                    item.run();
                  }}
                  className={`block w-full px-3 py-1.5 text-start text-sm focus:outline-none ${
                    item.danger
                      ? 'text-danger hover:bg-danger hover:text-white focus:bg-danger focus:text-white'
                      : 'text-slate-200 hover:bg-white/[0.07] focus:bg-white/[0.07]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VoiceChannelRow({ channel }: { channel: Channel }): JSX.Element {
  const members = useChatStore((state) => state.members);
  const activeChannelId = useChatStore((state) => state.activeChannelId);
  const selectChannel = useChatStore((state) => state.selectChannel);
  const occupants = usePresenceStore((state) => state.voice.get(channel.id) ?? []);
  const join = useVoiceStore((state) => state.join);
  const status = useVoiceStore((state) => state.status);
  const connectedTo = useVoiceStore((state) => state.channelId);
  const tiles = useVoiceStore((state) => state.tiles);

  const here = connectedTo === channel.id && status === 'connected';
  const connectingHere = connectedTo === channel.id && status === 'connecting';
  const viewing = activeChannelId === channel.id;
  const occupied = occupants.length > 0;

  const open = (): void => {
    void selectChannel(channel.id);
    if (connectedTo !== channel.id) void join(channel.id);
  };

  return (
    // A card, tinted green, only while somebody is actually here - an empty
    // channel stays a plain row. The tint is what makes "something is
    // happening in here" readable at a glance down a list of six channels.
    <div className={occupied ? 'rounded-lg border border-emerald-500/15 bg-emerald-500/[0.08] p-1' : ''}>
      <button
        type="button"
        onClick={open}
        aria-current={viewing ? 'page' : undefined}
        className={`spring-press flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-start text-[13px] font-medium ${
          here || connectingHere || viewing
            ? 'bg-accent/20 text-white shadow-sm'
            : occupied
              ? 'text-slate-200 hover:bg-white/[0.05]'
              : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <SpeakerIcon
            className={`h-4 w-4 shrink-0 ${here ? 'text-emerald-400' : 'text-slate-500'}`}
          />
          <span className="truncate">{channel.name}</span>
        </span>
        {connectingHere && (
          <span className="animate-pulse text-xs text-status-online">connecting…</span>
        )}
        {occupied && (
          <span className="font-mono text-xs text-emerald-400">[{occupants.length}]</span>
        )}
      </button>

      {occupied && (
        <ul className="space-y-0.5 ps-6 pt-1 pb-0.5">
          {occupants.map((userId) => {
            const member = members.find((item) => item.userId === userId);
            // Real speaking energy only exists for a call this machine has
            // joined - presence carries who is *in* a channel, not who is
            // making sound in one it never connected to.
            const speaking = here && tiles.some((tile) => tile.userId === userId && tile.speaking);
            return (
              <li key={userId} className="flex items-center gap-2 py-0.5 text-xs text-slate-300">
                <Avatar
                  name={member?.displayName ?? 'Someone'}
                  avatarUrl={member?.avatarUrl}
                  size="xs"
                  ringColour="border-surface-900"
                  viewable={false}
                />
                <span className={`truncate ${speaking ? 'font-medium text-slate-100' : ''}`}>
                  {member?.displayName ?? 'Someone'}
                </span>
                {speaking && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse-subtle rounded-full bg-emerald-400" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function VoiceError(): JSX.Element | null {
  const error = useVoiceStore((state) => state.error);
  if (!error) return null;

  return (
    <div
      role="alert"
      className="mx-1 mt-1 flex items-start justify-between gap-1.5 rounded bg-danger/10 px-2 py-1.5 text-xs text-danger"
    >
      <span className="min-w-0 flex-1 break-words">{error}</span>
      <button
        type="button"
        onClick={() => useVoiceStore.getState().dismissError()}
        className="inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded text-danger/70 transition-colors hover:bg-danger/20 hover:text-danger"
        title="Dismiss error"
        aria-label="Dismiss error"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
