/**
 * Who a thread reply wakes, kept out of the service because the service needs
 * Firebase and a database to construct.
 *
 * A thread is a side conversation, so a reply in one is not news to everybody
 * who can read the channel - only to the people in it: whoever wrote the root,
 * and whoever has already replied. Everybody else in the channel is still sent
 * the push, flagged mentions-only, because "was I @mentioned" is a question
 * about the words and only the recipient's client can read them. That is the
 * same arrangement a mentions-only channel already relies on, so a mention in
 * a thread reaches somebody who has never opened it, and nothing else does.
 */

/**
 * The people who are *in* a thread, as far as a reply by `senderId` is
 * concerned: the root's author, every earlier replier and every follower,
 * less anybody who unfollowed, minus the sender -
 * who wrote the reply and does not need telling about it.
 *
 * `rootAuthorId` is null when the root is gone or unknown; its thread still
 * has participants in the replies.
 */
export function threadParticipants(
  rootAuthorId: string | null,
  replyAuthorIds: string[],
  senderId: string,
  /**
   * Explicit follow rows for this thread. Following puts somebody in it who
   * never wrote there; unfollowing takes out somebody who did - the choice
   * they made outranks what their history implies.
   */
  follows: { userId: string; following: boolean }[] = [],
): Set<string> {
  const people = new Set(replyAuthorIds);
  if (rootAuthorId) people.add(rootAuthorId);
  for (const follow of follows) {
    if (follow.following) people.add(follow.userId);
    else people.delete(follow.userId);
  }
  people.delete(senderId);
  return people;
}

/**
 * Whether one recipient should only be told when mentioned.
 *
 * Their own mentions-only setting for the channel always wins - a thread is not
 * a way round it. Outside the thread's participants it is mentions-only
 * regardless.
 */
export function threadMentionsOnly(
  userId: string,
  channelMentionsOnly: boolean,
  participants: Set<string>,
): boolean {
  return channelMentionsOnly || !participants.has(userId);
}
