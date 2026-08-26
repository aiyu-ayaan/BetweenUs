/**
 * --- Play Together ---
 *
 * A game two people in a call are playing, and everybody else is watching.
 *
 * The thing to understand before reading the rest: **the rules live here, in
 * the package both sides import.** `call-service` is the referee - it decides
 * whose move it was and what the board became - and every client draws the
 * board from the same functions the referee used. A client that judged a move
 * differently from the gateway would be a game where nobody is wrong and
 * nobody agrees, which is the same failure `listenPositionAt` exists to
 * prevent for a shared position.
 *
 * That is also why the games here are the games they are. A session is
 * broadcast whole, to everybody in the call, so there is no hidden state to
 * hide anything in: a game of Battleship played this way is one where both
 * fleets are in the message. Perfect-information board games fit; anything
 * needing a secret hand needs a server that keeps one, which this is not.
 *
 * And nothing here touches the media path. A move is a number - "column four"
 * - relayed the way an SDP is, which is why this belongs on `/ws/call` and
 * works through a Cloudflare Tunnel. Sharing a screen with a game on it would
 * have been one upload per watcher, a board nobody but the sharer can touch,
 * and the sharer pinned to a window.
 */

/** The games in the library. One id per set of rules. */
export type GameId =
  | 'tic-tac-toe'
  | 'connect-four'
  | 'reversi'
  | 'dots-and-boxes'
  | 'ludo'
  | 'carrom';

/** What a game is called and how many chairs it has. */
export interface GameDefinition {
  id: GameId;
  name: string;
  /** One line, shown on the library card. What it is, not how to play. */
  blurb: string;
  /** How many people play. Everybody else in the call watches. */
  seats: number;
  /** What each seat is called on screen - "X" and "O", "Red" and "Yellow". */
  seatNames: string[];
  /**
   * The colour each seat is drawn in, as a Tailwind-free hex, because the
   * board renderers and the seat rail must agree and there is only one place
   * to say so.
   */
  seatColours: string[];
  /** Roughly how long a game takes, for the card. Cosmetic. */
  length: string;
}

/**
 * A source of randomness, supplied by whoever is refereeing.
 *
 * `() => number` in [0, 1), like `Math.random`. It is a parameter rather than a
 * global so that a rules module stays pure and testable: a check can hand it a
 * sequence and assert on the game that comes out.
 */
export type RandomSource = () => number;

/** Somebody sitting in a seat. Null in `GameSession.seats` means an empty chair. */
export interface GameSeat {
  userId: string;
  username: string;
}

/**
 * A board, mid-game.
 *
 * One shape for every game in the library rather than a union per game, and
 * deliberately: the gateway stores it, broadcasts it and never looks inside
 * it, so a shape it has to discriminate on is a shape it has to know about.
 * The rules module for `gameId` is the only thing that reads the numbers.
 *
 * `cells` is whatever the board is made of - squares in Tic-tac-toe and
 * Reversi, dropped discs in Connect Four, drawn lines in Dots and Boxes - and
 * each entry is the seat that owns it, or -1 for nothing. `boxes` is used by
 * Dots and Boxes alone, where a move claims a line and the *squares* are what
 * is scored; the rest leave it empty.
 */
export interface GameState {
  gameId: GameId;
  cells: number[];
  boxes: number[];
  /**
   * Whatever else the game is made of, in numbers of its own choosing.
   *
   * Two of the games are not grids at all. Ludo is eight token positions, a
   * die and a count of sixes; Carrom is twenty pieces at twenty floating-point
   * positions plus the shot that put them there. Neither fits `cells`, and
   * neither is worth a discriminated union the gateway would then have to know
   * how to discriminate - it stores this, broadcasts it, and never looks
   * inside. Only the rules module for `gameId` reads the numbers.
   */
  data: number[];
  /** The seat to move. */
  turn: number;
  /** The seat that won, -1 for a draw, or null while the game is still on. */
  winner: number | null;
  /** The last cell played, so a board can show what just happened. */
  lastMove: number | null;
  moveCount: number;
}

/**
 * The rules of one game: make a board, list what may be played, play it.
 *
 * Pure, total and synchronous. No clock, no randomness and no I/O, so the
 * referee and four clients running the same move on the same board always get
 * the same board back - which is the whole contract.
 */
export interface GameRules {
  definition: GameDefinition;
  create(): GameState;
  /**
   * Every move the seat to move may make, as indices into whatever `cells`
   * counts. Empty while the game is over, and empty in exactly one other case:
   * a Reversi position where the player to move has nothing legal, which the
   * rules resolve as a pass inside `apply` rather than as a state anybody has
   * to click through.
   */
  moves(state: GameState): number[];
  /**
   * Plays `move` for `seat`, or returns null when that is not a legal thing to
   * do - wrong seat, wrong turn, occupied square, finished game. Null is the
   * gateway's cue to say nothing at all, because an illegal move is a message
   * that raced rather than a thing that happened.
   *
   * `params` carries the part of a move that is not a square. A carrom shot is
   * an aim and a power, which is three numbers rather than one index, and
   * packing them into `move` would be an encoding two sides could disagree
   * about. Games that do not need it ignore it.
   *
   * `random` is the only impurity any game is allowed, and it is passed in
   * rather than reached for: the die is rolled by the *gateway*, so the roll is
   * one number decided in one place. A client that rolled its own would be a
   * client that decides its own sixes. Given the same `random`, this function
   * is as deterministic as the rest.
   */
  apply(
    state: GameState,
    seat: number,
    move: number,
    params?: number[],
    random?: RandomSource,
  ): GameState | null;
  /** How the score reads while a game is on, per seat. Discs, boxes, or coins. */
  score(state: GameState): number[];
  /**
   * True when a move needs numbers the board cannot express as an index - a
   * carrom shot. The client's board supplies them; nothing else changes.
   */
  aimed?: boolean;
  /** True when the gateway must hand `apply` a random source. Ludo's die. */
  chance?: boolean;
}

/**
 * The whole of a game session, as the gateway holds it.
 *
 * Broadcast entire on every change, exactly as a listening session is: it is a
 * few hundred bytes, it changes when somebody presses something rather than
 * continuously, and a client holding a board nobody else has is the failure
 * that cannot be noticed from inside.
 */
export interface GameSession {
  /**
   * Bumped on every change.
   *
   * A client drops any state numbered at or below one it has already applied,
   * so its own echo of a move cannot undo somebody else's later one. The
   * gateway is the only thing that can order two people clicking at the same
   * moment - a mesh has no ordering of its own.
   */
  rev: number;
  gameId: GameId;
  /** Seat index to whoever is in it. `null` is an empty chair anybody may take. */
  seats: (GameSeat | null)[];
  state: GameState;
  /** Games finished in this session, so a rematch reads as the second of three. */
  round: number;
  /**
   * Rounds won per seat, and a draw counts for nobody.
   *
   * Kept per seat rather than per person, and reset for a seat when somebody
   * else sits in it: the tally belongs to the chair. A player who stands up and
   * sits back down in the same chair keeps it, which is what an accidental
   * click should cost.
   */
  wins: number[];
  /** Who opened the session, for the line that says who started it. */
  byUserId: string | null;
}
