import { useEffect, useState } from 'react';
import type { PresenceStatus, ServerMember, ServerRole } from '@betweenus/shared-types';
import { useChatStore } from '../../stores/chat';
import { useFriendsStore } from '../../stores/friends';
import { usePresenceStore, useStatusOf } from '../../stores/presence';
import { useAuthStore } from '../../stores/auth';
import { Avatar } from '../../components/Avatar';
import { ProfileHover } from '../../components/ProfileCard';
import {
  isUserMuted,
  onPreferencesChanged,
  setUserMuted,
} from '../../services/notifications';
import { api } from '../../services/api';
import { useVoiceStore } from '../../stores/voice';
import { UsersIcon, XIcon } from '../../components/icons';
import { EmptyState, SkeletonRows } from '../../components/Skeleton';
import { listState } from '../../services/list-state';
import { SafetyNumberDialog } from './SafetyNumberDialog';

export interface MemberListProps {
  onClose?: () => void;
  className?: string;
}

/**
 * The right-hand column in a server: who is here, online first. Members are
 * grouped by built-in role the way Discord groups by hoisted role - a server
 * this size does not need a section per custom role. A custom role does show
 * here, though, in the one place it is worth a whole column: the name is drawn
 * in the colour of the highest-ranked role its holder has, which is the answer
 * the server already works out and sends as `colour`.
 */
