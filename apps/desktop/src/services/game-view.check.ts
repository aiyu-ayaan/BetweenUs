/**
 * Self-check for the player's-eye view of a game session.
 *
 * These are the sentences and the greyed-out squares, and every failure here is
 * one nobody reports as a bug: a "Your move" shown to the person who is not to
 * move reads as latency, a square that looks playable and is refused reads as a
 * broken board, and a game that accepts a move with one chair empty is somebody
 * playing themselves without noticing.
 *
 * Run with `pnpm --filter @betweenus/desktop check`.
 */
import assert from 'node:assert/strict';
import { GAMES, type GameSession } from '@betweenus/shared-types';
import { canPlayMove, seatFor, turnLineFor } from './game-view';

function session(overrides: Partial<GameSession> = {}): GameSession {
  return {
    rev: 3,
    gameId: 'tic-tac-toe',
    seats: [
      { userId: 'ana', username: 'ana' },
      { userId: 'bo', username: 'bo' },
    ],
    state: GAMES['tic-tac-toe'].create(),
    round: 1,
    wins: [0, 0],
    byUserId: 'ana',
    ...overrides,
  };
}

// --- Who am I here ----------------------------------------------------------

assert.equal(seatFor(session(), 'ana'), 0);
assert.equal(seatFor(session(), 'bo'), 1);
// Watching. Most people in a call are, so this is the ordinary answer.
assert.equal(seatFor(session(), 'cai'), -1);
assert.equal(seatFor(null, 'ana'), -1);
// Signed out, or a store that has not loaded the account yet: no seat, and no
// crash on the way to finding that out.
assert.equal(seatFor(session(), null), -1);

// --- What may be clicked ----------------------------------------------------

const fresh = session();
assert.equal(canPlayMove(fresh, 'ana', 4), true);
// Not your turn.
assert.equal(canPlayMove(fresh, 'bo', 4), false);
// Not at the table.
assert.equal(canPlayMove(fresh, 'cai', 4), false);
// Not a square.
assert.equal(canPlayMove(fresh, 'ana', 42), false);

// An empty chair is not an opponent. The gateway refuses this too; refusing it
// here is what stops the board from looking playable while it waits.
const waiting = session({ seats: [{ userId: 'ana', username: 'ana' }, null] });
assert.equal(canPlayMove(waiting, 'ana', 0), false);

// A taken square, and a finished game, are both simply not moves.
const taken = session({
  state: { ...GAMES['tic-tac-toe'].create(), cells: [0, ...Array<number>(8).fill(-1)] },
});
assert.equal(canPlayMove(taken, 'ana', 0), false);
assert.equal(canPlayMove(taken, 'ana', 1), true);

const won = session({ state: { ...GAMES['tic-tac-toe'].create(), winner: 0 } });
assert.equal(canPlayMove(won, 'ana', 0), false);

// --- What it says -----------------------------------------------------------

// Second person for the one to move, third for everybody else - the same line
// has to work for the two people playing and the four watching them.
assert.equal(turnLineFor(fresh, 'ana'), 'Your move');
assert.equal(turnLineFor(fresh, 'bo'), 'ana to move');
assert.equal(turnLineFor(fresh, 'cai'), 'ana to move');

// A chair short: nobody is to move, and saying "ana to move" there is the line
// that makes a waiting board look broken.
assert.equal(turnLineFor(waiting, 'ana'), 'Waiting for one more player');

assert.equal(turnLineFor(won, 'bo'), 'ana wins.');
// A draw belongs to nobody. `-1` next to seat 0 is exactly the confusion this
// asserts against.
const drawn = session({ state: { ...GAMES['tic-tac-toe'].create(), winner: -1 } });
assert.equal(turnLineFor(drawn, 'ana'), 'A draw.');

assert.equal(turnLineFor(null, 'ana'), '');

// A game this build has never heard of says nothing rather than guessing at a
// name for it - the panel draws its own "update to join in" instead.
assert.equal(turnLineFor(session({ gameId: 'chess' as never }), 'ana'), '');

console.log('game-view.check.ts: ok');
