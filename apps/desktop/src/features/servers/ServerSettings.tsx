import { useEffect, useState } from 'react';
import type { Channel, ServerMember, ServerRole, UserSummary } from '@nexora/shared-types';
import { ASSIGNABLE_PERMISSIONS, PERMISSIONS, SERVER_ROLES } from '@nexora/permissions';
import { api } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { PicturePicker } from '../../components/PicturePicker';
import { ServerIcon } from '../../components/ServerIcon';
import { useChatStore } from '../../stores/chat';
import { Avatar } from '../../components/Avatar';
import {
  HashIcon,
  LockIcon,
  ShieldIcon,
  SpeakerIcon,
  TrashIcon,
  UsersIcon,
  XIcon,
} from '../../components/icons';

type Section = 'overview' | 'roles' | 'members' | 'channels' | 'invites';

const SECTIONS: Array<{ id: Section; label: string; icon: typeof UsersIcon }> = [
  { id: 'overview', label: 'Overview', icon: ShieldIcon },
  { id: 'roles', label: 'Roles & Permissions', icon: ShieldIcon },
  { id: 'members', label: 'Members', icon: UsersIcon },
  { id: 'channels', label: 'Channels', icon: HashIcon },
  { id: 'invites', label: 'Invites', icon: UsersIcon },
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
      className="fixed inset-0 z-50 flex animate-fade gap-1.5 bg-ground p-1.5"
    >
      <nav
        aria-label="Server settings sections"
        className="panel flex w-[232px] shrink-0 flex-col items-end overflow-y-auto bg-surface-800 py-8 pr-2"
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

      <div className="panel relative flex-1 overflow-y-auto bg-surface-900 px-10 py-10">
        <div className="max-w-[740px]">
          {section === 'overview' && <Overview />}
          {section === 'roles' && <Roles />}
          {section === 'members' && <Members />}
          {section === 'channels' && <Channels />}
          {section === 'invites' && <Invites />}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close server settings"
          className="absolute right-8 top-8 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-slate-500 text-slate-400 transition-colors duration-200 hover:bg-white/[0.07] hover:text-slate-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DangerButton(): JSX.Element {
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
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-left text-[15px] text-danger transition-colors duration-200 hover:bg-danger hover:text-white"
      >
        {label}
        <TrashIcon className="h-4 w-4" />
      </button>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setConfirming(false)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-lg bg-surface-800"
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

  const canManage = server?.permissions.includes(PERMISSIONS.MANAGE_SERVER) ?? false;

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
          className="mt-4 cursor-pointer rounded bg-accent px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:opacity-50"
        >
          Save changes
        </button>
      )}
      {note && <p className="mt-2 text-sm text-slate-300">{note}</p>}

      <dl className="mt-8 space-y-4 rounded-lg bg-surface-800 p-4">
        <div>
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Invite slug</dt>
          <dd className="mt-1 font-mono text-slate-100">{server?.slug}</dd>
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
 * Roles and permissions in one screen: pick a member, set their role, then
 * switch individual capabilities on or off over the top of it. The toggles show
 * three states, because "the role already gives this" and "granted to this one
 * person" are different facts and hiding the difference makes the screen lie.
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

      <div className="mt-6 flex gap-6">
        <ul className="w-56 shrink-0 space-y-0.5 rounded-lg bg-surface-800 p-2">
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
 * Adds someone straight from the members screen. It searches the directory the
 * friends screen searches - the same endpoint, because "find a person by name"
 * is one question - and adding is by username, which is what the server takes.
 */
function AddMember(): JSX.Element {
  const members = useChatStore((state) => state.members);
  const addMember = useChatStore((state) => state.addMember);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSummary[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      .searchUsers(value.trim())
      .then(setResults)
      .catch(() => setResults([]));
  };

  const add = async (username: string): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await addMember(username);
      setNote(`${username} is in the server.`);
      setQuery('');
      setResults([]);
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
        They join as a member. Give them a role afterwards on Roles &amp; Permissions.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => find(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && query.trim() && !busy) void add(query.trim());
          }}
          placeholder="Search by username"
          aria-label="Search for someone to add"
          className="w-full max-w-sm rounded-lg border border-edge bg-surface-950 px-3 py-2 text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-accent/60"
        />
        <button
          type="button"
          disabled={busy || query.trim().length < 2}
          onClick={() => void add(query.trim())}
          className="cursor-pointer rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-accent-hover disabled:opacity-40"
        >
          Add
        </button>
      </div>

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
    </>
  );
}

function Invites(): JSX.Element {
  const servers = useChatStore((state) => state.servers);
  const activeServerId = useChatStore((state) => state.activeServerId);
  const server = servers.find((item) => item.id === activeServerId);

  return (
    <>
      <h1 className="text-xl font-semibold text-slate-50">Invites</h1>
      <p className="mt-2 text-sm text-slate-400">
        Anyone with the slug can join. Invite codes that expire, and invites that can be revoked,
        are not built yet (development/TODO.md).
      </p>

      <div className="mt-5 rounded-lg bg-surface-800 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Invite slug</p>
        <p className="mt-2 select-all font-mono text-lg text-slate-100">{server?.slug}</p>
      </div>
    </>
  );
}
