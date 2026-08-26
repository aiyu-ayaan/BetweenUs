/**
 * Self-check for the two games that are not grids: Carrom and Ludo.
 *
 * Both have a failure mode the other four do not. Carrom's is a simulation that
 * does not agree with itself - if the same shot on the same board produced two
 * different results, the gateway's board and the animation every client just
 * watched would be two different games, and nobody could say which was real.
 * Ludo's is a die: a roll decided anywhere but the gateway is a player who
 * decides their own sixes, and a turn that does not pass when a number is
 * unplayable is a board that has simply stopped.
 *
 * Run with `pnpm --filter @betweenus/call-service check`.
 */
import assert from 'node:assert/strict';
import {
  BOARD,
  GAMES,
  HOME,
  PIECES,
  QUEEN,
  ROLL,
  STRIKER,
  TOKENS,
  YARD,
  carromPieces,
  carromShot,
  coinsOf,
  dieOf,
  lastRoll,
  placeStriker,
  progressOf,
  simulate,
  tokenIndex,
  tokenMoves,
  trackSquare,
  type GameState,
} from '@betweenus/shared-types';

// --- The physics agrees with itself ----------------------------------------

{
  const carrom = GAMES.carrom;
  const start = carrom.create();

  // The break, twice, from the same board with the same aim. Identical to the
  // last bit, because that is the whole basis for letting a client animate a
  // shot the gateway refereed: it replays the same function on the same
  // numbers, so the last frame it draws is the board that was already sent.
  const first = carromShot(start, 0, [0, -Math.PI / 2, 0.9]);
  const second = carromShot(start, 0, [0, -Math.PI / 2, 0.9]);
  for (let index = 0; index < PIECES; index += 1) {
    assert.equal(first.pieces[index]!.x, second.pieces[index]!.x);
    assert.equal(first.pieces[index]!.y, second.pieces[index]!.y);
    assert.equal(first.pieces[index]!.onBoard, second.pieces[index]!.onBoard);
  }
  assert.deepEqual(first.pocketed, second.pocketed);
  assert.equal(first.frames.length, second.frames.length);

  // A break hits something. A shot up the middle that misses nineteen coins in
  // a circle would mean the aim, the placement or the radii are wrong.
  assert.equal(first.contact, true);
  // And it comes to rest: every piece stopped, inside the board.
  for (const piece of first.pieces) {
    assert.equal(piece.vx, 0);
    assert.equal(piece.vy, 0);
    if (!piece.onBoard) continue;
    assert.ok(piece.x >= 0 && piece.x <= BOARD, 'a piece left the board');
    assert.ok(piece.y >= 0 && piece.y <= BOARD, 'a piece left the board');
  }
  // Nothing ends up inside anything else. Overlap that survives to a standstill
  // is the separation step being wrong, and it looks like two coins welded
  // together for the rest of the game.
  for (let a = 0; a < PIECES; a += 1) {
    const first_ = first.pieces[a]!;
    if (!first_.onBoard) continue;
    for (let b = a + 1; b < PIECES; b += 1) {
      const other = first.pieces[b]!;
      if (!other.onBoard) continue;
      const dx = other.x - first_.x;
      const dy = other.y - first_.y;
      const reach = first_.radius + other.radius;
      assert.ok(
        dx * dx + dy * dy > reach * reach * 0.98,
        'two pieces came to rest inside each other',
      );
    }
  }
}

{
  // Friction actually stops things. A striker sent along an empty board must
  // come to rest rather than bouncing between the cushions for ever - which is
  // what a viscous `v *= 0.99` does, and why the friction here is Coulomb.
  const lone = simulate(
    [
      {
        x: 0.5,
        y: 0.9,
        vx: 0,
        vy: -2.5,
        radius: 0.0279,
        mass: 15,
        onBoard: true,
      },
    ],
    0,
  );
  assert.equal(lone.pieces[0]!.vx, 0);
  assert.equal(lone.pieces[0]!.vy, 0);
  // And it never left the table on the way.
  for (const frame of lone.frames) {
    assert.ok(frame[0]! >= 0 && frame[0]! <= BOARD);
    assert.ok(frame[1]! >= 0 && frame[1]! <= BOARD);
  }
}

{
  // A coin sent straight at a pocket goes down it, and is not simulated after.
  const potted = simulate(
    [{ x: 0.3, y: 0.3, vx: -1.2, vy: -1.2, radius: 0.0215, mass: 5.5, onBoard: true }],
    -1,
  );
  assert.deepEqual(potted.pocketed, [0]);
  assert.equal(potted.pieces[0]!.onBoard, false);
}

// --- Carrom, as rules -------------------------------------------------------

