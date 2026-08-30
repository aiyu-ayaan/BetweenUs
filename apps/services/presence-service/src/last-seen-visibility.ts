/**
 * Who may read whose last-seen time.
 *
 * A pure function, apart from the four database reads that feed it, because
 * every interesting case here is a combination of two people's settings and a
 * relationship - and a rule about privacy that is only ever exercised by two
 * accounts on two laptops is a rule nobody checks.
 *
 * The three tiers are WhatsApp's, and so is the reciprocity: an account that
 * hides when it was last here does not get to read anybody else's. Without that
 * the setting is a one-way mirror, which everybody switches on the moment it
 * costs them nothing, and the feature stops meaning anything for everyone.
 *
 * `everyone` is the ceiling rather than the whole world. Presence is already
 * scoped to people who share a server or an accepted friendship - see
 * `audience.ts` - so the widest this can ever be is "everybody who could
 * already see your name", and this function is a filter on top of that rather
 * than a way around it.
 */
import type { LastSeenVisibility } from '@betweenus/shared-types';

/** What one account has decided, and what the asker has decided about theirs. */
export interface LastSeenQuestion {
  /** The subject's own setting - who they will let read it. */
  subject: LastSeenVisibility;
  /** The asker's setting. Only `nobody` matters here, and it disqualifies them. */
  asker: LastSeenVisibility;
  /** Whether the two hold an accepted friendship. */
  friends: boolean;
  /** Whether the asker is the subject. Your own value is always yours to read. */
  self: boolean;
}

/**
 * Whether the asker may read the subject's last-seen time.
 *
 * The caller has already established that the asker is in the subject's
 * audience; this decides nothing about people who cannot see each other at all,
 * because the answer there was already no.
 */
export function maySeeLastSeen(question: LastSeenQuestion): boolean {
  // Your own screen shows you your own value whatever you have chosen, or the
  // settings page could not draw what the setting does.
  if (question.self) return true;

  // Reciprocity, and it is checked first: somebody who hides their own is
  // refused before the subject's generosity is even consulted.
  if (question.asker === 'nobody') return false;

  switch (question.subject) {
    case 'everyone':
      return true;
    case 'friends':
      return question.friends;
    case 'nobody':
      return false;
  }
}

/**
 * The same decision for a batch, which is the shape a query actually arrives in.
 *
 * One asker, many subjects: a profile card asks about one person and a
 * conversation header about one, but a member column asks about a screenful,
 * and a database round trip per row is not the way to answer that.
 */
export function readableLastSeen(
  askerId: string,
  askerVisibility: LastSeenVisibility,
  subjects: { id: string; visibility: LastSeenVisibility }[],
  friendIds: Set<string>,
): Set<string> {
  const allowed = new Set<string>();
  for (const subject of subjects) {
    const may = maySeeLastSeen({
      subject: subject.visibility,
      asker: askerVisibility,
      friends: friendIds.has(subject.id),
      self: subject.id === askerId,
    });
    if (may) allowed.add(subject.id);
  }
  return allowed;
}

/** The database's spelling of the setting, in the one the wire uses. */
export function toVisibility(value: string | null | undefined): LastSeenVisibility {
  switch (value) {
    case 'FRIENDS':
      return 'friends';
    case 'NOBODY':
      return 'nobody';
    // An unknown value is somebody else's newer build, and the safe reading of
    // a privacy setting nobody here understands is the widest one it could be
    // narrowed from - which is what the column defaults to anyway.
    default:
      return 'everyone';
  }
}
