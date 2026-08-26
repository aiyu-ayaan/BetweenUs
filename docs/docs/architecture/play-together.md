---
sidebar_position: 8
---

# Play Together

Two people in a voice channel with the same board in front of them, and
everybody else in the call watching it. Six games in a library, a chair each,
and a rematch button.

It is [Listen Together](/architecture/listen-together) with a board instead of
a queue, and it is built the same way for the same reason: what crosses the
wire is a move, not a picture.

## The idea, in one paragraph

**A move is a number.** "Column four." `call-service` applies the rules of
whichever game is on the table, works out what the board became, and broadcasts
it to everybody in the call. That is a few hundred bytes when somebody clicks,
and nothing at all in between — signalling, so it goes down `/ws/call` beside
the SDP and through a Cloudflare Tunnel like everything else.

```text
   Client A                                            Client B
      │                                                    │
      │  /ws/call: "column 4"                              │
      └──────────────►  call-service  ◄────────────────────┘
                    (the rules, the ordering, the board)
                              │
                    "here is the board now"
      │                                                    │
      ▼                                                    ▼
   draws it                                           draws it
```

## Why not share a screen with a game on it

The same five answers as the music, plus one that matters more:

| Sharing a screen | Play Together |
| --- | --- |
| One video **upload per watcher** from the sharer | Zero uplink |
| The board re-encoded, at whatever the link allows | Crisp, drawn locally |
| The sharer cannot alt-tab away | Nobody has to keep a window open |
| Only the sharer can touch it | **Both players play** |
| Watchers see a video of a game | Watchers see the game |

The fourth row is the one that makes this a feature rather than a
demonstration. A shared screen is a game one person plays while somebody else
watches a recording of it.

## The gateway is the referee

The client sends what was clicked. It never sends a board.

This is the whole security model, and it is one sentence long: a board a client
can set is a board a client can set to *won*. So `call-service` holds the
position, applies the move with the rules, and everybody — including the person
who clicked — draws what came back.

It is also the ordering. Two people clicking the same square within a moment of
each other need a single answer, and a peer-to-peer mesh has no ordering of its
own to give one. The gateway holds the sockets, so it is the only thing that
can say which click was second. That is the same argument that puts the
screen-share claim and the listening session's pause there, made a third time.

## The rules live in the contract

`packages/shared-types/src/games/` holds the rules, and **both sides import
them**. The gateway referees with them; every client greys out squares with
them.

That is not code sharing for its own sake. A client that judged a move
differently from the referee would be a game where nobody is wrong and nobody
agrees — the same failure `listenPositionAt` exists to prevent for a shared
position, which is why it lives in the same package for the same reason.

```ts
interface GameRules {
  definition: GameDefinition;         // name, chairs, colours
  create(): GameState;
  moves(state: GameState): number[];  // what may be played now
  // `params` is the part of a move an index cannot carry - a carrom shot.
  // `random` is the die, and it comes from the referee.
  apply(state, seat, move, params?, random?): GameState | null;  // null = illegal
  score(state: GameState): number[];
}
```

Pure, total, synchronous. No clock, no I/O, and no randomness of their own — so
the referee and four clients running the same move on the same board, with the
same `random`, always get the same board.

## A move that is not a square

Four of the six games move by naming a square. Two do not, and the contract
carries both:

- **`params`** — extra numbers on a move. A carrom shot is *where the striker
  sits, which way it points and how hard it is hit*: three numbers, sent
  alongside the move rather than packed into it, because a packing is an
  encoding two ends can disagree about. The gateway bounds and cleans them
  before the rules ever see them — this is the one field a client fills in with
  real numbers, and it goes straight into a physics loop.
- **`random`** — a source of chance, *passed to* the rules by whoever is
  refereeing. Ludo's die is rolled by `call-service`, with `randomInt` rather
  than `Math.random`, and arrives in the board like any other change. A client
  that rolled its own would be a client deciding its own sixes.
- **`GameState.data`** — whatever numbers a game is actually made of, for the
  games that are not grids. Ludo is eight token positions, a die and a count of
  sixes. Carrom is twenty pieces at twenty floating-point positions plus the
  shot that put them there. The gateway stores it, broadcasts it, and never
  looks inside.

