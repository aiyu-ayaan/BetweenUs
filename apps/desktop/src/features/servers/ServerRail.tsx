import { useEffect, useState } from 'react';
import type { ServerWithRole } from '@betweenus/shared-types';
import { useChatStore } from '../../stores/chat';
import {
  clearPendingInvite,
  inviteCodeFrom,
  pendingInvite,
} from '../../services/invite-link';
import { InviteDialog } from './InviteDialog';
import {
  ChevronDownIcon,
  CompassIcon,
  FolderIcon,
  MessageIcon,
  PlusIcon,
} from '../../components/icons';
import { ServerIcon } from '../../components/ServerIcon';
import { useFocusTrap } from '../../services/focus-trap';
import { folderUnread, railEntries, useServerFolders } from '../../stores/serverFolders';

/**
 * The rail's context menu - how a server gets put in a folder.
 *
 * A menu and not dragging: the client has no drag library and this is not
 * worth adding one for, and a menu is the affordance that already works from
 * the keyboard (the menu key and Shift+F10 raise `contextmenu` on whatever is
 * focused) without a second keyboard path having to be invented for it.
 */
interface RailMenu {
  /** Named after the thing the menu belongs to, so it reads out as one. */
  label: string;
  top: number;
  items: { label: string; run: () => void }[];
}

/** One dialog, three jobs - the third one names a folder. */
const DIALOG_COPY = {
  create: {
    title: 'Create a server',
    blurb: 'Your server is where you and your people hang out. Make one and start talking.',
    field: 'Server name',
    placeholder: 'My community',
    action: 'Create',
  },
  join: {
    title: 'Join a server',
    blurb: 'Paste the invite code someone sent you.',
    field: 'Invite code',
    placeholder: 'betweenus-team',
    action: 'Join',
  },
  folder: {
    title: 'New folder',
    blurb: 'Folders only exist on this machine. Nobody else sees how you sort your rail.',
    field: 'Folder name',
    placeholder: 'Work',
    action: 'Create',
  },
} as const;