export function MemberList({
  onClose,
  className = 'w-60 shrink-0 flex',
}: MemberListProps = {}): JSX.Element {
  const members = useChatStore((state) => state.members);
  const online = usePresenceStore((state) => state.online);
  const statusOf = useStatusOf();
  const [menu, setMenu] = useState<{ member: ServerMember; at: { x: number; y: number } } | null>(
    null,
  );
  const [verifying, setVerifying] = useState<ServerMember | null>(null);
  const channelId = useChatStore((state) => state.activeChannelId);

  // A server that has not answered yet has no members, and so does a server
  // with nobody in it. This column used to draw the second while the first was
  // true - and drew it as an empty column with a heading that said "Members —
  // 0", which is a statement rather than a wait.
  const loading = useChatStore((state) => state.loadingServer);
  const state = listState(members.length, loading);

  const here = members.filter((member) => online.has(member.userId));
  const away = members.filter((member) => !online.has(member.userId));

  const staff = here.filter((member) => isStaff(member.role));
  const rest = here.filter((member) => !isStaff(member.role));

  return (
    <aside
      aria-label="Members"
      className={`panel flex flex-col bg-surface-800 ${className}`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-3">
        <UsersIcon className="h-4 w-4 text-slate-400" />
        <h2 className="flex-1 text-sm font-semibold text-slate-100">
          {state === 'loading' ? 'Members' : `Members — ${members.length}`}
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close member list"
            className="flex h-8 w-8 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 sm:w-7 cursor-pointer items-center justify-center rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-white/[0.07] hover:text-slate-100"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        {state === 'loading' && <SkeletonRows rows={6} label="Loading members" className="px-2" />}

        {state === 'empty' && (
          <EmptyState
            title="Nobody here yet"
            hint="Invite somebody from the server menu and they will show up in this column."
          />
        )}

        <Group label={`Admins — ${staff.length}`} members={staff} statusOf={statusOf} onOpen={setMenu} />
        <Group label={`Online — ${rest.length}`} members={rest} statusOf={statusOf} onOpen={setMenu} />
        <Group
          label={`Offline — ${away.length}`}
          members={away}
          statusOf={statusOf}
          muted
          onOpen={setMenu}
        />
      </div>

      {menu && (
        <MemberMenu
          member={menu.member}
          at={menu.at}
          onClose={() => setMenu(null)}
          onVerify={(member) => {
            setMenu(null);
            setVerifying(member);
          }}
        />
      )}

      {/* The directory read the dialog needs is scoped to a channel, so there
          is nothing to show without one. In this column there always is one. */}
      {verifying && channelId && (
        <SafetyNumberDialog
          userId={verifying.userId}
          displayName={verifying.displayName}
          channelId={channelId}
          onClose={() => setVerifying(null)}
        />
      )}
    </aside>
  );
}

function Group({
  label,
  members,
  statusOf,
  muted = false,
  onOpen,
}: {
  label: string;
  members: ServerMember[];
  statusOf: (userId: string) => PresenceStatus;
  muted?: boolean;
  onOpen: (menu: { member: ServerMember; at: { x: number; y: number } }) => void;
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
            {/* Resting on the row opens the card; the click and the right
                click still open the menu of things to *do* about the person.
                Two gestures, two questions - "who is this" wants no click at
                all, and "message them" was never going to be answered by
                hovering. */}
            <ProfileHover
              person={{
                userId: member.userId,
                displayName: member.displayName,
                username: member.username,
                avatarUrl: member.avatarUrl,
                about: member.about,
                colour: member.colour,
              }}
            >
            <div
              onContextMenu={(event) => {
                event.preventDefault();
                onOpen({ member, at: { x: event.clientX, y: event.clientY } });
              }}
              onClick={(event) =>
                onOpen({ member, at: { x: event.clientX, y: event.clientY } })
              }
              className={`flex min-h-[44px] sm:min-h-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-200 hover:bg-white/[0.05] ${
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
                <span
                  className="block truncate text-[15px] text-slate-200"
                  style={member.colour ? { color: member.colour } : undefined}
                >
                  {member.displayName}
                </span>
                {isStaff(member.role) && (
                  <span className="block truncate text-xs text-slate-500">
                    {member.role.toLowerCase()}
                  </span>
                )}
              </span>
            </div>
            </ProfileHover>
          </li>
        ))}
      </ul>
    </>
  );
}

function isStaff(role: ServerRole): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MODERATOR';
}

/**
 * What you can do about one person, from the column that lists them.
 *
 * A member list that only draws names is a member list you have to leave to act
 * on: a direct message is on the friends screen, a friend request is on the
 * search, and muting one loud person was not anywhere at all. Everything here
 * is about the person rather than the server - moderation stays in server
 * settings, where the permission that allows it is also explained.
 */
function MemberMenu({
  member,
  at,
  onClose,
  onVerify,
}: {
  member: ServerMember;
  at: { x: number; y: number };
  onClose: () => void;
  onVerify: (member: ServerMember) => void;
}): JSX.Element | null {
  const me = useAuthStore((state) => state.user);
  const friends = useFriendsStore((state) => state.friends);
  const addFriend = useFriendsStore((state) => state.add);
  const openDirect = useFriendsStore((state) => state.openDirect);
  // The call this person is in right now, if any. Ringing somebody into a call
  // you are not in is a message about a room you have not entered - so the
  // action only exists while there is a call to pull them into.
  const call = useVoiceStore((state) => (state.status === 'idle' ? null : state.channelId));
  const callName = useVoiceStore((state) => state.channelName);
  const inCall = usePresenceStore((state) =>
    call ? (state.voice.get(call) ?? []).includes(member.userId) : false,
  );
  const [muted, setMuted] = useState(() => isUserMuted(member.userId));
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => onPreferencesChanged(() => setMuted(isUserMuted(member.userId))), [member.userId]);

  useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!(event.target as HTMLElement).closest('[data-member-menu]')) onClose();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener('mousedown', away), 0);
    document.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  // Nothing here applies to yourself: you cannot befriend, mute or message you.
  if (member.userId === me?.id) return null;

  const relationship = friends.find((friend) => friend.user.id === member.userId);
  const width = 224;
  const left = Math.min(at.x, window.innerWidth - width - 8);
  const top = Math.min(at.y, window.innerHeight - 200);

  const act = (work: Promise<unknown>, said: string): void => {
    void work
      .then(() => {
        setNote(said);
        window.setTimeout(onClose, 700);
      })
      .catch((error: unknown) => {
        setNote(error instanceof Error ? error.message : 'That did not work');
      });
  };

  return (
    <div
      data-member-menu
      role="menu"
      aria-label={`Actions for ${member.displayName}`}
      style={{ left, top, width }}
      className="fixed z-50 animate-pop overflow-hidden rounded-xl border border-edge bg-surface-900 py-1 shadow-pop"
    >
      <p className="truncate px-3 py-1.5 text-xs text-slate-500">@{member.username}</p>

      {/* A direct message needs a friendship, and the service says so - which
          is why this reports rather than assuming it worked. */}
      <Item
        label="Message"
        onClick={() =>
          act(openDirect(member.userId), 'Opening the conversation')
        }
      />

      {/* A friendship is what a direct message needs, so it is offered right
          beside it. Somebody already asked, or already accepted, is told which
          rather than offered a button that does nothing. */}
      {!relationship && (
        <Item
          label="Add friend"
          onClick={() => act(addFriend(member.username), 'Request sent')}
        />
      )}
      {relationship?.direction === 'outgoing' && <Item label="Friend request sent" disabled />}
      {relationship?.direction === 'incoming' && (
        <Item
          label="Accept friend request"
          onClick={() => act(addFriend(member.username), 'Friends')}
        />
      )}

      {/* Discord's "invite to voice channel", and the reason the ring exists at
          all: the roster announcement tells a whole channel that a call is
          happening, which is why it may not ring anybody's phone. This is
          aimed at one person, so it may. */}
      {call && !inCall && (
        <Item
          label={callName ? `Ring into ${callName}` : 'Ring into the call'}
          hint="Rings them, wherever they are signed in"
          onClick={() => act(api.callRing(call, member.userId), 'Ringing them')}
        />
      )}
      {call && inCall && <Item label="Already in the call" disabled />}

      <Item
        label={muted ? 'Unmute notifications' : 'Mute notifications'}
        hint={muted ? undefined : 'Silences them wherever they write, including mentions'}
        onClick={() => act(setUserMuted(member.userId, !muted), muted ? 'Unmuted' : 'Muted')}
      />

      {/* The only thing in this app that catches a server lying about a public
          key, which is why it sits with the everyday actions rather than
          somewhere in settings nobody opens. */}
      <Item
        label="Verify safety number"
        hint="Compare sixty digits with them, over something that is not this app"
        onClick={() => onVerify(member)}
      />

      <Item
        label="Copy user ID"
        onClick={() => {
          void navigator.clipboard?.writeText(member.userId);
          onClose();
        }}
      />

      {note && <p className="px-3 py-1.5 text-xs text-slate-400">{note}</p>}
    </div>
  );
}

function Item({
  label,
  hint,
  onClick,
  disabled = false,
}: {
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className={`block w-full px-3 py-1.5 text-start text-sm transition-colors duration-150 ${
        disabled
          ? 'cursor-not-allowed text-slate-500'
          : 'cursor-pointer text-slate-200 hover:bg-white/[0.07] hover:text-slate-100'
      }`}
    >
      {label}
    </button>
  );
}
