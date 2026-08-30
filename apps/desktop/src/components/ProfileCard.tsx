/**
 * The card that appears when the pointer rests on somebody's name or picture.
 *
 * What Teams does, and for the reason Teams does it: a member column is a list
 * of names, and the questions you actually have about a name - are they here,
 * when were they last here, what does their line say - are not worth a click,
 * a dialog and a way back out. Resting on the name answers them, moving on
 * dismisses it, and nothing has been navigated to.
 *
 * It is a hover affordance and therefore a pointer affordance: a touch screen
 * has no "resting", so the same information is reached by the gesture that
 * screen already has - a long press here, a double tap on Android. The card
 * itself is identical either way, which is the point of it being one component.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PresenceStatus } from '@betweenus/shared-types';
import { usePresenceStore } from '../stores/presence';
import { profilePresence } from '../services/last-seen';
import { Avatar } from './Avatar';

/**
 * How long the pointer has to rest before the card opens.
 *
 * Long enough that crossing a member column on the way somewhere else opens
 * nothing, short enough that resting on a name is a gesture rather than a wait.
 * Teams and Slack both sit around here; a delay measured in seconds turns a
 * hover card into a feature nobody discovers.
 */
const OPEN_AFTER_MS = 600;

/**
 * And how long it survives the pointer leaving.
 *
 * The gap between a name and the card that opened beside it is crossed by a
 * pointer that is briefly over neither, so a card that closed the instant it
 * was left could not be reached to read.
 */
const CLOSE_AFTER_MS = 200;

/**
 * How long a finger has to stay down before the card opens on a touch screen.
 *
 * The same information, reached by the gesture a screen with no pointer has.
 * Android's double tap is the same decision made against a different set of
 * gestures already spoken for.
 */
const PRESS_AFTER_MS = 500;

/** Roughly the card's own size, for the first placement before it is measured. */
const CARD_WIDTH = 288;
const CARD_HEIGHT = 200;

export interface ProfileCardPerson {
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  about: string;
  /** The colour of their highest-ranked role, where they have one. */
  colour?: string | null;
}

/**
 * Wraps whatever draws a person and opens the card over it.
 *
 * A wrapper rather than a prop on `Avatar`, because the thing worth resting on
 * is the name *and* the picture together - in a member row they are one target,
 * and two independent hover zones side by side would flicker between them.
 */
export function ProfileHover({
  person,
  children,
  className = '',
}: {
  person: ProfileCardPerson;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancel = (): void => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  useEffect(() => cancel, []);

  const open = (after: number): void => {
    cancel();
    openTimer.current = window.setTimeout(() => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      setAt({ x: box.left, y: box.top });
      // Asked once per opening rather than kept fresh: a last-seen time that is
      // a minute stale reads exactly the same, and a card that polls is a
      // request every time somebody's pointer crosses a list.
      usePresenceStore.getState().askLastSeen([person.userId]);
    }, after);
  };

  const close = (): void => {
    cancel();
    closeTimer.current = window.setTimeout(() => setAt(null), CLOSE_AFTER_MS);
  };

  return (
    <div
      ref={anchor}
      onPointerEnter={(event) => {
        // A touch "enters" on contact and never leaves, so hovering is not a
        // gesture it has. The long press below is what a finger uses instead.
        if (event.pointerType === 'touch') return;
        open(OPEN_AFTER_MS);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'touch') return;
        close();
      }}
      onTouchStart={() => open(PRESS_AFTER_MS)}
      // A finger that moved was scrolling the list, not resting on a name.
      onTouchMove={cancel}
      onTouchEnd={cancel}
      className={className}
    >
      {children}
      {at && (
        <ProfileCard
          person={person}
          at={at}
          onPointerEnter={cancel}
          onPointerLeave={close}
          onDismiss={() => {
            cancel();
            setAt(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The card itself, positioned beside `at` and flipped to whichever side of it
 * has the room. Exported so a click or a double tap can open one directly.
 */
export function ProfileCard({
  person,
  at,
  onPointerEnter,
  onPointerLeave,
  onDismiss,
}: {
  person: ProfileCardPerson;
  at: { x: number; y: number };
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const status = usePresenceStore((state) => state.statuses.get(person.userId) ?? 'offline');
  const lastSeenAt = usePresenceStore((state) => state.lastSeen.get(person.userId) ?? null);
  const card = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState(() => place(at, CARD_WIDTH, CARD_HEIGHT));

  // Measured once it is real, because the about line decides the height and a
  // card guessed at 200px tall hangs off the bottom of the window when it is
  // 260. A layout effect rather than an effect, so it never paints in the
  // guessed place first and jumps.
  useLayoutEffect(() => {
    const size = card.current?.getBoundingClientRect();
    if (size) setBox(place(at, size.width, size.height));
  }, [at, person.about]);

  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onDismiss]);

  // `profilePresence` and not `presenceLine`: a card always says something.
  // Offline with no timestamp - a new account, or one whose last seen is hidden
  // from you - used to draw nothing at all here, which read as a card that had
  // failed to load rather than as somebody nobody has seen.
  const line = profilePresence(status as PresenceStatus, lastSeenAt);

  return (
    <div
      ref={card}
      role="dialog"
      aria-label={`Profile of ${person.displayName}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{ left: box.x, top: box.y }}
      className="fixed z-[70] w-72 animate-pop rounded-xl border border-edge bg-surface-800 p-4 shadow-pop"
    >
      <div className="flex items-center gap-3">
        <Avatar
          name={person.displayName}
          avatarUrl={person.avatarUrl}
          status={status as PresenceStatus}
          size="md"
          ringColour="border-surface-800"
        />
        <div className="min-w-0">
          <p
            className="truncate text-[15px] font-semibold text-slate-50"
            style={person.colour ? { color: person.colour } : undefined}
          >
            {person.displayName}
          </p>
          <p className="truncate text-xs text-slate-400">@{person.username}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">{line}</p>

      {person.about.trim() && (
        <>
          <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-500">About</p>
          {/* Wrapped and clamped: 140 characters is two lines at this width,
              and a card that grows past three moves whatever is under it. */}
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-slate-200">
            {person.about}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Where the card goes: beside the anchor, flipped to whichever side has room,
 * and never off the edge of the window.
 *
 * Exported for the check, which is the only way to test placement without a
 * browser - and the cases worth testing are exactly the ones that need a member
 * column pinned to the right-hand edge of a screen to reproduce by hand.
 */
export function place(
  at: { x: number; y: number },
  width: number,
  height: number,
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): { x: number; y: number } {
  const GAP = 12;
  const EDGE = 8;

  // Left of the anchor by preference: the member column lives on the right, so
  // opening rightwards would put every card of the common case off the screen.
  let x = at.x - width - GAP;
  if (x < EDGE) x = Math.min(at.x + GAP, viewport.width - width - EDGE);
  x = Math.max(EDGE, x);

  // Vertically it starts level with the row and slides up only as far as it has
  // to, so the card stays attached to whatever opened it.
  let y = at.y;
  if (y + height > viewport.height - EDGE) y = viewport.height - height - EDGE;
  y = Math.max(EDGE, y);

  return { x, y };
}
