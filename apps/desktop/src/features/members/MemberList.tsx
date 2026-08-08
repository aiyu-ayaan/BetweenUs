import type { PresenceStatus, ServerMember, ServerRole } from '@nexora/shared-types';
import { useChatStore } from '../../stores/chat';
import { usePresenceStore } from '../../stores/presence';
import { Avatar } from '../../components/Avatar';

/**
 * The right-hand column in a server: who is here, online first. Members are
 * grouped by role the way Discord groups by hoisted role - a server this size
 * does not need a section per custom role, and there are no custom roles yet.
 */
export function MemberList(): JSX.Element {
  const members = useChatStore((state) => state.members);
  const online = usePresenceStore((state) => state.online);
  const statusOf = usePresenceStore((state) => state.statusOf);

  const here = members.filter((member) => online.has(member.userId));
  const away = members.filter((member) => !online.has(member.userId));

  const staff = here.filter((member) => isStaff(member.role));
  const rest = here.filter((member) => !isStaff(member.role));

  return (
    <aside
      aria-label="Members"
      className="hidden w-60 shrink-0 flex-col overflow-y-auto bg-surface-800 px-2 py-4 lg:flex"
    >
      <Group label={`Admins — ${staff.length}`} members={staff} statusOf={statusOf} />
      <Group label={`Online — ${rest.length}`} members={rest} statusOf={statusOf} />
      <Group label={`Offline — ${away.length}`} members={away} statusOf={statusOf} muted />
    </aside>
  );
}

function Group({
  label,
  members,
  statusOf,
  muted = false,
}: {
  label: string;
  members: ServerMember[];
  statusOf: (userId: string) => PresenceStatus;
  muted?: boolean;
}): JSX.Element | null {
  if (members.length === 0) return null;

  return (
    <>
      <p className="px-2 pb-1 pt-4 text-xs font-bold uppercase tracking-wide text-slate-400 first:pt-0">
        {label}
      </p>
      <ul>
        {members.map((member) => (
          <li key={member.userId}>
            <div
              className={`flex items-center gap-3 rounded px-2 py-1.5 transition-colors duration-200 hover:bg-surface-700/60 ${
                muted ? 'opacity-40' : ''
              }`}
            >
              <Avatar
                name={member.displayName}
                avatarUrl={member.avatarUrl}
                status={statusOf(member.userId)}
                size="sm"
                ringColour="border-surface-800"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-slate-200">
                  {member.displayName}
                </span>
                {isStaff(member.role) && (
                  <span className="block truncate text-xs text-slate-500">
                    {member.role.toLowerCase()}
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function isStaff(role: ServerRole): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MODERATOR';
}
