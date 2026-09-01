import { serverNow } from '../../services/server-clock';
import { useEffect, useRef, useState } from 'react';
import type {
  Channel,
  ServerCustomRole,
  ServerEmoji,
  UpdateServerRoleRequest,
  ServerInvite,
  ServerMember,
  ServerRole,
  UserSummary,
} from '@betweenus/shared-types';
import { ASSIGNABLE_PERMISSIONS, PERMISSIONS, SERVER_ROLES } from '@betweenus/permissions';
import { EMOJI_NAME_PATTERN, MAX_SERVER_EMOJI } from '@betweenus/shared-types';
import { api } from '../../services/api';
import { preparePicture } from '../../services/attachments';
import {
  MAX_EMOJI_BYTES,
  addEmoji,
  emojiFor,
  isAnimatedType,
  loadEmoji,
  onEmojiChanged,
  removeEmoji,
} from '../../services/server-emoji';
import { absoluteUrl } from '../../services/endpoint';
import { inviteLink } from '../../services/invite-link';
import { serverUrl } from '../../services/endpoint';
import { syncChannelKeys } from '../../services/e2ee';
import { useAuthStore } from '../../stores/auth';
import { PicturePicker } from '../../components/PicturePicker';
import { DisappearingPicker } from '../../components/DisappearingPicker';
import { ServerIcon } from '../../components/ServerIcon';
import { useChatStore } from '../../stores/chat';
import { Avatar } from '../../components/Avatar';
import {
  BetweenUsLogoIcon,
  ChevronLeftIcon,
  HashIcon,
  LockIcon,
  ShieldIcon,
  SpeakerIcon,
  TrashIcon,
  UsersIcon,
  SmileIcon,
  XIcon,
} from '../../components/icons';

const isMac = typeof window !== 'undefined' && window.betweenus?.platform === 'darwin';

type Section = 'overview' | 'roles' | 'members' | 'channels' | 'invites' | 'emoji';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof UsersIcon }> = [
  { id: 'overview', label: 'Overview', icon: ShieldIcon },
  { id: 'roles', label: 'Roles & Permissions', icon: ShieldIcon },
  { id: 'members', label: 'Members', icon: UsersIcon },
  { id: 'channels', label: 'Channels', icon: HashIcon },
  { id: 'invites', label: 'Invites', icon: UsersIcon },
  { id: 'emoji', label: 'Emoji', icon: SmileIcon },
];

/**
 * Server settings, laid out like the user settings screen and scoped to one
 * community. There is no Events section and no Boost section: this product has
 * neither, and a settings page that lists things that do not exist is a lie.
 */
export function ServerSettings({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<Section>('overview');
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const server = servers.find((item) => item.id === activeServerId);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  // Leaving or deleting the server takes the settings screen with it.
  useEffect(() => {
    if (!server) onClose();
  }, [server, onClose]);

  if (!server) return <></>;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${server.name} settings`}
      className="fixed inset-0 z-50 flex flex-col animate-fade bg-ground"
    >
      {/* Mobile sticky top bar */}
      <div className="md:hidden flex h-12 shrink-0 items-center justify-between border-b border-edge bg-surface-850 px-3 z-10">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to server"
          className="flex min-h-[40px] items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/[0.07] hover:text-white"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          <span>Back</span>
        </button>
        <span className="font-semibold text-sm text-slate-100 truncate max-w-[160px]">{server.name}</span>
        <div className="flex items-center">
          <DangerButton compact />
        </div>
      </div>

      {/* Mobile horizontal section tabs */}
      <div
        role="tablist"
        aria-label="Server settings sections"
        className="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-edge bg-surface-800 px-3 py-2 shrink-0"
      >
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            onClick={() => setSection(entry.id)}
            aria-selected={section === entry.id}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-200 min-h-[36px] ${
              section === entry.id
                ? 'bg-accent text-white'
                : 'bg-surface-700/60 text-slate-300 hover:bg-white/[0.06]'
            }`}
          >
            <entry.icon className="h-3.5 w-3.5 shrink-0" />
            <span>{entry.label}</span>
          </button>
        ))}
      </div>

      {/* Desktop Top Bar / Window Controls Header */}
      <header className="drag-region hidden md:flex h-10 shrink-0 items-center justify-between px-2.5">
        <div className={`flex items-center gap-1.5 ${isMac ? 'pl-[72px]' : 'pl-1'}`}>
          <BetweenUsLogoIcon className="h-[18px] w-[18px] shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate text-[13px] font-semibold tracking-tight text-slate-300">
            BetweenUs
          </span>
          <span className="text-slate-600 text-xs">/</span>
          <span className="truncate max-w-[200px] text-[13px] font-medium text-slate-400">
            {server.name} Settings
          </span>
        </div>
        <div className={`hidden shrink-0 md:block ${isMac ? 'w-36' : 'w-[146px]'}`} />
      </header>

      {/* Main Settings Panels */}
      <div className="flex min-h-0 flex-1 gap-0 md:gap-1.5 p-0 md:px-1.5 md:pb-1.5">
        <nav
          aria-label="Server settings sections"
          className="panel hidden md:flex w-[232px] shrink-0 flex-col items-end overflow-y-auto bg-surface-800 py-8 pr-2"
        >
        <div className="w-[192px]">
          <p className="truncate px-2.5 pb-1 text-xs font-bold uppercase tracking-wide text-slate-400">
            {server.name}
          </p>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              aria-current={section === entry.id ? 'page' : undefined}
              className={`mt-0.5 flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-[15px] transition-colors duration-200 ${
                section === entry.id
                  ? 'row-active'
                  : 'text-slate-300 hover:bg-white/[0.05]'
              }`}
            >
              <entry.icon className="h-4 w-4 shrink-0" />
              {entry.label}
            </button>
          ))}

          <hr className="my-2 border-surface-700" />
          <DangerButton />
        </div>
      </nav>

      <div className="panel relative flex-1 overflow-y-auto bg-surface-900 px-4 py-6 md:px-10 md:py-10 rounded-none md:rounded-panel border-0 md:border border-edge">
        <div className="max-w-[740px]">
          {section === 'overview' && <Overview />}
          {section === 'roles' && <Roles />}
          {section === 'members' && <Members />}
          {section === 'channels' && <Channels />}
          {section === 'invites' && <Invites />}
          {section === 'emoji' && <EmojiSection />}
        </div>

        {/* Desktop Close ESC button */}
        <div className="fixed top-14 right-8 md:right-10 z-50 hidden md:block no-drag">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close server settings (Escape)"
            title="Close server settings (ESC)"
            className="group flex flex-col items-center gap-1 cursor-pointer select-none focus:outline-none"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-500 text-slate-400 transition-all duration-150 group-hover:border-slate-300 group-hover:bg-white/[0.08] group-hover:text-slate-100 active:scale-95">
              <XIcon className="h-4 w-4" />
            </div>
            <span className="text-[11px] font-bold tracking-wider text-slate-500 transition-colors duration-150 group-hover:text-slate-300">
              ESC
            </span>
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}