## Carrom, and why the physics is in the contract

The board is a real simulation: Coulomb friction (a coin loses speed at a
constant rate and *stops* — a `v *= 0.99` never quite does), restitution off
coins and cushions, mass ratios from a real board, and a pocket that takes a
piece when its centre crosses it. The sizes are a 74 cm board's: 3.18 cm men,
4.13 cm striker, 4.45 cm pockets, in fractions of the playing surface.

It lives in `packages/shared-types/src/games/carrom-physics.ts` because **both
ends run it**:

```text
  client                     gateway                      client
    │  "striker at -0.2,        │                            │
    │   this angle, 0.8 power"  │                            │
    ├──────────────────────────►│                            │
    │                    simulate() ──► the board            │
    │◄──────────── game.state ──┴──────────────────────────►│
    │                                                        │
 simulate() the same shot                          simulate() the same shot
 and draw the frames                               and draw the frames
```

What a client animates is therefore not an impression of the shot — it *is* the
shot, replayed, and its last frame is the board the gateway already sent. That
only works because the simulation is deterministic: fixed timestep, fixed
iteration order, no clock, no randomness, and no floating-point that depends on
how fast a machine is.

The alternative was tweening twenty coins from their old positions to their new
ones, which is twenty coins sliding through each other in straight lines.

The aim is a flick *forward*: you press where the striker should go, and how far
out you press is how hard it is hit. The first version pulled backwards like a
catapult — the gesture a pool game teaches — which is not the gesture anybody's
hand has for a carrom board.

## Ludo, and who rolls the die

The die is the only thing in the library that nobody at the table decides, so
it is worth being exact: **the gateway rolls.** A roll is a move — "I roll" —
and the number comes back in the board.

What the board draws is the *last roll* - the number, who threw it, and whether
anything could take it - rather than the die the rules are waiting to have
spent. Those are different, and the difference was a real bug: with four tokens
in the yard, anything but a six is unplayable, so the die was cleared and the
turn passed in the same message it arrived in. A board reading the pending die
had nothing to show, and pressing roll looked like pressing nothing.

The tumbling die on screen is started by the *arrival* of that number, not by
the button that asked for it. A die animated first and reported afterwards is a
client deciding its own sixes; a die animated to a different number than the one
in play is worse, because both players would be reading a different game off the
same screen.

Two players, four tokens each, for now. Four-seat ludo needs the turn to skip
empty chairs, and the rules cannot see chairs — they are handed a board, not a
table — so it is a change to the session rather than to the rules.

## Why these games

All six are **perfect information**, and that is a consequence rather than a
taste.

The session is broadcast whole to everybody in the call, so there is nowhere to
hide anything: a game of Battleship played this way is one where both fleets
are in the message every client receives. Hidden-hand games need a server that
keeps a secret per player and sends each of them a different view, which is a
different feature with a different shape.

Each one also earns its place:

- **Tic-tac-toe** is the one everybody already knows, so it is the game that
  proves the machinery. Two people can tell within a move whether the turn
  order and the "your move" line are right.
- **Connect Four** takes a *column*, not a square. This is the one thing in the
  library that had to be right: two people clicking the same column must stack
  two discs, never race for one hole. Sending a square would make that a race
  the gateway cannot see — it would receive two legal-looking placements.
  Sending a column makes the drop happen *after* the ordering.
- **Reversi** has a pass. A player with no legal move does not sit there being
  asked for one; the rules hand the turn straight back. Left to a button, it is
  a game that deadlocks on the person who does not know to press it.
- **Dots and Boxes** gives another go for a closed square, which is the whole
  endgame — and the rule an "alternate the turn" reducer silently loses,
  scoring a five-box chain for the wrong person.
- **Ludo** is the one with chance in it, which is what proves that a random
  number can live in this design at all: it belongs to the referee, like the
  ordering does.
- **Carrom** is the one where the move is continuous rather than discrete, and
  the board is decided by a simulation instead of by a rule. It is also the
  proof that "the rules live in the contract" was worth the trouble: the same
  sentence covers a physics engine.

## The chairs

Everybody in the call sees the board; two of them are playing it.