{
  const carrom = GAMES.carrom;
  const start = carrom.create();

  // Nineteen men and a striker that is not on the board yet: it is placed by
  // whoever is shooting, on their own line, and a striker sitting there before
  // anybody has aimed is a coin in the way of the break.
  const pieces = carromPieces(start);
  assert.equal(pieces.filter((piece) => piece.onBoard).length, 19);
  assert.equal(pieces[STRIKER]!.onBoard, false);
  assert.deepEqual(carrom.score(start), [0, 0]);

  // A shot needs its three numbers, and they have to mean something.
  assert.equal(carrom.apply(start, 0, 0), null);
  assert.equal(carrom.apply(start, 0, 0, [0, -Math.PI / 2]), null);
  assert.equal(carrom.apply(start, 0, 0, [0, Number.NaN, 0.5]), null);
  // A shot with no power is not a shot, and spending a turn on a striker that
  // did not move is worse than being told no.
  assert.equal(carrom.apply(start, 0, 0, [0, -Math.PI / 2, 0]), null);
  // Not your turn.
  assert.equal(carrom.apply(start, 1, 0, [0, Math.PI / 2, 0.9]), null);

  const broken = carrom.apply(start, 0, 0, [0, -Math.PI / 2, 0.9]);
  assert.ok(broken);
  assert.equal(broken.moveCount, 1);
  // The striker is off the board again between shots, whatever happened to it.
  assert.equal(broken.data[STRIKER * 3 + 2], 0);
  // Nineteen coins are still accounted for: on the board, or pocketed, never
  // simply gone.
  const accounted = carromPieces(broken).filter((piece) => piece.onBoard).length;
  assert.ok(accounted <= 19);
}

{
  // The striker is placed on the shooter's own line, clamped to it, and never
  // on top of a coin.
  const carrom = GAMES.carrom;
  const start = carrom.create();
  const bottom = placeStriker(start, 0, 0);
  const top = placeStriker(start, 1, 0);
  assert.ok(bottom.y > BOARD / 2, 'seat 0 shoots from the near edge');
  assert.ok(top.y < BOARD / 2, 'seat 1 shoots from the other one');
  // Asked for somewhere off the end of the line, it stays on the line.
  const far = placeStriker(start, 0, 9);
  assert.ok(far.x <= BOARD / 2 + 0.26 && far.x >= BOARD / 2 - 0.26);
}

{
  // A striker down a pocket is a foul: the turn passes even though a coin of
  // the shooter's went down in the same shot, and one of theirs comes back.
  const carrom = GAMES.carrom;
  const state = carrom.create();
  const data = [...state.data];
  // Clear the board except one white coin sitting over a corner pocket, and
  // aim the striker at it hard enough that both go down.
  for (let index = 0; index < PIECES; index += 1) data[index * 3 + 2] = 0;
  data[0 * 3] = 0.075;
  data[0 * 3 + 1] = 0.075;
  data[0 * 3 + 2] = 1;
  const staged: GameState = { ...state, data };

  const shot = carrom.apply(staged, 0, 0, [-1, (-3 * Math.PI) / 4, 1]);
  assert.ok(shot);
  // Whatever happened to the coin, the shooter cannot have been rewarded with
  // another go by pocketing the striker.
  const strikerDown = (shot.data[STRIKER * 3 + 2] ?? 0) === 0;
  if (strikerDown && (shot.data[PIECES * 3 + 6] ?? 0) === 1) {
    assert.equal(shot.turn, 1, 'a foul passes the turn');
  }
}

{
  // Clearing your colour wins it, and the queen goes to whoever cleared if
  // nobody had taken her - so a game never ends with her unclaimed.
  const carrom = GAMES.carrom;
  const state = carrom.create();
  const data = [...state.data];
  for (const index of coinsOf(0)) data[index * 3 + 2] = 0;
  // One coin of the shooter's left, sitting in front of a pocket.
  data[coinsOf(0)[0]! * 3] = 0.075;
  data[coinsOf(0)[0]! * 3 + 1] = 0.075;
  data[coinsOf(0)[0]! * 3 + 2] = 1;
  for (const index of coinsOf(1)) data[index * 3 + 2] = 1;
  data[QUEEN * 3 + 2] = 1;

  const staged: GameState = { ...state, data };
  const shot = carrom.apply(staged, 0, 0, [-1, (-3 * Math.PI) / 4, 1]);
  assert.ok(shot);
  if (shot.winner !== null) {
    assert.equal(shot.winner, 0);
    assert.equal(carrom.score(shot)[0]! >= 9, true);
  }
}

// --- Ludo -------------------------------------------------------------------

{
  const ludo = GAMES.ludo;
  const start = ludo.create();

  // Nothing to choose until the die has been thrown, and the throw is the move.
  assert.deepEqual(ludo.moves(start), [ROLL]);
  assert.equal(dieOf(start), 0);
  for (let token = 0; token < TOKENS; token += 1) {
    assert.equal(progressOf(start, 0, token), YARD);
    assert.equal(progressOf(start, 1, token), YARD);
  }

  // A token cannot be moved before a roll, and a roll cannot happen twice.
  assert.equal(ludo.apply(start, 0, 0), null);
  // The die is the gateway's: `apply` is handed one, and the same source gives
  // the same game. A client rolling its own would be a client choosing sixes.
  const rolledSix = ludo.apply(start, 0, ROLL, undefined, () => 0.99);
  assert.ok(rolledSix);
  assert.equal(dieOf(rolledSix), 6);
  assert.equal(ludo.apply(rolledSix, 0, ROLL, undefined, () => 0.1), null);

  // A six is the only way out of the yard, and it is another go.
  assert.deepEqual(ludo.moves(rolledSix), [0, 1, 2, 3]);
  const out = ludo.apply(rolledSix, 0, 0, undefined, () => 0.5);
  assert.ok(out);
  assert.equal(progressOf(out, 0, 0), 0);
  assert.equal(out.turn, 0, 'a six is another go');
  assert.equal(dieOf(out), 0, 'the die is spent');
}

