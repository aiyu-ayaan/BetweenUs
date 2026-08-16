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
 * username or a display name, or one of the two broadcasts.
 */

/** `@everyone` and `@here` both address the room. */
const BROADCASTS = ['everyone', 'here'];

/** Characters that may sit either side of a name without breaking the mention. */
const BOUNDARY = /[\s.,:;!?'"()[\]{}<>@-]/;

export interface MentionTarget {
  username: string;
  displayName?: string | null;
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

  const names = [me.username, me.displayName, ...BROADCASTS]
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim().toLowerCase());

  return names.some((name) => hasMention(haystack, name));
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