- Anybody may **open a game**, and opening it sits you in the first chair.
  Otherwise the second half of the intention — actually sitting down — is the
  half people forget, and the board arrives with nobody at it.
- Anybody may **take an empty chair**. Two people reaching for the last one is
  ordinary, and the second of them is simply told who is in it by the state
  everybody already receives, rather than by an error.
- **No moves until every chair is full.** A board that accepted moves with one
  player is somebody playing themselves without noticing.
- **A leaver's chair is freed** on exactly the same terms their peer seat is —
  after the rejoin grace, so a phone that loses its socket in a lift does not
  hand its game away mid-move. The board is left standing: a dropped socket is
  not a resignation.
- **The tally belongs to the chair**, and resets when somebody else sits in it.
  Standing up and sitting back down in the same seat costs nothing, which is
  what a mis-click should cost.

There is no host, for the same reason the listening queue has none: a host is a
person who eventually leaves and takes the game with them.

## Nothing is played locally

A click sends a move and waits. There is no optimistic placement anywhere in
the client, deliberately: a board that showed a disc before it was refereed
would show a different game to the person who played it for the length of a
round trip, and *"mine was there a second ago"* is the one thing a shared board
must never do.

What the client does do with the shared rules is refuse a click that cannot be
played — so a square that is going to be ignored looks like one before it is
pressed. That is not the permission check. The gateway's is.

## What it deliberately does not do

- **No hidden information.** See above; it follows from broadcasting the whole
  session.
- **No AI opponent.** This is a thing to do with somebody, in a call. A game
  against the machine is a different product.
- **No persistence.** The session lives in memory beside the roster and dies
  with the call, like the listening queue. Three rounds of Connect Four while
  two people waited for a build has no meaning tomorrow.
- **No move timer, no clock.** Everybody is already in a call and can say
  "your move".
- **Nothing on Android yet.** The protocol is there and the rules are in a
  package the Android client does not use; drawing four boards in Compose is
  the work. See [Android client](/architecture/android-client).

## Where the code is

| Piece | File |
| --- | --- |
| Protocol, session shape | `packages/shared-types/src/index.ts` |
| The rules of the games (pure, shared) | `packages/shared-types/src/games/` |
| The carrom simulation (pure, shared) | `packages/shared-types/src/games/carrom-physics.ts` |
| Carrom rules, queen and fouls | `packages/shared-types/src/games/carrom.ts` |
| Ludo rules and the die | `packages/shared-types/src/games/ludo.ts` |
| Ludo and carrom self-check | `apps/services/call-service/src/game-physics.check.ts` |
| The carrom board and its replay | `apps/desktop/src/features/voice/CarromBoard.tsx` |
| The ludo board and its die | `apps/desktop/src/features/voice/LudoBoard.tsx` |
| The sidebar menus behind both buttons | `apps/desktop/src/features/voice/ActivityMenu.tsx` |
| The referee (pure) | `apps/services/call-service/src/game-session.ts` |
| Its self-check | `apps/services/call-service/src/game-session.check.ts` |
| Gateway wiring | `apps/services/call-service/src/call.gateway.ts` |
| The client's store | `apps/desktop/src/stores/game.ts` |
| Your seat, your turn, your greyed-out square | `apps/desktop/src/services/game-view.ts` |
| Its self-check | `apps/desktop/src/services/game-view.check.ts` |
| The panel and the library | `apps/desktop/src/features/voice/GamePanel.tsx` |
| The four boards | `apps/desktop/src/features/voice/GameBoards.tsx` |

## Adding a seventh game

One file in `packages/shared-types/src/games/` exporting a `GameRules`, one
line in the registry, one case in `GameBoard`. The gateway needs no change at
all — it looks the rules up by id and referees whatever it finds, `params`,
`random` and `data` included.

The two things to get right are the ones the existing four already show: make
the *move* the thing the player means (a column, not a square, when a column is
what they clicked), and let the rules decide whose turn is next rather than
alternating it.

## A single replica, for now

The board is held in process, exactly like the call roster and the listening
session. Two `call-service` replicas would each referee half a game. The
upgrade path is the one `presence-service` already uses — the roster in Redis,
this state beside it — and it is the same change, made once, for all three.
