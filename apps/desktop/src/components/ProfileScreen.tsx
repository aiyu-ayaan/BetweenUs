/**
 * Everything about one person, on a page of its own.
 *
 * The hover card answers the questions that are not worth a click - are they
 * here, what does their line say. This answers the ones that are: the whole
 * about line rather than three clamped lines of it, the cover picture at a size
 * worth having uploaded, the rung they hold in this server, and when they
 * joined it. A card that grew to hold all of that would stop being a card,
 * which is why this is a second thing rather than a bigger first one.
 *
 * Opened from the card's own footer button, and from a click on an avatar. It
 * is deliberately reachable from both: the button is the discoverable route and
 * the avatar is the one people try first.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { PresenceStatus } from '@betweenus/shared-types';
import { usePresenceStore } from '../stores/presence';
import { useChatStore } from '../stores/chat';
import { profilePresence } from '../services/last-seen';
import { useFocusTrap } from '../services/focus-trap';
import { absoluteUrl } from '../services/endpoint';
import { Avatar } from './Avatar';
import { ProfileCover } from './ProfileCover';
import { XIcon } from './icons';

/** What the screen needs that is not looked up from a store while it is open. */
export interface ProfilePerson {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  coverUrl?: string | null;
  about: string;
  /** The colour of their highest-ranked role, where they have one. */
  colour?: string | null;
}

interface ProfileScreenState {
  shown: ProfilePerson | null;
}

const useProfileScreen = create<ProfileScreenState>(() => ({ shown: null }));

/**
 * Opens the full profile. Called by the hover card's footer button and by
 * anything else that has a whole person to hand.
 */
export function openProfile(person: ProfilePerson): void {
  useProfileScreen.setState({ shown: person });
  // The same one-shot the card does. A last-seen line that is a minute stale
  // reads identically, and a screen that polls is a request per glance.
  usePresenceStore.getState().askLastSeen([person.userId]);
}

export function closeProfile(): void {
  useProfileScreen.setState({ shown: null });
}

export function ProfileScreen(): JSX.Element | null {
  const shown = useProfileScreen((state) => state.shown);
  if (!shown) return null;
  // Keyed on the person, so opening a second profile from inside the first
  // remounts rather than carrying the previous one's scroll position.
  return <Screen key={shown.userId} person={shown} />;
}

function Screen({ person }: { person: ProfilePerson }): JSX.Element {
  const trap = useFocusTrap<HTMLDivElement>();
  const status = usePresenceStore((state) => state.statuses.get(person.userId) ?? 'offline');
  const lastSeenAt = usePresenceStore((state) => state.lastSeen.get(person.userId) ?? null);

  // Read live rather than frozen into `person`: a member row carries the roles,
  // the join date and the cover, and whoever opened this may have had only a
  // message author to hand. Absent is fine - every line below is optional.
  const member = useChatStore((state) => state.members.find((row) => row.userId === person.userId));

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeProfile();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, []);

  const cover = person.coverUrl ?? member?.coverUrl ?? null;
  const about = (member?.about ?? person.about).trim();
  const colour = person.colour ?? member?.colour ?? null;

  return (
    <div
      ref={trap}
      role="dialog"
      aria-modal="true"
      aria-label={`${person.displayName} profile`}
      onClick={closeProfile}
      className="fixed inset-0 z-[75] flex animate-fade items-center justify-center bg-black/70 px-4 py-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-h-full w-full max-w-md animate-pop overflow-y-auto rounded-xl border border-edge bg-surface-900 shadow-pop"
      >
        <ProfileCover coverUrl={cover} className="h-[132px]">
          <button
            type="button"
            onClick={closeProfile}
            aria-label="Close profile"
            className="absolute end-2 top-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white transition-colors duration-150 hover:bg-black/60"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </ProfileCover>

        <div className="px-5 pb-5">
          {/* Pulled up over the band, the way every profile since Twitter has
              done it - it is what ties the round picture to the wide one. */}
          <div className="-mt-12 inline-block rounded-full border-[6px] border-surface-900">
            <Avatar
              name={person.displayName}
              avatarUrl={person.avatarUrl}
              status={status as PresenceStatus}
              size="lg"
              ringColour="border-surface-900"
            />
          </div>

          <h2
            className="mt-2 break-words text-xl font-bold text-slate-50"
            style={colour ? { color: colour } : undefined}
          >
            {person.displayName}
          </h2>
          <p className="text-sm text-slate-400">@{member?.username ?? person.username}</p>
          <p className="mt-2 text-xs text-slate-400">
            {profilePresence(status as PresenceStatus, lastSeenAt)}
          </p>

          {about && (
            <section className="mt-5 rounded-lg bg-surface-800 p-4">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                About
              </h3>
              {/* Unclamped, unlike the card. This screen exists so the whole
                  line can be read; clamping it here would make it the card
                  again, only slower to reach. */}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-200">{about}</p>
            </section>
          )}

          {/* The base rung, not the custom roles. Those are fetched per server
              and are not in any store this screen can read, and a request per
              profile opened is not worth a row of chips - the rung is what a
              member list already shows beside a name anyway. */}
          {member && (
            <section className="mt-3 rounded-lg bg-surface-800 p-4">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Role
              </h3>
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-200">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colour ?? '#94a3b8' }}
                />
                {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
              </p>
            </section>
          )}

          {member && (
            <section className="mt-3 rounded-lg bg-surface-800 p-4">
              <h3 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Member since
              </h3>
              <p className="mt-1 text-sm text-slate-200">{memberSince(member.joinedAt)}</p>
            </section>
          )}

          {/* The cover at full width, for the same reason tapping an avatar
              opens the picture: somebody who uploaded one meant it to be
              looked at. Only when there is one - the accent band is not a
              photograph and there is nothing to open. */}
          {cover && (
            <a
              href={absoluteUrl(cover)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block text-xs text-slate-500 transition-colors duration-150 hover:text-slate-300"
            >
              Open cover photo
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** A join date reads as a date, not a duration - "3 months" ages while you look at it. */
function memberSince(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? '—' : when.toLocaleDateString();
}