export function ServerRail({
  className,
  onNavigate,
}: {
  className?: string;
  /** Called on any click in the rail - what `App.tsx` uses to drop the top
      bar back to Workbench, since picking a server the workbench is already
      pinned to changes nothing in the chat store for an effect to react to. */
  onNavigate?: () => void;
} = {}): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const {
    servers,
    channelServerId,
    unread,
    view,
    activeServerId,
    selectServer,
    showHome,
    createServer,
  } = useChatStore();
  const { folders, createFolder, removeFolder, fileServer, toggleCollapsed } = useServerFolders();
  const [dialog, setDialog] = useState<'none' | 'create' | 'join' | 'folder'>('none');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const [menu, setMenu] = useState<RailMenu | null>(null);
  /** The server waiting for the folder the "New folder" dialog is naming. */
  const [filing, setFiling] = useState<string | null>(null);

  useEffect(() => {
    const code = pendingInvite();
    if (!code) return;
    clearPendingInvite();
    setInvited(code);
  }, []);

  // Summed from the durable channelId -> serverId map, not from `channels` -
  // that array is reset to whichever server is currently open, so every other
  // server's icon read a permanent zero here.
  const unreadFor = (serverId: string): number =>
    Object.entries(unread).reduce(
      (sum, [channelId, count]) => (channelServerId[channelId] === serverId ? sum + count : sum),
      0,
    );

  /**
   * Menus open off the button's own box rather than the pointer, because the
   * keyboard raises `contextmenu` with no useful coordinates and a menu that
   * lands in the corner of the screen for keyboard users is not a menu.
   */
  const openMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    label: string,
    items: RailMenu['items'],
  ): void => {
    event.preventDefault();
    setMenu({ label, top: event.currentTarget.getBoundingClientRect().top, items });
  };

  const serverMenu = (serverId: string, folderId: string | null): RailMenu['items'] => [
    ...folders
      .filter((folder) => folder.id !== folderId)
      .map((folder) => ({
        label: `Move to ${folder.name}`,
        run: () => fileServer(serverId, folder.id),
      })),
    {
      label: 'New folder...',
      run: () => {
        setFiling(serverId);
        setValue('');
        setFailure(null);
        setDialog('folder');
      },
    },
    ...(folderId ? [{ label: 'Remove from folder', run: () => fileServer(serverId, null) }] : []),
  ];

  const submit = async (): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      if (dialog === 'folder') {
        const folderId = createFolder(trimmed);
        if (filing) fileServer(filing, folderId);
        setFiling(null);
      } else if (dialog === 'create') {
        await createServer(trimmed);
      } else {
        const code = inviteCodeFrom(trimmed);
        if (!code) throw new Error('That is not an invite link or code');
        setInvited(code);
      }
      setDialog('none');
      setValue('');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav
      aria-label="Servers"
      onClickCapture={onNavigate}
      className={`relative flex w-16 shrink-0 flex-col items-center gap-1.5 overflow-y-auto bg-surface-950 py-2.5 ${className ?? ''}`}
    >
      {/* Direct Messages Icon Button */}
      <RailButton
        label="Direct messages"
        active={view === 'home'}
        onClick={showHome}
        activeClasses="bg-accent text-white shadow-lg shadow-accent/25 rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-surface-950"
        shape={view === 'home' ? 'rounded-2xl' : 'rounded-full hover:rounded-2xl'}
      >
        <MessageIcon className="h-5 w-5" />
      </RailButton>

      <hr className="my-1 w-8 border-t border-edge/60" />

      {/* Real Servers from store, folded by this machine's own grouping */}
      {railEntries(folders, servers).map((entry) => {
        if (entry.kind === 'server') {
          return (
            <ServerRailButton
              key={entry.server.id}
              server={entry.server}
              active={view === 'server' && activeServerId === entry.server.id}
              badge={unreadFor(entry.server.id)}
              onClick={() => void selectServer(entry.server.id)}
              onContextMenu={(event) =>
                openMenu(event, entry.server.name, serverMenu(entry.server.id, null))
              }
            />
          );
        }

        const { folder } = entry;
        const inside = folderUnread(entry.servers, unreadFor);
        const holdsActive = entry.servers.some((server) => server.id === activeServerId);

        return (
          <div key={folder.id} className="flex w-full flex-col items-center">
            <RailButton
              label={`${folder.name} folder, ${entry.servers.length} servers`}
              active={folder.collapsed && view === 'server' && holdsActive}
              expanded={!folder.collapsed}
              // A collapsed folder wears what it is hiding: folding a server
              // away must not fold away the fact that it wants you.
              badge={folder.collapsed && inside > 0 ? inside : undefined}
              onClick={() => toggleCollapsed(folder.id)}
              onContextMenu={(event) =>
                openMenu(event, folder.name, [
                  { label: 'Delete folder', run: () => removeFolder(folder.id) },
                ])
              }
              activeClasses="bg-accent/30 text-white rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-surface-950"
              shape="rounded-2xl"
            >
              {folder.collapsed ? (
                <FolderIcon className="h-5 w-5" />
              ) : (
                <ChevronDownIcon className="h-5 w-5" />
              )}
            </RailButton>

            {!folder.collapsed && (
              <div className="flex w-full flex-col items-center rounded-2xl bg-surface-800/30 py-1">
                {entry.servers.map((server) => (
                  <ServerRailButton
                    key={server.id}
                    server={server}
                    active={view === 'server' && activeServerId === server.id}
                    badge={unreadFor(server.id)}
                    onClick={() => void selectServer(server.id)}
                    onContextMenu={(event) =>
                      openMenu(event, server.name, serverMenu(server.id, folder.id))
                    }
                  />
                ))}
                {entry.servers.length === 0 && (
                  <p className="px-1 py-1 text-center text-[9px] leading-tight text-slate-500">Empty</p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Add Server Button */}
      <RailButton
        label="Create a server"
        active={false}
        onClick={() => setDialog('create')}
        idleTextClasses="text-emerald-400"
        activeClasses="bg-emerald-500 text-white"
        shape="rounded-full hover:rounded-2xl hover:bg-emerald-500/20"
      >
        <PlusIcon className="h-5 w-5 text-emerald-400" />
      </RailButton>

      {/* Explore / Join Servers Button */}
      <RailButton
        label="Join a server"
        active={false}
        onClick={() => setDialog('join')}
        idleTextClasses="text-slate-400"
        activeClasses="bg-white/[0.07] text-slate-100"
        shape="rounded-full hover:rounded-2xl hover:bg-white/[0.08]"
      >
        <CompassIcon className="h-5 w-5 text-slate-400" />
      </RailButton>

      {menu && (
        <>
          {/* Click anywhere else and the menu goes. Not `aria-modal`: it makes
              a promise about the Tab key that only a focus trap keeps, and a
              menu you can Tab out of is fine. */}
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setMenu(null)}
          />
          <div
            role="menu"
            aria-label={`${menu.label} options`}
            style={{ top: menu.top }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMenu(null);
            }}
            className="fixed start-[4.25rem] z-50 w-52 overflow-hidden rounded-lg border border-edge bg-surface-900 py-1 text-start shadow-pop"
          >
            {menu.items.map((item, index) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                autoFocus={index === 0}
                onClick={() => {
                  item.run();
                  setMenu(null);
                }}
                className="block w-full px-3 py-2 text-start text-sm text-slate-200 transition-colors hover:bg-white/[0.07] focus:bg-white/[0.07] focus:outline-none"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}

      {invited && <InviteDialog code={invited} onClose={() => setInvited(null)} />}

      {dialog !== 'none' && (
        <div
          ref={trap}
          role="dialog"
          aria-modal="true"
          aria-label={DIALOG_COPY[dialog].title}
          className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4"
          onClick={() => setDialog('none')}
        >
          <div
            className="w-full max-w-md animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 p-6 text-start shadow-pop"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-xl font-semibold text-slate-50">{DIALOG_COPY[dialog].title}</h2>
            <p className="mt-2 text-sm text-slate-400">{DIALOG_COPY[dialog].blurb}</p>

            <label
              htmlFor="server-input"
              className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-300"
            >
              {DIALOG_COPY[dialog].field}
            </label>
            <input
              id="server-input"
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
                if (event.key === 'Escape') setDialog('none');
              }}
              className="mt-2 w-full rounded-lg border border-edge bg-surface-950 px-3 py-2.5 text-slate-100 outline-none ring-0 transition-colors focus:border-accent/60"
              placeholder={DIALOG_COPY[dialog].placeholder}
            />

            {failure && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {failure}
              </p>
            )}

            <div className="-mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t border-edge bg-black/20 px-6 py-4">
              <button
                type="button"
                onClick={() => setDialog('none')}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !value.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Working...' : DIALOG_COPY[dialog].action}
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

/** A server's rail button, wherever it is drawn - loose or inside a folder. */
function ServerRailButton({
  server,
  active,
  badge,
  onClick,
  onContextMenu,
}: {
  server: ServerWithRole;
  active: boolean;
  badge: number;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}): JSX.Element {
  return (
    <RailButton
      label={server.name}
      active={active}
      badge={badge > 0 ? badge : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      activeClasses="bg-accent text-white shadow-lg shadow-accent/30 rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-surface-950"
      shape={active ? 'rounded-2xl' : 'rounded-full hover:rounded-2xl'}
    >
      <ServerIcon server={server} size="rail" />
    </RailButton>
  );
}

function RailButton({
  label,
  active,
  onClick,
  onContextMenu,
  children,
  activeClasses,
  idleTextClasses = 'text-slate-300',
  badge,
  expanded,
  shape = 'rounded-full',
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  activeClasses: string;
  idleTextClasses?: string;
  badge?: number | string;
  /** Set only on a button that opens something, which makes it a disclosure. */
  expanded?: boolean;
  shape?: string;
}): JSX.Element {
  return (
    <div className="group relative flex w-full justify-center my-0.5">
      {/* Active side indicator marker - pinned to the inline start edge, which
          is the left in English and the right in Arabic. */}
      <span
        aria-hidden="true"
        className={`absolute start-0 top-1/2 w-1.5 -translate-y-1/2 rounded-e-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)] transition-all duration-200 ease-out ${
          active
            ? 'h-8 opacity-100 scale-100'
            : 'h-2 opacity-0 scale-75 group-hover:h-4 group-hover:opacity-60 group-hover:scale-100'
        }`}
      />
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={label}
        aria-label={label}
        aria-expanded={expanded}
        aria-current={active ? 'true' : undefined}
        className={`relative flex h-11 w-11 cursor-pointer items-center justify-center transition-all duration-200 focus:outline-none active:scale-[0.96] ${shape} ${
          active
            ? activeClasses
            : `bg-surface-800/80 hover:bg-accent/20 hover:text-white ${idleTextClasses}`
        }`}
      >
        {children}
        {Boolean(badge) && (
          <span className="absolute -bottom-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-md ring-2 ring-surface-950">
            {badge}
          </span>
        )}
      </button>
    </div>
  );
}
