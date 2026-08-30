/**
 * "online", or when somebody was last here, in words.
 *
 * The line under a name in a direct message's header and on a profile card. It
 * is read at a glance and never studied, so it says the least that still places
 * the moment: the clock for today, "yesterday" and the clock for yesterday, the
 * weekday while a weekday still names one day, and the date once it stops.
 *
 * The same rule `day.ts` uses for the message list's dividers, and for the same
 * reason - a reader who has to work out whether "Saturday" was two days ago or
 * nine has been told nothing. It is a separate function rather than a call into
 * that one because these two lines want different words: a divider names a day
 * on its own line, and this names a moment inside a sentence.
 *
 * Every timestamp is UTC on the wire and read in the reader's own zone, so the
 * clock in this line is the clock on the wall of whoever is looking at it.
 * `Android`'s `LastSeen.kt` is the same rule against `LocalDateTime`; if one
 * changes, so does the other.
 */

/** Past this, a weekday no longer names exactly one day. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

function clock(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The whole line, ready to render: `last seen today at 7:07 PM`.
 *
 * `null` for an account nobody has ever seen go offline - a brand new one, or
 * one whose only sessions predate the column. The caller draws nothing at all
 * in that case rather than a date in 1970 or the word "never", which reads as
 * an accusation about somebody who simply signed up this morning.
 */
export function lastSeenLabel(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;

  // Clamped to now, because a laptop whose clock is a few minutes ahead of the
  // server's would otherwise be told somebody was last seen in the future - and
  // "last seen today at 3:34 PM" beside a wall clock reading 3:30 reads as
  // broken software rather than as a wrong clock.
  const at = parsed.getTime() > now.getTime() ? now : parsed;

  // Every line carries the clock. A day on its own answers "roughly when" and
  // leaves the question people actually have - was that this morning or ten
  // minutes before I looked - to be worked out from nothing.
  const time = clock(at);

  const days = Math.round((startOfDay(now) - startOfDay(at)) / (24 * 60 * 60 * 1000));
  if (days === 0) return `last seen today at ${time}`;
  if (days === 1) return `last seen yesterday at ${time}`;

  if (now.getTime() - at.getTime() < WEEK_MS) {
    const weekday = at.toLocaleDateString(undefined, { weekday: 'long' });
    return `last seen ${weekday} at ${time}`;
  }

  const date = at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `last seen ${date} at ${time}`;
}

/**
 * What the header under a name says, status and last-seen time together.
 *
 * One function rather than a conditional at every call site, because there are
 * four of them across two clients and the interesting case is the one that is
 * easy to get wrong: somebody who is *here* is not "last seen a moment ago",
 * and drawing both is saying the same thing twice with the second half already
 * going stale.
 *
 * `idle` and `dnd` are deliberately not spelled out here. The coloured dot
 * beside the name already says which, and a header that reads "do not disturb"
 * over a conversation somebody is about to type into is a worse guess than
 * "online" at what the reader wants to know - which is whether a message will
 * be read now.
 */
export function presenceLine(
  status: PresenceWord,
  lastSeenAt: string | null | undefined,
  now = new Date(),
): string | null {
  if (status !== 'offline') return 'online';
  return lastSeenLabel(lastSeenAt, now);
}

export type PresenceWord = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

/** What a card calls each status when it has nothing more specific to say. */
const STATUS_WORDS: Record<PresenceWord, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  // Only ever your own - everybody else's invisible is resolved to offline
  // before it leaves the server.
  invisible: 'Invisible',
  offline: 'Offline',
};

/**
 * The same fact for a profile card, which unlike a header **always** says
 * something.
 *
 * A header may draw nothing: the name is above it and an empty line under a
 * name is just a name. A card cannot - it is a panel opened to answer "who is
 * this", and a blank where the status belongs reads as a card that failed to
 * load rather than as an account nobody has seen. That happens more often than
 * it sounds: a new account, one whose last-seen time is hidden from you, and
 * one you have disqualified yourself from reading all arrive with no timestamp
 * at all, and offline-with-no-timestamp was drawing nothing.
 *
 * It also spells idle and do-not-disturb out, where `presenceLine` collapses
 * both to "online". A header answers "will this be read now"; a card is the
 * place somebody went looking for detail, and the dot beside it is the only
 * other thing saying which.
 */
export function profilePresence(
  status: PresenceWord,
  lastSeenAt: string | null | undefined,
  now = new Date(),
): string {
  if (status !== 'offline') return STATUS_WORDS[status];

  const seen = lastSeenLabel(lastSeenAt, now);
  if (!seen) return STATUS_WORDS.offline;
  return seen.charAt(0).toUpperCase() + seen.slice(1);
}
