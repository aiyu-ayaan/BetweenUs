/**
 * What a game session looks like to one particular person.
 *
 * The board is the same for everybody; "your move", "sit here" and a greyed-out
 * square are not. All of that is a function of the session and one user id, so
 * it lives here rather than in the store: nothing in this file touches zustand,
 * the auth store or the DOM, which is what makes it checkable without a call.
 *
 * None of it is a permission check. The gateway refuses an illegal move using
 * the same rules from `@betweenus/shared-types`, and its answer is the one that
 * counts. This is so a click that is going to be ignored never leaves the
 * window - and so nobody stares at a board wondering why it will not take a
 * disc, when the real answer is that the other chair is still empty.
 */
import {
  GAMES,
  gameReady,
  gameRules,
  seatOf,
  type GameSession,
} from '@betweenus/shared-types';

/** Which seat this person is in, or -1 while they are watching. */
export function seatFor(session: GameSession | null, userId: string | null): number {
  if (!session || !userId) return -1;
  return seatOf(session, userId);
}

/** Whether this person may play `move` right now. */
export function canPlayMove(
  session: GameSession | null,
  userId: string | null,
  move: number,
): boolean {
  if (!session) return false;
  // An empty chair is not an opponent, and the gateway says so too. Without
  // this the person who opened a game could play both sides while they waited.
  if (!gameReady(session)) return false;
  const seat = seatFor(session, userId);
  if (seat === -1 || seat !== session.state.turn) return false;
  return GAMES[session.gameId].moves(session.state).includes(move);
}

/**
 * One line saying where the game is, in the words the reader needs.
 *
 * Second person for the player whose move it is and third for everybody else,
 * because the same sentence has to work for the two people playing and for the
 * four watching them.
 */
export function turnLineFor(session: GameSession | null, userId: string | null): string {
  if (!session) return '';
  const rules = gameRules(session.gameId);
  if (!rules) return '';

  if (session.state.winner !== null) {
    if (session.state.winner === -1) return 'A draw.';
    const winner = session.seats[session.state.winner];
    const name = winner?.username ?? rules.definition.seatNames[session.state.winner];
    return `${name} wins.`;
  }

  if (!gameReady(session)) {
    const empty = session.seats.filter((seat) => seat === null).length;
    return empty === 1 ? 'Waiting for one more player' : `Waiting for ${empty} players`;
  }

  const seat = seatFor(session, userId);
  if (seat === session.state.turn) return 'Your move';
  const them = session.seats[session.state.turn];
  return `${them?.username ?? rules.definition.seatNames[session.state.turn]} to move`;
}
