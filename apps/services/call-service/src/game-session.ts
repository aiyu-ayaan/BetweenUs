/**
 * Play Together: the referee, as one pure function.
 *
 * A game session is a board, two chairs and a tally. This decides what each of
 * those becomes when somebody opens a game, sits down, moves, asks for a
 * rematch or closes it - and it decides *nothing* about the rules of the game
 * itself. Those come from `@betweenus/shared-types`, where the clients read
 * them too, because a referee that disagreed with the boards being drawn in
 * front of people would be a game nobody could argue about.
 *
 * The reason this is a server at all, when the media is peer to peer and the
 * chat is not: two people clicking the same square within a moment of each
 * other need one answer, and a mesh has no ordering to give one. It is the same
 * argument as the screen-share claim and the listening session's pause, and it
 * costs the same - a few hundred bytes when a person presses something.
 *
 * Everything here is pure, so the whole of it is testable without a socket or a
 * call. See `game-session.check.ts`.
 *
 * ponytail: in memory beside the roster, exactly like `CallGateway.calls` and
 * the listening session. Two call-service replicas would each referee half a
 * game; the upgrade path is the same one - the roster in Redis, this beside it.
 */
import {
  GAMES,
  gameRules,
  type GameId,
  type GameSeat,
  type GameSession,
} from '@betweenus/shared-types';

/** What a client asked for, once the gateway has decided who asked. */
export type GameAction =
  | { kind: 'open'; gameId: GameId }
  /** `seat` of -1 is standing up: still in the call, no longer playing. */
  | { kind: 'sit'; seat: number }
  | { kind: 'move'; move: number }
  | { kind: 'rematch' }
  | { kind: 'close' }
  /** Not a button anybody presses - somebody left the call. See `vacate`. */
  | { kind: 'vacate'; userId: string };

/** Who is acting, from the socket rather than from the message. */
export interface Actor {
  userId: string;
  username: string;
}

/**
 * Opens a game, with whoever opened it already sitting in the first chair.
 *
 * Sitting them down is the point. "Open a game and then take a seat" is two
 * actions to express one intention, and the second of them is the one somebody
 * forgets - leaving a board on everybody's screen that its own author is not
 * playing.
 */
function open(gameId: GameId, actor: Actor): GameSession | null {
  const rules = gameRules(gameId);
  if (!rules) return null;

  const seats: (GameSeat | null)[] = Array.from({ length: rules.definition.seats }, () => null);
  seats[0] = { userId: actor.userId, username: actor.username };

  return {
    rev: 1,
    gameId,
    seats,
    state: rules.create(),
    round: 1,
    wins: seats.map(() => 0),
    byUserId: actor.userId,
  };
}

/**
 * Applies one action. Returns the new session, or null when there is no longer
 * one - which is what the call is told, and what closes everybody's board.
 *
 * Returning the session unchanged means nobody is told anything, and that is
 * the ordinary answer to a message that raced: a move from the person whose
 * turn it no longer is, a click on a square somebody else just took, a second
 * `sit` in a chair that is now full. None of those is an error worth a round
 * trip - each is a thing that was true when it was sent.
 */
export function apply(
  session: GameSession | null,
  action: GameAction,
  actor: Actor,
): GameSession | null {
  if (action.kind === 'close') return null;

  if (!session) {
    // Opening is the only thing that can happen to nothing. A move arriving
    // after the last person closed the game must not resurrect a board.
    return action.kind === 'open' ? open(action.gameId, actor) : null;
  }

  const next = mutate(session, action, actor);
  if (!next) return null;
  if (next === session) return session;
  return { ...next, rev: session.rev + 1 };
}

function mutate(
  session: GameSession,
  action: GameAction,
  actor: Actor,
): GameSession | null {
  switch (action.kind) {
    case 'open': {
      // Changing the game is allowed to anybody, deliberately, and it is the
      // same argument as the listening queue having no host: a host is a person
      // who eventually leaves and takes the game with them. Re-opening the game
      // already on the table is a no-op rather than a board wipe, because that
      // is a double-click on the library card and not a request to abandon a
      // game in progress.
      if (action.gameId === session.gameId && session.state.moveCount === 0) return session;
      return open(action.gameId, actor);
    }

    case 'sit': {
      const seats = [...session.seats];
      const wins = [...session.wins];
      const current = seats.findIndex((seat) => seat?.userId === actor.userId);

      if (action.seat === -1) {
        // Standing up. The chair stays where it is - its tally goes with it,
        // so somebody who mis-clicks and sits back down has lost nothing.
        if (current === -1) return session;
        seats[current] = null;
        return { ...session, seats };
      }

      if (!Number.isInteger(action.seat) || action.seat < 0 || action.seat >= seats.length) {
        return session;
      }
      if (current === action.seat) return session;
      // Taken. Not an error: two people reaching for the last chair is the
      // ordinary case, and the second of them is simply told who is in it by
      // the state everybody already gets.
      if (seats[action.seat]) return session;

      if (current !== -1) seats[current] = null;
      seats[action.seat] = { userId: actor.userId, username: actor.username };
      // A new person in the chair starts at nothing. The tally belongs to the
      // chair, and inheriting somebody else's three wins by sitting where they
      // sat is a scoreboard that lies.
      if (session.seats[action.seat]?.userId !== actor.userId) wins[action.seat] = 0;
      return { ...session, seats, wins };
    }

    case 'move': {
      const rules = GAMES[session.gameId];
      const seat = session.seats.findIndex((chair) => chair?.userId === actor.userId);
      // Watching. Everybody in the call sees the board and most of them are not
      // playing it, so this is the common case rather than an attack - though
      // it is also the check that stops one.
      if (seat === -1) return session;
      // An empty chair is not an opponent. Without this the person who opened
      // the game could play both sides of it while they waited.
      if (session.seats.some((chair) => chair === null)) return session;

      const state = rules.apply(session.state, seat, action.move);
      // Illegal, or simply late: the rules said no. Saying so back would be a
      // message about a board the sender already has.
      if (!state) return session;

      const wins = [...session.wins];
      // A draw is `-1` and belongs to nobody, which is why this is a bounds
      // check and not a truthiness one - seat 0 winning is falsy.
      if (state.winner !== null && state.winner >= 0) wins[state.winner] = (wins[state.winner] ?? 0) + 1;
      return { ...session, state, wins };
    }

    case 'rematch': {
      // Only from somebody at the table. A watcher clearing a finished game off
      // two other people's screens is not a thing to allow by accident.
      if (!session.seats.some((chair) => chair?.userId === actor.userId)) return session;
      // Mid-game this would be a resignation dressed as a button, so it is
      // refused: the way out of a game in progress is to close it, which says
      // what it does.
      if (session.state.winner === null && session.state.moveCount > 0) return session;
      return {
        ...session,
        state: GAMES[session.gameId].create(),
        round: session.round + 1,
      };
    }

    case 'vacate': {
      // Somebody left the call. Their chair is freed so the game can carry on
      // with whoever takes it, rather than sitting there waiting for a person
      // who has gone. The board is left exactly as it was - a game two people
      // are three moves into is not something to throw away because one of them
      // dropped a socket in a lift.
      const at = session.seats.findIndex((chair) => chair?.userId === action.userId);
      if (at === -1) return session;
      const seats = [...session.seats];
      seats[at] = null;
      return { ...session, seats };
    }

    default:
      return session;
  }
}
