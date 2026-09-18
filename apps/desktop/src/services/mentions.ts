/**
 * Whether a message is addressed at you.
 *
 * This has to live in the client, and that is not a shortcut: a message body is
 * sealed with the channel key, so no service can read one and none of them can
 * be asked "was I mentioned". The window that decrypted the message is the only
 * thing in the system able to answer, so it answers, and the preference it
 * checks the answer against is all the server stores.
 *
 * The rules are Discord's, minus the ids: a mention is `@` followed by a
 * username, a display name, the name of a custom role this account holds, or
 * one of the two broadcasts.
 */

/** `@everyone` and `@here` both address the room. */
const BROADCASTS = ['everyone', 'here'];

/** Characters that may sit either side of a name without breaking the mention. */
const BOUNDARY = /[\s.,:;!?'"()[\]{}<>@-]/;

export interface MentionTarget {
  username: string;
  displayName?: string | null;
  /**
   * The names of the custom roles this account holds *in the server this
   * message was said in* - never every role the server has.
   *
   * Names rather than ids for the same reason the rest of this file matches
   * names: the wire format is the text somebody typed, and `@designers` is
   * what they typed. A role is therefore matched exactly as a display name is,
   * spaces and all, and inherits that rule's one known weakness - two roles
   * whose names differ only by trailing words are told apart by the boundary
   * check and nothing else.
   */
  roles?: readonly string[];
}

/**
 * True when `text` mentions `me`.
 *
 * Names are matched case-insensitively and have to end on a boundary, so
 * `@ann` does not fire for `@anna` - the failure that makes a mentions-only
 * channel noisier than the channel it was supposed to quieten.
 *
 * A display name may contain spaces and is matched as written; Discord solves
 * this with ids in the wire format, which is the better answer and needs a
 * message format change on every client to get.
 */
export function mentionsMe(text: string | null | undefined, me: MentionTarget): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase();

  const names = [me.username, me.displayName, ...(me.roles ?? []), ...BROADCASTS]
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim().toLowerCase());

  return names.some((name) => hasMention(haystack, name));
}

/**
 * The names of the roles `userId` holds in a server, for [[MentionTarget]].
 *
 * A pure join of two lists the client already has - the member rows and the
 * server's roles - kept here rather than in the store so the one rule about
 * *whose* roles count has a single home, and so the reading side (a bubble
 * that tints) and the writing side (the `@` menu) cannot drift apart.
 *
 * A member row that has not arrived yet answers with nothing, which is the
 * right answer rather than a guess: a message tinted on a stale roster is a
 * mention somebody never received.
 */
export function roleNamesFor(
  members: readonly { userId: string; roleIds: readonly string[] }[],
  roles: readonly { id: string; name: string }[],
  userId: string | null | undefined,
): string[] {
  if (!userId) return [];
  const mine = members.find((member) => member.userId === userId);
  if (!mine) return [];
  const held = new Set(mine.roleIds);
  return roles.filter((role) => held.has(role.id)).map((role) => role.name);
}

function hasMention(haystack: string, name: string): boolean {
  const needle = `@${name}`;
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;

    const before = at === 0 ? '' : haystack[at - 1]!;
    const after = haystack[at + needle.length] ?? '';

    // An `@` immediately before is an email address or a second mention run
    // together; either way this is not the name being addressed.
    const openedCleanly = before === '' || (BOUNDARY.test(before) && before !== '@');
    const closedCleanly = after === '' || BOUNDARY.test(after);
    if (openedCleanly && closedCleanly) return true;

    from = at + 1;
  }
}
