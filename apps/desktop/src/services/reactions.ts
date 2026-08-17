/**
 * Who reacted, as a sentence.
 *
 * A reaction summary carries user ids rather than names, because the same
 * object is broadcast to everybody and a name resolved on the server would be
 * one round trip per emoji per message. The names are looked up here, against
 * the member list the client already holds.
 *
 * Pure and on its own so it can be checked under Node: the joining is the part
 * with a bug in it - an empty list, a list of one, and "you" belonging at the
 * front rather than wherever the server happened to put it.
 */

/** Just enough of a member to name them. */
export interface Reactor {
  userId: string;
  username: string;
  displayName: string;
}

export function reactorNames(
  userIds: readonly string[],
  members: readonly Reactor[],
  meId: string | undefined,
): string {
  const named: string[] = [];
  let unknown = 0;

  for (const id of userIds) {
    if (id === meId) {
      // Always first. "Ada, you and Bob" is not how anybody says it.
      named.unshift('You');
      continue;
    }
    const member = members.find((item) => item.userId === id);
    if (member) named.push(member.displayName || member.username);
    // Somebody who has left, or anybody at all in a direct message - there is
    // no member list there. Counted rather than named: "and 2 others" is
    // honest, and inventing a name for an id is not.
    else unknown += 1;
  }

  if (unknown > 0) named.push(`${unknown} other${unknown === 1 ? '' : 's'}`);
  if (named.length === 0) return '';
  if (named.length === 1) return named[0]!;
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}