function DangerButton({ compact = false }: { compact?: boolean } = {}): JSX.Element {
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const deleteServer = useChatStore((state) => state.deleteServer);
  const leaveServer = useChatStore((state) => state.leaveServer);
  const server = servers.find((item) => item.id === activeServerId);
  const [confirming, setConfirming] = useState(false);

  const isOwner = server?.role === 'OWNER';
  const label = isOwner ? 'Delete server' : 'Leave server';

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={label}
          title={label}
          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md p-1.5 text-danger hover:bg-danger hover:text-white transition-colors duration-150"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-left text-[15px] text-danger transition-colors duration-200 hover:bg-danger hover:text-white"
        >
          {label}
          <TrashIcon className="h-4 w-4" />
        </button>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed inset-0 z-50 flex animate-fade items-center justify-center bg-black/60 px-4"
          onClick={() => setConfirming(false)}
        >
          <div
            className="w-full max-w-md animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 shadow-pop"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-6">
              <h2 className="text-xl font-bold text-slate-50">
                {label} &ldquo;{server?.name}&rdquo;
              </h2>
              <p className="mt-3 text-sm text-slate-300">
                {isOwner
                  ? 'Every channel and every message in them goes with it. This cannot be undone.'
                  : 'You will need a new invite to come back.'}
              </p>
            </div>
            <div className="flex justify-end gap-3 bg-surface-850 px-6 py-4">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="cursor-pointer px-4 py-2 text-sm text-slate-200 hover:underline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void (isOwner ? deleteServer() : leaveServer())}
                className="cursor-pointer rounded bg-danger px-6 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-danger-hover"
              >
                {label}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Overview(): JSX.Element {
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const saveServer = useChatStore((state) => state.saveServer);
  const server = servers.find((item) => item.id === activeServerId);

  const [name, setName] = useState(server?.name ?? '');
  const [note, setNote] = useState<string | null>(null);
  const [savingWindow, setSavingWindow] = useState(false);
  const [windowNote, setWindowNote] = useState<string | null>(null);

  const canManage = server?.permissions.includes(PERMISSIONS.MANAGE_SERVER) ?? false;

  /**
   * Changes the server's window.
   *
   * Nothing is pruned locally afterwards, unlike the personal one: this window
   * only governs messages sent from now on, so there is nothing already on
   * screen that this call has made too old.
   */
  const saveWindow = async (seconds: number | null): Promise<void> => {
    setSavingWindow(true);
    setWindowNote(null);
    try {
      await saveServer({ messageTtlSeconds: seconds });
      setWindowNote('Saved.');
    } catch (error) {
      setWindowNote(error instanceof Error ? error.message : 'That could not be saved');
    } finally {
      setSavingWindow(false);
    }
  };

  const save = async (): Promise<void> => {
    setNote(null);
    try {
      await saveServer({ name: name.trim() });
      setNote('Saved.');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That could not be saved');
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Server overview</h1>

      {canManage && (
        <div className="mt-6">
          <PicturePicker
            label="server icon"
            onChange={(iconUrl) => saveServer({ iconUrl })}
            onClear={server?.iconUrl ? () => saveServer({ iconUrl: null }) : undefined}
          >
            <ServerIcon server={server} size="lg" />
          </PicturePicker>
        </div>
      )}

      <label className="mt-6 block max-w-sm">
        <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
          Server name
        </span>
        <input
          value={name}
          disabled={!canManage}
          onChange={(event) => setName(event.target.value)}
          className="mt-2 w-full rounded-lg border border-edge bg-surface-950 px-3 py-2.5 text-slate-100 outline-none transition-colors focus:border-accent/60 disabled:opacity-50"
        />
      </label>

      {canManage && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={name.trim().length < 2 || name.trim() === server?.name}
          className="mt-4 cursor-pointer rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          Save changes
        </button>
      )}
      {note && <p className="mt-2 text-sm text-slate-300">{note}</p>}

      <section className="mt-8 border-t border-edge pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Disappearing messages
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          Messages sent in this server's channels are deleted once they reach this age - for
          everybody, along with any files they carried. This is a deletion and not a filter, which
          is why it outranks whatever window a member has set for themselves: they may choose to
          see less than the server keeps, never more.
        </p>
        <p className="mt-1.5 text-sm text-slate-500">
          Changing this governs what is sent from now on. Messages already in the channels keep
          the window they were sent under.
        </p>

        <DisappearingPicker
          value={server?.messageTtlSeconds ?? null}
          disabled={!canManage || savingWindow}
          onChange={(seconds) => void saveWindow(seconds)}
        />

        {!canManage && (
          <p className="mt-3 text-sm text-slate-500">
            Only someone who can manage this server may change it.
          </p>
        )}
        {windowNote && <p className="mt-3 text-sm text-slate-300">{windowNote}</p>}
      </section>

      <dl className="mt-8 space-y-4 rounded-lg bg-surface-800 p-4">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Address</dt>
          <dd className="mt-1 font-mono text-slate-100">{server?.slug}</dd>
          <dd className="mt-1 text-xs text-slate-500">
            A name, not a way in - see Invites for that.
          </dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Your role</dt>
          <dd className="mt-1 text-slate-100">{server?.role}</dd>
        </div>
      </dl>
    </>
  );
}

/**
 * Roles and permissions in one screen.
 *
 * Two halves, in the order they are decided. First the roles this server
 * invented for itself - a name, a colour, and the capabilities that come with
 * holding it. Then a member: which built-in rung they are on, which custom
 * roles they hold, and finally the per-person switches over the top of all of
 * it. The switches show three states, because "the role already gives this"
 * and "granted to this one person" are different facts and hiding the
 * difference makes the screen lie.
 */
function Roles(): JSX.Element {
  const members = useChatStore((state) => state.members);
  const updateMember = useChatStore((state) => state.updateMember);
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const me = useAuthStore((state) => state.user);
  const server = servers.find((item) => item.id === activeServerId);

  const editable = members.filter(
    (member) => member.role !== 'OWNER' && member.userId !== me?.id,
  );
  const [selectedId, setSelectedId] = useState<string | null>(editable[0]?.userId ?? null);
  const selected = members.find((member) => member.userId === selectedId) ?? editable[0];
  const [note, setNote] = useState<string | null>(null);

  const canManageRoles = server?.permissions.includes(PERMISSIONS.MANAGE_ROLE) ?? false;
  const canManageMembers = server?.permissions.includes(PERMISSIONS.MANAGE_MEMBER) ?? false;

  const [roles, setRoles] = useState<ServerCustomRole[]>([]);
  useEffect(() => {
    if (!activeServerId) return;
    let live = true;
    void api
      .serverRoles(activeServerId)
      .then((next) => {
        if (live) setRoles(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [activeServerId]);

  const apply = async (change: Parameters<typeof updateMember>[1]): Promise<void> => {
    if (!selected) return;
    setNote(null);
    try {
      await updateMember(selected.userId, change);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That change was refused');
    }
  };

  if (!selected) {
    return (
      <>
        <h1 className="text-xl font-semibold text-slate-50">Roles &amp; Permissions</h1>
        <p className="mt-3 text-slate-400">
          There is nobody to configure yet. Invite someone with the slug on the Overview page.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Roles &amp; Permissions</h1>
      <p className="mt-2 text-sm text-slate-400">
        A role sets the defaults. The switches below grant or withhold one capability for one
        person, without inventing a role for them.
      </p>

      <CustomRoles
        serverId={activeServerId}
        roles={roles}
        onChange={setRoles}
        canManage={canManageRoles}
      />

      <div className="mt-6 flex flex-col md:flex-row gap-4 md:gap-6">
        <ul className="w-full md:w-56 shrink-0 flex md:flex-col overflow-x-auto md:overflow-y-auto no-scrollbar gap-1 rounded-lg bg-surface-800 p-2">
          {editable.map((member) => (
            <li key={member.userId}>
              <button
                type="button"
                onClick={() => setSelectedId(member.userId)}
                aria-current={member.userId === selected.userId ? 'true' : undefined}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-200 ${
                  member.userId === selected.userId
                    ? 'row-active'
                    : 'text-slate-300 hover:bg-white/[0.05]'
                }`}
              >
                <Avatar
                  name={member.displayName}
                  avatarUrl={member.avatarUrl}
                  size="sm"
                  ringColour="border-surface-800"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{member.displayName}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {member.role.toLowerCase()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="min-w-0 flex-1">
          <label className="block max-w-xs">
            <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
              Role
            </span>
            <select
              value={selected.role}
              disabled={!canManageRoles}
              onChange={(event) => void apply({ role: event.target.value as ServerRole })}
              className="mt-2 w-full cursor-pointer rounded-lg border border-edge bg-surface-950 px-3 py-2.5 text-slate-100 outline-none transition-colors focus:border-accent/60 disabled:opacity-50"
            >
              {SERVER_ROLES.filter((role) => role !== 'OWNER').map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          {roles.length > 0 && (
            <>
              <p className="mt-6 text-xs font-bold uppercase tracking-wide text-slate-400">
                Roles
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {roles.map((role) => {
                  const held = selected.roleIds.includes(role.id);
                  return (
                    <li key={role.id}>
                      <button
                        type="button"
                        disabled={!canManageRoles}
                        aria-pressed={held}
                        onClick={() =>
                          void apply({
                            roleIds: held
                              ? selected.roleIds.filter((id) => id !== role.id)
                              : [...selected.roleIds, role.id],
                          })
                        }
                        className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                          held
                            ? 'border-accent bg-accent/15 text-slate-100'
                            : 'border-edge bg-surface-950 text-slate-400 hover:bg-white/[0.06]'
                        }`}
                      >
                        <RoleDot colour={role.colour} />
                        {role.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <p className="mt-6 text-xs font-bold uppercase tracking-wide text-slate-400">
            Permissions
          </p>
          <ul className="mt-2 divide-y divide-surface-700/60 rounded-lg bg-surface-800">
            {ASSIGNABLE_PERMISSIONS.map((permission) => (
              <PermissionRow
                key={permission}
                permission={permission}
                member={selected}
                disabled={!canManageMembers}
                onChange={apply}
              />
            ))}
          </ul>

          {note && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {note}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/** The colour a role is drawn in, or the default when it has none. */
function RoleDot({ colour }: { colour: string | null }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: colour ?? '#8b98a5' }}
    />
  );
}

/**
 * The roles a server invented for itself.
 *
 * Additive, and deliberately not a second hierarchy: a custom role carries
 * capabilities and a colour, and it is the built-in rung - OWNER through GUEST -
 * that still decides who may edit whom. `rank` only orders the list and chooses
 * whose colour a member wears.
 *
 * Everything saves as it is changed, like the rest of this screen. The name and
 * the rank are the exceptions and save on blur, because writing a name per
 * keystroke would create a role called "M" on the way to "Moderator".
 */
function CustomRoles({
  serverId,
  roles,
  onChange,
  canManage,
}: {
  serverId: string | null;
  roles: ServerCustomRole[];
  onChange: (roles: ServerCustomRole[]) => void;
  canManage: boolean;
}): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const selected = roles.find((role) => role.id === selectedId) ?? null;

  const save = async (change: UpdateServerRoleRequest): Promise<void> => {
    if (!serverId || !selected) return;
    setNote(null);
    try {
      const updated = await api.updateServerRole(serverId, selected.id, change);
      onChange(roles.map((role) => (role.id === updated.id ? updated : role)));
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That change was refused');
    }
  };

  const create = async (): Promise<void> => {
    if (!serverId || name.trim().length === 0) return;
    setNote(null);
    try {
      const role = await api.createServerRole(serverId, { name: name.trim() });
      onChange([...roles, role]);
      setSelectedId(role.id);
      setName('');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That role could not be created');
    }
  };

  const remove = async (): Promise<void> => {
    if (!serverId || !selected) return;
    setNote(null);
    try {
      await api.deleteServerRole(serverId, selected.id);
      onChange(roles.filter((role) => role.id !== selected.id));
      setSelectedId(null);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That role could not be deleted');
    }
  };

  return (
    <section className="mt-6 rounded-lg bg-surface-800 p-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">
        Roles this server invented
      </h2>

      {roles.length === 0 && (
        <p className="mt-2 text-sm text-slate-400">
          None yet. A role is a bundle of capabilities with a name and a colour, handed to as many
          people as you like.
        </p>
      )}

      <ul className="mt-3 flex flex-wrap gap-2">
        {roles.map((role) => (
          <li key={role.id}>
            <button
              type="button"
              onClick={() => setSelectedId(role.id === selectedId ? null : role.id)}
              aria-pressed={role.id === selectedId}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors duration-200 ${
                role.id === selectedId
                  ? 'border-accent bg-accent/15 text-slate-100'
                  : 'border-edge bg-surface-950 text-slate-300 hover:bg-white/[0.06]'
              }`}
            >
              <RoleDot colour={role.colour} />
              {role.name}
              <span className="text-xs text-slate-500">{role.memberCount}</span>
            </button>
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            placeholder="New role name"
            aria-label="New role name"
            className="w-56 rounded-lg border border-edge bg-surface-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-accent/60"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={name.trim().length === 0}
            className="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
          >
            Create
          </button>
        </div>
      )}

      {selected && (
        <div className="mt-4 rounded-lg bg-surface-950 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
                Name
              </span>
              <input
                key={selected.id}
                defaultValue={selected.name}
                disabled={!canManage}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next && next !== selected.name) void save({ name: next });
                }}
                className="mt-2 w-56 rounded-lg border border-edge bg-surface-900 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-accent/60 disabled:opacity-50"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
                Colour
              </span>
              <input
                type="color"
                value={selected.colour ?? '#8b98a5'}
                disabled={!canManage}
                onChange={(event) => void save({ colour: event.target.value })}
                className="mt-2 h-9 w-16 cursor-pointer rounded border border-edge bg-surface-900 disabled:opacity-50"
              />
            </label>

            <label className="block">
              <span className="block text-xs font-bold uppercase tracking-wide text-slate-400">
                Rank
              </span>
              <input
                key={`${selected.id}-rank`}
                type="number"
                defaultValue={selected.rank}
                disabled={!canManage}
                onBlur={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next !== selected.rank) void save({ rank: next });
                }}
                className="mt-2 w-24 rounded-lg border border-edge bg-surface-900 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-accent/60 disabled:opacity-50"
              />
            </label>

            {canManage && (
              <button
                type="button"
                onClick={() => void remove()}
                className="ml-auto cursor-pointer rounded border border-danger px-3 py-1.5 text-sm text-danger transition-colors duration-200 hover:bg-danger hover:text-white"
              >
                Delete role
              </button>
            )}
          </div>

          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">
            What holding it allows
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {ASSIGNABLE_PERMISSIONS.map((permission) => {
              const on = selected.permissions.includes(permission);
              return (
                <li key={permission}>
                  <button
                    type="button"
                    disabled={!canManage}
                    aria-pressed={on}
                    onClick={() =>
                      void save({
                        permissions: on
                          ? selected.permissions.filter((value) => value !== permission)
                          : [...selected.permissions, permission],
                      })
                    }
                    className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                      on
                        ? 'bg-status-online text-white'
                        : 'bg-surface-800 text-slate-400 hover:bg-white/[0.06]'
                    }`}
                  >
                    {PERMISSION_LABELS[permission] ?? permission}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            A capability you do not hold yourself cannot be put into a role - that would be granting
            it to yourself with one extra step.
          </p>
        </div>
      )}

      {note && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {note}
        </p>
      )}
    </section>
  );
}

const PERMISSION_LABELS: Record<string, string> = {
  VIEW_CHANNEL: 'View channels',
  SEND_MESSAGE: 'Send messages',
  DELETE_MESSAGE: 'Delete anyone’s messages',
  MANAGE_MESSAGE: 'Pin and unpin messages',
  MANAGE_CHANNEL: 'Create and manage channels',
  MANAGE_MEMBER: 'Manage members',
  MANAGE_ROLE: 'Assign roles',
  START_CALL: 'Join voice channels',
  MANAGE_CALL: 'Moderate calls',
};

function PermissionRow({
  permission,
  member,
  disabled,
  onChange,
}: {
  permission: string;
  member: ServerMember;
  disabled: boolean;
  onChange: (change: {
    grantedPermissions?: string[];
    deniedPermissions?: string[];
  }) => Promise<void>;
}): JSX.Element {
  const granted = member.grantedPermissions.includes(permission);
  const denied = member.deniedPermissions.includes(permission);
  const effective = member.permissions.includes(permission);

  const set = (next: 'allow' | 'deny' | 'inherit'): void => {
    const grants = member.grantedPermissions.filter((value) => value !== permission);
    const denials = member.deniedPermissions.filter((value) => value !== permission);
    void onChange({
      grantedPermissions: next === 'allow' ? [...grants, permission] : grants,
      deniedPermissions: next === 'deny' ? [...denials, permission] : denials,
    });
  };

  const state = granted ? 'allow' : denied ? 'deny' : 'inherit';

  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] text-slate-100">
          {PERMISSION_LABELS[permission] ?? permission}
        </span>
        <span className="block text-xs text-slate-500">
          {effective ? 'Allowed' : 'Not allowed'} · from{' '}
          {state === 'inherit' ? 'the role' : state === 'allow' ? 'a grant' : 'a denial'}
        </span>
      </span>

      <div className="flex shrink-0 gap-1" role="group" aria-label={permission}>
        {(['deny', 'inherit', 'allow'] as const).map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={state === option}
            onClick={() => set(option)}
            className={`cursor-pointer rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
              state === option
                ? option === 'allow'
                  ? 'bg-status-online text-white'
                  : option === 'deny'
                    ? 'bg-danger text-white'
                    : 'bg-surface-600 text-slate-100'
                : 'bg-surface-950 text-slate-400 hover:bg-white/[0.06]'
            }`}
          >
            {option === 'inherit' ? 'Role' : option}
          </button>
        ))}
      </div>
    </li>
  );
}

function Members(): JSX.Element {
  const members = useChatStore((state) => state.members);
  const kickMember = useChatStore((state) => state.kickMember);
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const me = useAuthStore((state) => state.user);
  const server = servers.find((item) => item.id === activeServerId);

  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const canManage = server?.permissions.includes(PERMISSIONS.MANAGE_MEMBER) ?? false;
  const shown = members.filter((member) =>
    `${member.displayName} ${member.username}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const kick = async (userId: string): Promise<void> => {
    setNote(null);
    try {
      await kickMember(userId);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That member could not be removed');
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Members — {members.length}</h1>

      {canManage && <AddMember />}

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search members"
        aria-label="Search members"
        className="mt-4 w-full max-w-sm rounded-lg border border-edge bg-surface-950 px-3 py-2 text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-accent/60"
      />

      {note && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {note}
        </p>
      )}

      <ul className="mt-4 divide-y divide-surface-700/60 rounded-lg bg-surface-800">
        {shown.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
            <Avatar
              name={member.displayName}
              avatarUrl={member.avatarUrl}
              ringColour="border-surface-800"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-100">
                {member.displayName}
              </span>
              <span className="block truncate text-sm text-slate-400">
                @{member.username} · {member.role.toLowerCase()}
              </span>
            </span>
            {canManage && member.role !== 'OWNER' && member.userId !== me?.id && (
              <button
                type="button"
                onClick={() => void kick(member.userId)}
                className="cursor-pointer rounded border border-danger px-3 py-1.5 text-sm text-danger transition-colors duration-200 hover:bg-danger hover:text-white"
              >
                Kick
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Adds someone straight from the members screen.
 *
 * Friends only, and that is not a nicety: `server-service` refuses to add
 * anybody else, because being able to manage members is permission to bring in
 * your people rather than permission to conscript the directory. This searched
 * the whole of it and offered every stranger in it - each of which was a
 * refusal waiting to be clicked, and before the refusal existed, an account
 * dropped into a server it had never heard of.
 *
 * Letting a stranger in is what an invite link is for: they follow it and
 * choose to join.
 */
function AddMember(): JSX.Element {
  const members = useChatStore((state) => state.members);
  const addMember = useChatStore((state) => state.addMember);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Whether they arrive able to read what was said before they got here.
   *
   * Off, and it stays off between adds: this is a decision about one person,
   * and a switch that remembered "yes" from the last one would hand the next
   * newcomer a year of a conversation because of a click somebody made about
   * somebody else.
   */
  const [shareHistory, setShareHistory] = useState(false);

  // Anyone already in the server is dropped from the results: offering to add
  // them again is an invitation to a confusing no-op.
  const candidates = results.filter(
    (person) => !members.some((member) => member.userId === person.id),
  );

  const find = (value: string): void => {
    setQuery(value);
    setNote(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    void api
      .searchUsers(value.trim(), true)
      .then(setResults)
      .catch(() => setResults([]));
  };

  const add = async (username: string): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await addMember(username, shareHistory);
      setNote(
        shareHistory
          ? `${username} is in the server, and the history will open for them as soon as one of the machines holding it opens each channel.`
          : `${username} is in the server. They can read from now on.`,
      );
      setQuery('');
      setResults([]);
      setShareHistory(false);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That person could not be added');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-5 rounded-lg bg-surface-800 p-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">Add a member</h2>
      <p className="mt-1 text-sm text-slate-400">
        Your friends only - adding somebody puts them in the server without asking them, so it is
        not a thing to do to a stranger. For anybody else, share an invite link and let them
        choose to join.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => find(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && query.trim() && !busy) void add(query.trim());
          }}
          placeholder="Search your friends"
          aria-label="Search your friends for someone to add"
          className="w-full max-w-sm rounded-lg border border-edge bg-surface-950 px-3 py-2 text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-accent/60"
        />
        <button
          type="button"
          disabled={busy || query.trim().length < 2}
          onClick={() => void add(query.trim())}
          className="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <label className="mt-3 flex max-w-xl cursor-pointer items-start gap-2.5 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={shareHistory}
          onChange={(event) => setShareHistory(event.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
        />
        <span>
          Let them read the history
          <span className="mt-0.5 block text-xs text-slate-400">
            Off by default: a new member reads from the moment they join. Turning it on hands
            them the keys to what was said before - not instantly, but as soon as one of the
            machines that already holds those keys opens each channel.
          </span>
        </span>
      </label>

      {note && (
        <p role="status" className="mt-2 text-sm text-slate-300">
          {note}
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="mt-3 divide-y divide-surface-700/60 rounded bg-surface-850">
          {candidates.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar
                name={person.displayName}
                avatarUrl={person.avatarUrl}
                size="sm"
                ringColour="border-surface-850"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">{person.displayName}</span>
                <span className="block truncate text-xs text-slate-500">@{person.username}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void add(person.username)}
                className="cursor-pointer rounded border border-accent px-3 py-1 text-sm text-accent transition-colors duration-200 hover:bg-accent hover:text-white disabled:opacity-40"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Channels(): JSX.Element {
  const channels = useChatStore((state) => state.channels);
  const deleteChannel = useChatStore((state) => state.deleteChannel);
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const server = servers.find((item) => item.id === activeServerId);

  const canManage = server?.permissions.includes(PERMISSIONS.MANAGE_CHANNEL) ?? false;
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<Channel | null>(null);

  const remove = async (channel: Channel): Promise<void> => {
    setNote(null);
    try {
      await deleteChannel(channel.id);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That channel could not be deleted');
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Channels — {channels.length}</h1>
      <p className="mt-2 text-sm text-slate-400">
        A private channel is only listed here for people who are on it, this screen included.
      </p>

      {note && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {note}
        </p>
      )}

      <ul className="mt-4 divide-y divide-surface-700/60 rounded-lg bg-surface-800">
        {channels.map((channel) => (
          <li key={channel.id} className="flex items-center gap-3 px-4 py-3">
            {channel.type === 'VOICE' ? (
              <SpeakerIcon className="h-5 w-5 shrink-0 text-slate-400" />
            ) : (
              <HashIcon className="h-5 w-5 shrink-0 text-slate-400" />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-slate-100">
                {channel.name}
                {channel.isPrivate && <LockIcon className="h-3.5 w-3.5 text-slate-400" />}
              </span>
              <span className="block text-xs text-slate-500">
                {channel.isPrivate ? 'Private' : 'Open to the server'}
              </span>
            </span>
            {canManage && channel.isPrivate && (
              <button
                type="button"
                onClick={() => setEditing(channel)}
                className="cursor-pointer rounded bg-white/[0.07] px-3 py-1.5 text-sm text-slate-100 transition-colors duration-200 hover:bg-white/[0.1]"
              >
                Who is on it
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => void remove(channel)}
                aria-label={`Delete ${channel.name}`}
                className="cursor-pointer rounded p-2 text-slate-400 transition-colors duration-200 hover:bg-danger hover:text-white"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {editing && <ChannelAccess channel={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/**
 * Who may see a private channel.
 *
 * The endpoint has always existed and only the create dialog used it, so a
 * private channel's allowlist was decided once and never again - somebody left
 * off it stayed off it, and somebody who should not have been on it stayed on.
 *
 * Removing somebody takes the future away as well as the listing: the channel's
 * key rotates the next time a holder syncs it, so what is sent after this is
 * sealed with a key they do not have. What they already downloaded is theirs
 * and no design takes that back.
 */
function ChannelAccess({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}): JSX.Element {
  const members = useChatStore((state) => state.members);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .channelMembers(channel.id)
      .then((rows) => {
        if (live) setAllowed(rows.map((row) => row.userId));
      })
      .catch((error: unknown) =>
        setNote(error instanceof Error ? error.message : 'Could not read who is on it'),
      );
    return () => {
      live = false;
    };
  }, [channel.id]);

  const toggle = (userId: string): void =>
    setAllowed((current) =>
      current === null
        ? current
        : current.includes(userId)
          ? current.filter((id) => id !== userId)
          : [...current, userId],
    );

  const save = async (): Promise<void> => {
    if (allowed === null) return;
    setBusy(true);
    setNote(null);
    try {
      await api.setChannelMembers(channel.id, allowed);
      // Re-key now rather than whenever somebody next opens the channel. This
      // client is a holder - it is in the channel - and the person who just
      // removed somebody is the person least willing to wait for it.
      await syncChannelKeys(channel.id).catch(() => undefined);
      onClose();
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That could not be saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Who is on ${channel.name}`}
      className="fixed inset-0 z-[60] flex animate-fade items-center justify-center bg-black/70 px-4"
    >
      <div className="w-full max-w-md animate-pop rounded-xl border border-edge bg-surface-900 p-6 shadow-pop">
        <h2 className="text-lg font-semibold text-slate-50">Who is on #{channel.name}</h2>
        <p className="mt-2 text-sm text-slate-400">
          Only these people see the channel at all. Taking somebody off re-keys it, so what is
          said afterwards is sealed with a key they do not have - what they already read stays
          read.
        </p>

        {note && <p className="mt-3 text-sm text-danger">{note}</p>}

        {allowed === null ? (
          <p className="mt-4 text-sm text-slate-400">Reading the list…</p>
        ) : (
          <ul className="mt-4 max-h-[320px] space-y-1 overflow-y-auto">
            {members.map((member) => (
              <li key={member.userId}>
                <label className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-white/[0.05]">
                  <input
                    type="checkbox"
                    checked={allowed.includes(member.userId)}
                    onChange={() => toggle(member.userId)}
                    className="h-4 w-4 cursor-pointer accent-accent"
                  />
                  <span className="truncate text-slate-100">{member.displayName}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-500">{member.role}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-md bg-white/[0.07] px-4 py-2.5 font-medium text-slate-100 transition-colors duration-150 hover:bg-white/[0.12]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || allowed === null}
            className="flex-1 cursor-pointer rounded-md bg-accent px-4 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Invites(): JSX.Element {
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const server = servers.find((item) => item.id === activeServerId);

  const [invites, setInvites] = useState<ServerInvite[]>([]);
  const [expiresInHours, setExpiresInHours] = useState<number | null>(24);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!server) return;
    let live = true;
    void api
      .serverInvites(server.id)
      .then((rows) => {
        if (live) setInvites(rows);
      })
      .catch((error: unknown) =>
        setFailure(error instanceof Error ? error.message : 'Could not read the invites'),
      );
    return () => {
      live = false;
    };
  }, [server?.id]);

  if (!server) return <></>;

  const create = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const invite = await api.createServerInvite(server.id, { expiresInHours, maxUses });
      setInvites((current) => [invite, ...current]);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not make an invite');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (code: string): Promise<void> => {
    try {
      const invite = await api.revokeServerInvite(server.id, code);
      setInvites((current) => current.map((row) => (row.code === code ? invite : row)));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not revoke it');
    }
  };

  /**
   * Copies the link rather than the code by default.
   *
   * A code is eight characters that look like a typo when they arrive in
   * somebody's chat, and it does not say which deployment it belongs to - two
   * BetweenUs servers can both have `k3m9x2qp` and neither is wrong. The code
   * itself is still one click away for anywhere a link will not travel.
   */
  const copy = (code: string, what: 'link' | 'code'): void => {
    const text = what === 'link' ? inviteLink(serverUrl(), code) : code;
    void navigator.clipboard?.writeText(text).then(() => {
      const mark = `${code}:${what}`;
      setCopied(mark);
      window.setTimeout(() => setCopied((current) => (current === mark ? null : current)), 2000);
    });
  };

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Invites</h1>
      <p className="mt-2 text-sm text-slate-400">
        An invite is how somebody gets in - anybody, friend or not: they follow the link and
        choose to join, which is why adding a stranger from the members screen is refused and
        this is not. Each one can expire, can be limited to a number of people, and can be taken
        back - which is what the server&apos;s name never could be.
      </p>

      <div className="mt-5 rounded-lg bg-surface-800 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm text-slate-300">
            Expires after
            <select
              value={expiresInHours ?? 'never'}
              onChange={(event) =>
                setExpiresInHours(
                  event.target.value === 'never' ? null : Number(event.target.value),
                )
              }
              className="mt-1 block cursor-pointer rounded-md bg-surface-900 px-3 py-2 text-slate-100"
            >
              <option value={1}>1 hour</option>
              <option value={24}>1 day</option>
              <option value={24 * 7}>7 days</option>
              <option value={24 * 30}>30 days</option>
              <option value="never">Never</option>
            </select>
          </label>

          <label className="text-sm text-slate-300">
            Number of uses
            <select
              value={maxUses ?? 'any'}
              onChange={(event) =>
                setMaxUses(event.target.value === 'any' ? null : Number(event.target.value))
              }
              className="mt-1 block cursor-pointer rounded-md bg-surface-900 px-3 py-2 text-slate-100"
            >
              <option value={1}>1</option>
              <option value={5}>5</option>
              <option value={25}>25</option>
              <option value={100}>100</option>
              <option value="any">Any number</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Making…' : 'New invite'}
          </button>
        </div>
      </div>

      {failure && <p className="mt-3 text-sm text-danger">{failure}</p>}

      {invites.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">
          No invites yet. Nobody can join until there is one.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-surface-700 rounded-lg bg-surface-800">
          {invites.map((invite) => (
            <li key={invite.code} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p
                  className={`select-all font-mono text-sm ${
                    invite.active ? 'text-slate-100' : 'text-slate-500 line-through'
                  }`}
                >
                  {invite.code}
                </p>
                <p className="mt-1 text-xs text-slate-400">{describeInvite(invite)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => copy(invite.code, 'link')}
                  title={inviteLink(serverUrl(), invite.code)}
                  className="cursor-pointer rounded bg-white/[0.07] px-3 py-1.5 text-sm text-slate-100 transition-colors duration-200 hover:bg-white/[0.1]"
                >
                  {copied === `${invite.code}:link` ? 'Copied' : 'Copy link'}
                </button>
                <button
                  type="button"
                  onClick={() => copy(invite.code, 'code')}
                  title="The code on its own, for anywhere a link will not travel"
                  className="cursor-pointer rounded bg-white/[0.07] px-3 py-1.5 text-sm text-slate-300 transition-colors duration-200 hover:bg-white/[0.1]"
                >
                  {copied === `${invite.code}:code` ? 'Copied' : 'Code'}
                </button>
                {invite.active && (
                  <button
                    type="button"
                    onClick={() => void revoke(invite.code)}
                    className="cursor-pointer rounded bg-white/[0.07] px-3 py-1.5 text-sm text-danger transition-colors duration-200 hover:bg-white/[0.1]"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One line saying what is left of an invite, or what happened to it. */
function describeInvite(invite: ServerInvite): string {
  if (invite.revokedAt) return 'Revoked';
  // The server's clock, not this machine's: the deployment is what refuses an
  // expired invite, so the label must agree with it rather than with a laptop
  // whose clock is out. See services/server-clock.ts.
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= serverNow()) return 'Expired';
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return 'All uses spent';

  const used =
    invite.maxUses === null
      ? `${invite.uses} used`
      : `${invite.uses} of ${invite.maxUses} used`;
  const until = invite.expiresAt
    ? `expires ${new Date(invite.expiresAt).toLocaleString()}`
    : 'never expires';
  return `${used}, ${until}`;
}

/**
 * A server's own emoji: upload a picture, give it a name, type `:name:`.
 *
 * The picture goes through the ordinary picture route, which is where the image
 * allowlist and the size cap already live. Two things it does *not* do to an
 * animated file, and both matter: it does not re-encode it, because that is how
 * an animated GIF becomes a still frame, and it does not square it off in a
 * canvas for the same reason. A still picture is downscaled, since a 4000px PNG
 * drawn at 22 is bytes nobody asked for.
 */
function EmojiSection(): JSX.Element {
  const server = useChatStore((state) => state.servers.find((item) => item.id === state.activeServerId));
  const mayManage = server?.permissions.includes(PERMISSIONS.MANAGE_EMOJI) ?? false;

  const [emoji, setEmoji] = useState<ServerEmoji[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!server) return;
    void loadEmoji(server.id).then(() => setEmoji(emojiFor(server.id)));
    return onEmojiChanged(() => setEmoji(emojiFor(server.id)));
  }, [server?.id]);

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file || !server) return;
    setBusy(true);
    setNote(null);
    try {
      const suggested = name.trim() || fileStem(file.name);
      if (!EMOJI_NAME_PATTERN.test(suggested)) {
        throw new Error('A name is two to thirty-two lowercase letters, digits or underscores');
      }

      const animated = isAnimatedType(file.type);
      // Animated files are uploaded exactly as they are - re-encoding one
      // through a canvas keeps the first frame and throws the rest away, which
      // is the whole of what people are asking for when they ask for this.
      const picture = animated ? file : await preparePicture(file);
      if (picture.size > MAX_EMOJI_BYTES) {
        throw new Error(
          `That is ${Math.round(picture.size / 1024)} KB. An emoji has to be under ` +
            `${Math.round(MAX_EMOJI_BYTES / 1024)} KB - it is drawn at 22 pixels.`,
        );
      }

      const stored = await api.uploadPicture(picture, file.name);
      await addEmoji(server.id, suggested, stored.url, animated);
      setName('');
      setNote(`:${suggested}: is ready to type.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That could not be uploaded');
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  };

  if (!server) return <p className="text-sm text-slate-400">No server open.</p>;

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Emoji</h1>
      <p className="mt-2 text-sm text-slate-400">
        Pictures this server can type by name. A GIF or an animated WebP stays animated - it is
        stored exactly as uploaded. They are public, like avatars: an emoji is drawn by an image
        tag a hundred times a screen, and an image tag cannot carry a password.
      </p>

      {mayManage ? (
        <div className="mt-5 space-y-3 rounded-lg bg-surface-800 p-4">
          <label className="block text-sm text-slate-300">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value.toLowerCase())}
              placeholder="party_parrot"
              className="mt-1 block w-full max-w-xs rounded-md border border-edge bg-surface-950 px-3 py-2 text-slate-100 placeholder-slate-500 outline-none focus:border-accent/60"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Two to thirty-two lowercase letters, digits or underscores. Left empty, the file
              name is used.
            </span>
          </label>

          <input
            ref={picker}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            disabled={busy || emoji.length >= MAX_SERVER_EMOJI}
            onClick={() => picker.current?.click()}
            className="cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Uploading…' : 'Upload a picture'}
          </button>
          <p className="text-xs text-slate-500">
            {emoji.length} of {MAX_SERVER_EMOJI} used · under {Math.round(MAX_EMOJI_BYTES / 1024)} KB
            each
          </p>
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-400">
          You can use these; adding one needs the “Manage emoji” permission.
        </p>
      )}

      {note && <p className="mt-3 text-sm text-slate-300">{note}</p>}

      {emoji.length === 0 ? (
        <p className="mt-5 text-sm text-slate-400">None yet.</p>
      ) : (
        <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {emoji.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg bg-surface-800 px-3 py-2"
            >
              <img
                src={absoluteUrl(item.url)}
                alt={`:${item.name}:`}
                className="h-8 w-8 shrink-0 object-contain"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-100">:{item.name}:</span>
                {item.animated && <span className="block text-xs text-slate-500">animated</span>}
              </span>
              {mayManage && (
                <button
                  type="button"
                  aria-label={`Remove :${item.name}:`}
                  title="Remove. Messages that used it keep their picture."
                  onClick={() => {
                    void removeEmoji(server.id, item.id).catch(() =>
                      setNote('That could not be removed'),
                    );
                  }}
                  className="cursor-pointer rounded p-1 text-slate-500 transition-colors duration-150 hover:text-danger"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A file name with its extension and anything unusable taken off. */
function fileStem(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}
