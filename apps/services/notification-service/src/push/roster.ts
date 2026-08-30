/**
 * The two decisions the call fan-out makes that are worth testing, kept out of
 * the service because the service needs Firebase and a database to construct.
 */

/**
 * Whether this roster is news.
 *
 * `call.roster` is published on every join and every departure, and one account
 * with two windows open is two sockets and one person - so the same roster can
 * be announced twice in a row. Order is not meaningful either; the set is.
 * Pushing on a roster nobody's phone can tell apart from the last one is a
 * buzz for nothing.
 */
export function rosterChanged(previous: string[] | undefined, now: string[]): boolean {
  if (previous === undefined) return now.length > 0;
  if (previous.length !== now.length) return true;
  const held = new Set(previous);
  return now.some((userId) => !held.has(userId));
}

/**
 * A roster as a person would say it.
 *
 * Three names is where a notification stops being a sentence and starts being
 * a list, so the fourth onwards are counted rather than named.
 */
export function namesOf(names: string[]): string {
  const [first, second, third] = names;
  switch (names.length) {
    case 0:
      return '';
    case 1:
      return first as string;
    case 2:
      return `${first} and ${second}`;
    case 3:
      return `${first}, ${second} and ${third}`;
    default:
      return `${first}, ${second} and ${names.length - 2} others`;
  }
}

/**
 * Who has just arrived in a call.
 *
 * They have answered it *somewhere*, which is the only thing that can take a
 * ringer down on the devices where they did not. Nothing else knows: the ring
 * push is aimed at an account and lands on every device it owns, and the
 * account that answers is filtered straight out of the roster announcement
 * below - so before this, the other devices were told nothing at all and rang
 * on until they timed out or the whole call ended.
 */
export function joined(previous: string[] | undefined, now: string[]): string[] {
  const held = new Set(previous ?? []);
  return now.filter((userId) => !held.has(userId));
}

/**
 * Whether this roster change is worth announcing to the room.
 *
 * Only the two ends of a call: it starting, and it ending. `call.roster` used
 * to go out on *every* join and departure, and the audience is "everyone who
 * can hear the channel, minus whoever is in the call" - so the moment somebody
 * hung up they stopped being a participant, became audience, and were sent a
 * notification saying who was still on the call they had just left. Leaving a
 * call and being told about it is the clearest possible way to say the rule
 * was wrong.
 *
 * The middle of a call is not news either way. Somebody who wants to know who
 * is in it can look; somebody who does not is being buzzed once per arrival.
 * The end still has to be said, because an empty roster is the only thing that
 * cancels the notification the start put up.
 */
export function worthAnnouncing(previous: string[] | undefined, now: string[]): boolean {
  const started = (previous ?? []).length === 0 && now.length > 0;
  const ended = now.length === 0;
  return started || ended;
}
