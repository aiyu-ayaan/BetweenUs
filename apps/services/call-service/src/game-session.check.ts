/**
 * Self-check for Play Together: the referee, and the four sets of rules it
 * referees with.
 *
 * The failures here are the ones that look like somebody cheating. A move
 * accepted from the wrong seat is an opponent who plays twice. A turn that
 * alternates through a closed box in Dots and Boxes is a chain that scores for
 * the wrong person. A Reversi position where neither player can move and the
 * game does not end is a board two people stare at waiting for the other one.
 * None of them throws, and none of them can be told from a rules disagreement
 * by the people playing.
 *
 * Run with `pnpm --filter @betweenus/call-service check`.
 */
import assert from 'node:assert/strict';
import {
  GAMES,
  boxLines,
  connectFourAt,
  flips,
  horizontal,
  movesFor,
  reversiAt,
  vertical,
  type GameSession,
} from '@betweenus/shared-types';
import { apply } from './game-session';

const ANA = { userId: 'ana', username: 'ana' };
const BO = { userId: 'bo', username: 'bo' };
const CAI = { userId: 'cai', username: 'cai' };

/** A session with both chairs filled, which is the only state a game plays in. */
function seated(gameId: keyof typeof GAMES): GameSession {
  const opened = apply(null, { kind: 'open', gameId }, ANA);
  assert.ok(opened);
  const full = apply(opened, { kind: 'sit', seat: 1 }, BO);
  assert.ok(full);
  return full;
}

// --- Opening and sitting ----------------------------------------------------

const opened = apply(null, { kind: 'open', gameId: 'tic-tac-toe' }, ANA);
assert.ok(opened);
// Opening sits the opener down. Two actions to express one intention is one
// action too many, and the second is the one people forget - which leaves a
// board on everybody's screen that its own author is not playing.
assert.equal(opened.seats[0]?.userId, 'ana');
assert.equal(opened.seats[1], null);
assert.equal(opened.rev, 1);
assert.equal(opened.round, 1);
assert.deepEqual(opened.wins, [0, 0]);

// Anything but `open` against nothing stays nothing: a move that arrives after
// the last person closed the game must not resurrect a board.
assert.equal(apply(null, { kind: 'move', move: 0 }, ANA), null);
assert.equal(apply(null, { kind: 'sit', seat: 0 }, ANA), null);
assert.equal(apply(null, { kind: 'rematch' }, ANA), null);

// A game unknown to this build is refused rather than crashed into: an older
// client, or a newer one, is a thing that will happen.
assert.equal(apply(null, { kind: 'open', gameId: 'chess' as never }, ANA), null);

// Re-opening the game already on an untouched table changes nothing - that is a
// double-click on the library card, not a request to start again.
assert.equal(apply(opened, { kind: 'open', gameId: 'tic-tac-toe' }, ANA), opened);

const bothSeated = seated('tic-tac-toe');
assert.equal(bothSeated.seats[1]?.userId, 'bo');
assert.equal(bothSeated.rev, 2);

// The chair is taken. The third person is told so by the state everybody
// already has, rather than by an error nobody has anywhere to put.
assert.equal(apply(bothSeated, { kind: 'sit', seat: 1 }, CAI), bothSeated);
// And sitting where you already sit is not a change either.
assert.equal(apply(bothSeated, { kind: 'sit', seat: 1 }, BO), bothSeated);

// Standing up frees the chair and leaves the board alone.
const stood = apply(bothSeated, { kind: 'sit', seat: -1 }, BO);
assert.ok(stood);
assert.equal(stood.seats[1], null);
assert.equal(stood.state.moveCount, 0);
// A watcher standing up is not a change.
assert.equal(apply(stood, { kind: 'sit', seat: -1 }, CAI), stood);

// --- Who may move -----------------------------------------------------------

// One player is not a game. Without this the person who opened it could play
// both sides while they waited for somebody to join.
assert.equal(apply(opened, { kind: 'move', move: 0 }, ANA), opened);

// Watching is the common case - everybody in the call sees the board - so a
// move from somebody with no chair is ignored rather than treated as an attack,
// though it is the check that stops one.
assert.equal(apply(bothSeated, { kind: 'move', move: 0 }, CAI), bothSeated);

// Out of turn, from a real player, is the same answer.
assert.equal(apply(bothSeated, { kind: 'move', move: 0 }, BO), bothSeated);

const played = apply(bothSeated, { kind: 'move', move: 4 }, ANA);
assert.ok(played);
assert.equal(played.state.cells[4], 0);
assert.equal(played.state.turn, 1);
assert.equal(played.state.lastMove, 4);
assert.equal(played.rev, bothSeated.rev + 1);

// The square is gone. A second click on it - a double click, or somebody who
// did not see the first - is a message that raced, not a move.
assert.equal(apply(played, { kind: 'move', move: 4 }, BO), played);
// So is a square that is not on the board.
assert.equal(apply(played, { kind: 'move', move: 9 }, BO), played);
assert.equal(apply(played, { kind: 'move', move: -1 }, BO), played);
assert.equal(apply(played, { kind: 'move', move: 1.5 }, BO), played);

