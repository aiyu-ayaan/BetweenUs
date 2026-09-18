/**
 * The `@` mention suggestion menu: type `@` and choose a member or broadcast.
 *
 * Like `EmojiSuggest.tsx`, this renders above the composer rather than at the caret,
 * avoiding caret measurement bugs while remaining right next to where the user is typing.
 *
 * In server channels, `@everyone` and `@here` broadcasts are offered at the top.
 * In direct channels (DM), broadcasts are suppressed.
 */
import { useEffect, useRef, useState } from 'react';
import type { ServerMember } from '@betweenus/shared-types';
import { PersonAvatar } from '../../components/Avatar';
import { UsersIcon } from '../../components/icons';

export interface MentionOption {
  kind: 'broadcast' | 'member';
  id: string;
  name: string;
  subtitle: string;
  username: string;
  member?: ServerMember;
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
 * Broadcast options (`@everyone`, `@here`) are included only in non-direct channels.
 * Member options are matched against username and display name, ranked by exact match,
 * prefix match, then substring match, and sorted alphabetically within the same tier.
 * Results are capped at 10 items.
 */
export function filterMentionOptions(
  term: string,
  members: readonly ServerMember[],
  isDirect: boolean,
): MentionOption[] {
  const needle = term.trim().toLowerCase().replace(/^@+/, '');

  const matchingBroadcasts = isDirect
    ? []
    : BROADCASTS.filter(
        (b) =>
          b.username.toLowerCase().includes(needle) ||
          b.name.toLowerCase().includes(needle),
      );

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

  return [...matchingBroadcasts, ...matchingMembers].slice(0, 10);
}

export function MentionSuggest({
  term,
  members,
  isDirect,
  onPick,
  onClose,
}: {
  term: string;
  members: readonly ServerMember[];
  isDirect: boolean;
  onPick: (username: string) => void;
  onClose: () => void;
}): JSX.Element | null {
  const [matches, setMatches] = useState<MentionOption[]>([]);
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const found = filterMentionOptions(term, members, isDirect);
    setMatches(found);
    setActive(0);
  }, [term, members, isDirect]);

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
        {displayTerm ? `Members matching @${displayTerm}` : 'Members'}
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
                ) : match.member ? (
                  <PersonAvatar
                    userId={match.member.userId || match.member.id}
                    name={match.member.displayName || match.member.username}
                    avatarUrl={match.member.avatarUrl}
                    size="sm"
                  />
                ) : (
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-700 text-xs font-semibold text-slate-300">
                    {match.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-200">
                    {match.name}
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
