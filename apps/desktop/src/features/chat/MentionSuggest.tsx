/**
 * The `@` mention suggestion menu: type `@` and choose a member or broadcast.
 *
 * Like `EmojiSuggest.tsx`, this renders above the composer rather than at the caret,
 * avoiding caret measurement bugs while remaining right next to where the user is typing.
 *
 * In server channels, `@everyone` and `@here` broadcasts are offered at the top,
 * then the server's custom roles, then its members. In direct channels (DM),
 * broadcasts and roles are both suppressed - a conversation has neither.
 */
import { useEffect, useRef, useState } from 'react';
import type { ServerCustomRole, ServerMember } from '@betweenus/shared-types';
import { PersonAvatar } from '../../components/Avatar';
import { UsersIcon } from '../../components/icons';

export interface MentionOption {
  kind: 'broadcast' | 'role' | 'member';
  id: string;
  name: string;
  subtitle: string;
  /**
   * What is written into the composer after the `@`.
   *
   * For a role this is its name, spaces and all - the wire format is the text
   * somebody typed, and `mentionsMe` matches a role name exactly as it matches
   * a display name. It is deliberately not an id: an id in the body would be
   * unreadable on any client that had not yet fetched the roles, and a message
   * whose meaning depends on a second fetch is one that reads as gibberish
   * offline.
   */
  username: string;
  member?: ServerMember;
  /** The role's own colour, for the dot beside its name. Null uses the default. */
  colour?: string | null;
}

const BROADCASTS: MentionOption[] = [
  {
    kind: 'broadcast',
    id: 'everyone',
    name: '@everyone',
    subtitle: 'Notify everyone in this channel',
    username: 'everyone',
  },
  {
    kind: 'broadcast',
    id: 'here',
    name: '@here',
    subtitle: 'Notify active members in this channel',
    username: 'here',
  },
];

/**
 * Computes rank for member sorting:
 * 0: Exact match on username or displayName
 * 1: Prefix match on username or displayName
 * 2: Substring match on username or displayName
 */
function rankMember(option: MentionOption, needle: string): number {
  if (!needle) return 0;
  const user = option.username.toLowerCase();
  const name = option.name.toLowerCase();

  if (user === needle || name === needle) {
    return 0;
  }
  if (user.startsWith(needle) || name.startsWith(needle)) {
    return 1;
  }
  return 2;
}

/**
 * Filters and ranks mention options according to the query term.
 *
 * Broadcast options (`@everyone`, `@here`) and roles are included only in
 * non-direct channels - a conversation has neither. Member options are matched
 * against username and display name, ranked by exact match, prefix match, then
 * substring match, and sorted alphabetically within the same tier. Roles sit
 * between the two: above members because a role is the rarer, more deliberate
 * choice and typing four letters should not bury it under everybody whose name
 * contains them. Results are capped at 10 items.
 */
export function filterMentionOptions(
  term: string,
  members: readonly ServerMember[],
  isDirect: boolean,
  roles: readonly ServerCustomRole[] = [],
): MentionOption[] {
  const needle = term.trim().toLowerCase().replace(/^@+/, '');

  const matchingBroadcasts = isDirect
    ? []
    : BROADCASTS.filter(
        (b) =>
          b.username.toLowerCase().includes(needle) ||
          b.name.toLowerCase().includes(needle),
      );

  const roleOptions: MentionOption[] = isDirect
    ? []
    : roles.map((role) => ({
        kind: 'role' as const,
        id: role.id,
        name: role.name,
        subtitle:
          role.memberCount === 1 ? 'Role · 1 member' : `Role · ${role.memberCount} members`,
        username: role.name,
        colour: role.colour,
      }));

  const matchingRoles = roleOptions
    .filter((role) => role.name.toLowerCase().includes(needle))
    .sort((a, b) => {
      const aRank = rankMember(a, needle);
      const bRank = rankMember(b, needle);
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });

  const memberOptions: MentionOption[] = members.map((m) => ({
    kind: 'member',
    id: m.id || m.userId || `member-${m.username}`,
    name: m.displayName || m.username,
    subtitle: `@${m.username}`,
    username: m.username,
    member: m,
  }));

  const matchingMembers = memberOptions
    .filter(
      (m) =>
        m.username.toLowerCase().includes(needle) ||
        m.name.toLowerCase().includes(needle),
    )
    .sort((a, b) => {
      const aRank = rankMember(a, needle);
      const bRank = rankMember(b, needle);
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      const nameCmp = a.name.localeCompare(b.name);
      if (nameCmp !== 0) return nameCmp;
      return a.username.localeCompare(b.username);
    });

  return [...matchingBroadcasts, ...matchingRoles, ...matchingMembers].slice(0, 10);
}

export function MentionSuggest({
  term,
  members,
  roles = [],
  isDirect,
  onPick,
  onClose,
}: {
  term: string;
  members: readonly ServerMember[];
  roles?: readonly ServerCustomRole[];
  isDirect: boolean;
  onPick: (username: string) => void;
  onClose: () => void;
}): JSX.Element | null {
  const [matches, setMatches] = useState<MentionOption[]>([]);
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const found = filterMentionOptions(term, members, isDirect, roles);
    setMatches(found);
    setActive(0);
  }, [term, members, isDirect, roles]);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    if (matches.length === 0) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((at) => (at + 1) % matches.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((at) => (at - 1 + matches.length) % matches.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const chosen = matches[active] ?? matches[0];
        if (chosen) onPick(chosen.username);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [matches, active, onPick, onClose]);

  if (matches.length === 0) return null;

  const displayTerm = term.trim().replace(/^@+/, '');

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute bottom-full inset-x-3.5 z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-edge bg-surface-900 py-1 shadow-pop"
    >
      <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">
        {displayTerm ? `Matching @${displayTerm}` : 'Members and roles'}
      </p>
      <ul>
        {matches.map((match, index) => {
          const isActive = index === active;
          return (
            <li key={match.id}>
              <button
                type="button"
                role="option"
                aria-selected={isActive}
                ref={isActive ? activeRef : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => onPick(match.username)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-start transition-colors duration-100 ${
                  isActive ? 'bg-white/[0.08]' : ''
                }`}
              >
                {match.kind === 'broadcast' ? (
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
                    <UsersIcon className="h-4 w-4" />
                  </div>
                ) : match.kind === 'role' ? (
                  // The role's own colour, so the menu reads the same way the
                  // member list does. `currentColor` rather than a fill, so a
                  // role with no colour of its own inherits the accent.
                  <div
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent"
                    style={match.colour ? { color: match.colour } : undefined}
                  >
                    <UsersIcon className="h-4 w-4" />
                  </div>
                ) : match.member ? (
                  <div className="pointer-events-none shrink-0">
                    <PersonAvatar
                      userId={match.member.userId || match.member.id}
                      name={match.member.displayName || match.member.username}
                      avatarUrl={match.member.avatarUrl}
                      size="sm"
                    />
                  </div>
                ) : (
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-slate-300">
                    {match.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <span
                    className="block truncate text-sm font-medium text-slate-200"
                    style={match.kind === 'role' && match.colour ? { color: match.colour } : undefined}
                  >
                    {match.kind === 'role' ? `@${match.name}` : match.name}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {match.subtitle}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