// --- Tic-tac-toe ------------------------------------------------------------

{
  // X down the top row against O in the middle row: 0, 3, 1, 4, 2.
  let session = seated('tic-tac-toe');
  for (const [actor, move] of [
    [ANA, 0],
    [BO, 3],
    [ANA, 1],
    [BO, 4],
    [ANA, 2],
  ] as const) {
    const next = apply(session, { kind: 'move', move }, actor);
    assert.ok(next);
    session = next;
  }
  assert.equal(session.state.winner, 0);
  assert.deepEqual(session.wins, [1, 0]);
  // A finished board takes no more moves.
  assert.equal(apply(session, { kind: 'move', move: 5 }, BO), session);

  // A rematch keeps the chairs and the tally, and counts the round.
  const again = apply(session, { kind: 'rematch' }, BO);
  assert.ok(again);
  assert.equal(again.round, 2);
  assert.deepEqual(again.wins, [1, 0]);
  assert.equal(again.state.moveCount, 0);
  assert.equal(again.state.winner, null);
  assert.equal(again.seats[0]?.userId, 'ana');

  // Mid-game it is refused: that would be a resignation dressed as a button,
  // and the way out of a game in progress is to close it.
  const started = apply(again, { kind: 'move', move: 0 }, ANA);
  assert.ok(started);
  assert.equal(apply(started, { kind: 'rematch' }, ANA), started);
  // And a watcher may not clear two other people's board even when it is over.
  assert.equal(apply(session, { kind: 'rematch' }, CAI), session);
}

{
  // A full board with no line is a draw, and it belongs to nobody: the tally
  // must not move. `winner` of -1 is falsy-adjacent to seat 0, which is exactly
  // the bug this asserts against.
  let session = seated('tic-tac-toe');
  for (const [actor, move] of [
    [ANA, 0],
    [BO, 1],
    [ANA, 2],
    [BO, 4],
    [ANA, 3],
    [BO, 5],
    [ANA, 7],
    [BO, 6],
    [ANA, 8],
  ] as const) {
    const next = apply(session, { kind: 'move', move }, actor);
    assert.ok(next);
    session = next;
  }
  assert.equal(session.state.winner, -1);
  assert.deepEqual(session.wins, [0, 0]);
}

// --- Connect Four -----------------------------------------------------------

{
  // The move is a column, and that is the whole point: two people pressing the
  // same column stack, rather than racing for one hole.
  let session = seated('connect-four');
  const first = apply(session, { kind: 'move', move: 3 }, ANA);
  assert.ok(first);
  assert.equal(first.state.cells[connectFourAt(5, 3)], 0);
  const second = apply(first, { kind: 'move', move: 3 }, BO);
  assert.ok(second);
  assert.equal(second.state.cells[connectFourAt(4, 3)], 1);
  assert.equal(second.state.cells[connectFourAt(5, 3)], 0);

  // Red takes columns 0-3 along the bottom; yellow answers in 4 each time.
  session = seated('connect-four');
  for (const [actor, move] of [
    [ANA, 0],
    [BO, 4],
    [ANA, 1],
    [BO, 4],
    [ANA, 2],
    [BO, 4],
    [ANA, 3],
  ] as const) {
    const next = apply(session, { kind: 'move', move }, actor);
    assert.ok(next);
    session = next;
  }
  assert.equal(session.state.winner, 0);
  assert.deepEqual(session.wins, [1, 0]);
}

{
  // A full column is not a move. It is the one illegal thing in this game that
  // a player can reach for by accident, so it is ignored rather than an error.
  let state = GAMES['connect-four'].create();
  for (let i = 0; i < 6; i += 1) {
    const next = GAMES['connect-four'].apply(state, state.turn, 0);
    assert.ok(next);
    state = next;
  }
  assert.equal(GAMES['connect-four'].apply(state, state.turn, 0), null);
  assert.ok(!GAMES['connect-four'].moves(state).includes(0));
}

// --- Reversi ----------------------------------------------------------------

{
  const rules = GAMES.reversi;
  const start = rules.create();
  // The opening four, and black to move with exactly four legal squares.
  assert.deepEqual(rules.score(start), [2, 2]);
  assert.equal(rules.moves(start).length, 4);

  // Capturing nothing is not a move, however empty the square is.
  assert.equal(rules.apply(start, 0, reversiAt(0, 0)), null);
  assert.equal(flips(start.cells, 0, reversiAt(0, 0)).length, 0);

  const played = rules.apply(start, 0, reversiAt(2, 3));
  assert.ok(played);
  // One disc placed, one turned over: black is three up, white one down.
  assert.deepEqual(rules.score(played), [4, 1]);
  assert.equal(played.turn, 1);
}

