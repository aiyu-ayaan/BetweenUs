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
