---
sidebar_position: 8
---

# Play Together

Two people in a voice channel with the same board in front of them, and
everybody else in the call watching it. Four games in a library, a chair each,
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
  apply(state, seat, move): GameState | null;   // null = not a legal move
  score(state: GameState): number[];
}
```

Pure, total, synchronous. No clock, no randomness, no I/O — so the referee and
four clients running the same move on the same board always get the same board.

## Why these four games

Tic-tac-toe, Connect Four, Reversi and Dots and Boxes. All of them
**perfect information**, and that is a consequence rather than a taste.

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
| The referee (pure) | `apps/services/call-service/src/game-session.ts` |
| Its self-check | `apps/services/call-service/src/game-session.check.ts` |
| Gateway wiring | `apps/services/call-service/src/call.gateway.ts` |
| The client's store | `apps/desktop/src/stores/game.ts` |
| Your seat, your turn, your greyed-out square | `apps/desktop/src/services/game-view.ts` |
| Its self-check | `apps/desktop/src/services/game-view.check.ts` |
| The panel and the library | `apps/desktop/src/features/voice/GamePanel.tsx` |
| The four boards | `apps/desktop/src/features/voice/GameBoards.tsx` |

## Adding a fifth game

One file in `packages/shared-types/src/games/` exporting a `GameRules`, one
line in the registry, one case in `GameBoard`. The gateway needs no change at
all — it looks the rules up by id and referees whatever it finds.

The two things to get right are the ones the existing four already show: make
the *move* the thing the player means (a column, not a square, when a column is
what they clicked), and let the rules decide whose turn is next rather than
alternating it.

## A single replica, for now

The board is held in process, exactly like the call roster and the listening
session. Two `call-service` replicas would each referee half a game. The
upgrade path is the one `presence-service` already uses — the roster in Redis,
this state beside it — and it is the same change, made once, for all three.
