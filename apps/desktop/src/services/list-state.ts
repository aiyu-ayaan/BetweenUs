/**
 * What a list draws when it has nothing in it.
 *
 * Three lines of logic that were written five different ways across the client,
 * and got it wrong in three of them. A list with no rows is either *empty* or
 * *not answered yet*, and those are opposite messages: one says "nobody has
 * added anything, here is how", the other says "wait". Drawing the first while
 * the second is true is the whole of the phase-40 complaint — the friends
 * screen said "No friends yet. Add someone by their username." to an account
 * with forty friends, every time it opened, until the fetch landed.
 *
 * It is a function rather than a comment because the mistake is not knowing the
 * rule, it is forgetting the `&& !loading` on the fifth list.
 */

export type ListState =
  /** Nothing to draw and something in flight: a skeleton. */
  | 'loading'
  /** Nothing to draw and nothing coming: the empty state, which says what to do. */
  | 'empty'
  /** There are rows. Draw them. */
  | 'ready';

/**
 * `count` rows in hand, `loading` true while a fetch is out.
 *
 * The order matters in one direction only: **rows beat loading**. A list that
 * already has content and is refreshing keeps drawing the content, because
 * replacing a list somebody is reading with grey bars every time it revalidates
 * is worse than a few seconds of slightly stale rows. Loading only wins when
 * there is nothing to lose.
 */
export function listState(count: number, loading: boolean): ListState {
  if (count > 0) return 'ready';
  return loading ? 'loading' : 'empty';
}