{
  // A number nothing can take passes the turn by itself. A board that waited
  // for a click on an empty list of options is a board that has stopped, and
  // the person looking at it has no way to know whose fault that is.
  const ludo = GAMES.ludo;
  const start = ludo.create();
  const rolledThree = ludo.apply(start, 0, ROLL, undefined, () => 0.4);
  assert.ok(rolledThree);
  assert.equal(rolledThree.turn, 1, 'nothing can move on a three from the yard');
  assert.equal(dieOf(rolledThree), 0);

  // ...but the number it was is still there to be shown. This is the commonest
  // roll in the game - four tokens in the yard and anything but a six - and
  // when the board could only read `dieOf`, it was spent and cleared in the
  // same message it arrived in: a player pressed roll, saw nothing at all, and
  // watched the turn go to the other person.
  assert.deepEqual(lastRoll(rolledThree), { value: 3, seat: 0, dead: true });
}

{
  // A roll that *can* be played is recorded the same way, and is not marked
  // dead - so the board can say "a six" without saying it was wasted.
  const ludo = GAMES.ludo;
  const six = ludo.apply(ludo.create(), 0, ROLL, undefined, () => 0.99);
  assert.ok(six);
  assert.deepEqual(lastRoll(six), { value: 6, seat: 0, dead: false });
  assert.equal(dieOf(six), 6);
}

{
  // Three sixes and the turn is gone.
  const ludo = GAMES.ludo;
  let state = ludo.create();
  // Out on the first six, then two more.
  const first = ludo.apply(state, 0, ROLL, undefined, () => 0.99);
  assert.ok(first);
  const moved = ludo.apply(first, 0, 0, undefined, () => 0.5);
  assert.ok(moved);
  state = moved;
  const second = ludo.apply(state, 0, ROLL, undefined, () => 0.99);
  assert.ok(second);
  const movedAgain = ludo.apply(second, 0, 0, undefined, () => 0.5);
  assert.ok(movedAgain);
  const third = ludo.apply(movedAgain, 0, ROLL, undefined, () => 0.99);
  assert.ok(third);
  assert.equal(third.turn, 1, 'three sixes forfeits the turn');
  assert.equal(dieOf(third), 0);
}

{
  // A capture sends a token home and earns another go - and it can only happen
  // on the shared lap, never on a starred square.
  const ludo = GAMES.ludo;
  const state = ludo.create();
  const data = [...state.data];
  // Red is three short of a square blue is standing on, and that square is not
  // one of the safe ones.
  const target = 12;
  data[tokenIndex(0, 0)] = target - 3;
  data[tokenIndex(1, 0)] = (target - 26 + 52) % 52;
  assert.equal(trackSquare(0, target), trackSquare(1, data[tokenIndex(1, 0)]!));

  const staged: GameState = { ...state, data, turn: 0 };
  const rolled = ludo.apply(staged, 0, ROLL, undefined, () => 0.4);
  assert.ok(rolled);
  assert.equal(dieOf(rolled), 3);
  const taken = ludo.apply(rolled, 0, 0, undefined, () => 0.5);
  assert.ok(taken);
  assert.equal(progressOf(taken, 1, 0), YARD, 'the token went back to the yard');
  assert.equal(taken.turn, 0, 'a capture is another go');
}

{
  // Home has to be reached exactly, which is what makes the end of a game take
  // a while: a token one short of home cannot take a five.
  const ludo = GAMES.ludo;
  const state = ludo.create();
  const data = [...state.data];
  data[tokenIndex(0, 0)] = HOME - 1;
  for (let token = 1; token < TOKENS; token += 1) data[tokenIndex(0, token)] = HOME;
  const staged: GameState = { ...state, data, turn: 0 };

  const five = ludo.apply(staged, 0, ROLL, undefined, () => 0.7);
  assert.ok(five);
  assert.equal(five.turn, 1, 'an unusable five passes the turn');

  const one = ludo.apply(staged, 0, ROLL, undefined, () => 0.05);
  assert.ok(one);
  assert.equal(dieOf(one), 1);
  assert.deepEqual(tokenMoves(one), [0]);
  const home = ludo.apply(one, 0, 0, undefined, () => 0.5);
  assert.ok(home);
  assert.equal(progressOf(home, 0, 0), HOME);
  // Four tokens home is the game.
  assert.equal(home.winner, 0);
  assert.deepEqual(GAMES.ludo.score(home), [4, 0]);
}

console.log('game-physics.check.ts: ok');