{
  // The pass. A position where white has nothing to play hands the turn
  // straight back to black rather than sitting there asking white for a move
  // they cannot make - a rule that is obvious at a table and invisible on a
  // screen, which is why it is in the rules and not behind a button.
  //
  // Black plays (0,0) and turns the two whites on the top row over. The only
  // white left is the one at (6,0), tucked against the bottom edge where every
  // line that could reach it starts off the board.
  const cells = Array<number>(64).fill(-1);
  cells[reversiAt(0, 1)] = 1;
  cells[reversiAt(0, 2)] = 1;
  cells[reversiAt(0, 3)] = 0;
  cells[reversiAt(6, 0)] = 1;
  cells[reversiAt(7, 0)] = 0;
  const state = {
    gameId: 'reversi' as const,
    cells,
    boxes: [],
    data: [],
    turn: 0,
    winner: null,
    lastMove: null,
    moveCount: 0,
  };

  const next = GAMES.reversi.apply(state, 0, reversiAt(0, 0));
  assert.ok(next);
  assert.deepEqual(movesFor(next.cells, 1), []);
  // Black played, white cannot answer, so it is black's move again - and the
  // game is not over, because black still has somewhere to go.
  assert.equal(next.turn, 0);
  assert.equal(next.winner, null);
  assert.ok(GAMES.reversi.moves(next).includes(reversiAt(5, 0)));
}

{
  // Neither side can move: the game ends there and is scored on discs, not on
  // whose turn it was. Here black takes the last two white discs off the board,
  // which leaves white with nothing to play and black with nothing to take.
  const cells = Array<number>(64).fill(-1);
  cells[reversiAt(0, 1)] = 1;
  cells[reversiAt(0, 2)] = 1;
  cells[reversiAt(0, 3)] = 0;
  const state = {
    gameId: 'reversi' as const,
    cells,
    boxes: [],
    data: [],
    turn: 0,
    winner: null,
    lastMove: null,
    moveCount: 0,
  };
  const next = GAMES.reversi.apply(state, 0, reversiAt(0, 0));
  assert.ok(next);
  assert.deepEqual(GAMES.reversi.score(next), [4, 0]);
  assert.deepEqual(GAMES.reversi.moves(next), []);
  assert.equal(next.winner, 0);
}

// --- Dots and Boxes ---------------------------------------------------------

{
  const rules = GAMES['dots-and-boxes'];
  let state = rules.create();
  // Three sides of the top-left box, alternating - nothing is claimed, so the
  // turn alternates with it.
  for (const line of [horizontal(0, 0), horizontal(1, 0), vertical(0, 0)]) {
    const next = rules.apply(state, state.turn, line);
    assert.ok(next);
    state = next;
  }
  assert.deepEqual(rules.score(state), [0, 0]);

  // The fourth side closes it, and closing means going again. This is the whole
  // game: a chain of boxes is a run of moves, and a reducer that alternated the
  // turn regardless would score the chain for the wrong person.
  const seat = state.turn;
  const closed = rules.apply(state, seat, vertical(0, 1));
  assert.ok(closed);
  assert.equal(closed.boxes[0], seat);
  assert.equal(closed.turn, seat);
  assert.equal(rules.score(closed)[seat], 1);

  // A line already drawn is not a move.
  assert.equal(rules.apply(closed, closed.turn, vertical(0, 1)), null);
  // Every box has four sides and every side is a real line.
  assert.equal(new Set(boxLines(0, 0)).size, 4);
}

{
  // A finished board is scored, and the winner is the one with more squares -
  // not the one who drew the last line.
  const rules = GAMES['dots-and-boxes'];
  let state = rules.create();
  let guard = 0;
  while (state.winner === null) {
    const moves = rules.moves(state);
    assert.ok(moves.length > 0);
    const next = rules.apply(state, state.turn, moves[0]!);
    assert.ok(next);
    state = next;
    guard += 1;
    assert.ok(guard <= 40, 'a 5x5 board has forty lines and cannot take more');
  }
  const [blue, green] = rules.score(state);
  assert.equal(blue! + green!, 16);
  assert.equal(state.winner, blue === green ? -1 : blue! > green! ? 0 : 1);
}

// --- Leaving and closing ----------------------------------------------------

{
  let session = seated('connect-four');
  const moved = apply(session, { kind: 'move', move: 0 }, ANA);
  assert.ok(moved);
  session = moved;

  // Bo leaves the call. The chair is freed so somebody else can take it; the
  // board is left exactly as it was, because a person who dropped a socket in a
  // lift has not resigned a game three moves in.
  const left = apply(session, { kind: 'vacate', userId: 'bo' }, BO);
  assert.ok(left);
  assert.equal(left.seats[1], null);
  assert.equal(left.state.moveCount, 1);
  assert.equal(left.state.cells.filter((owner) => owner !== -1).length, 1);

  // Vacating somebody who was only watching changes nothing.
  assert.equal(apply(left, { kind: 'vacate', userId: 'cai' }, CAI), left);

  // The new arrival starts at zero wins even in a chair that had some.
  const withWins: GameSession = { ...left, wins: [2, 3] };
  const took = apply(withWins, { kind: 'sit', seat: 1 }, CAI);
  assert.ok(took);
  assert.deepEqual(took.wins, [2, 0]);

  // Closing is for everybody, and anybody in the call may do it - including
  // somebody watching, because a board left behind by two people who wandered
  // off is otherwise on the screen until the call ends.
  assert.equal(apply(took, { kind: 'close' }, CAI), null);
}

console.log('game-session.check.ts: ok');
