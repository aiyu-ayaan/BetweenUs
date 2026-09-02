package com.aatech.betweenus.core.store

import com.aatech.betweenus.core.data.CallSocket
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

/**
 * Play Together, on the phone.
 *
 * The gateway is the referee: a client sends "column four" and gets a board
 * back, and the board is never sent the other way - a client that could send
 * twenty coin positions could send twenty coins in the pockets. That makes this
 * file small on purpose. It holds what arrived, and it sends taps.
 *
 * ## No rules are ported here, and that is the design
 *
 * `packages/shared-types/src/games/` is the only implementation of every game
 * in this repository, and a Kotlin copy would be a second one to disagree with
 * it. So the phone plays the games whose legality can be *read off the board* -
 * an empty square, a column with room, a line not yet drawn - and watches the
 * three where it cannot: Reversi, whose legal moves are a walk in eight
 * directions, and Ludo and Carrom, whose boards live in [GameState.data] in a
 * shape only their own rules module understands.
 *
 * Watching is not a consolation. The board, the seats, whose turn it is and who
 * is winning all arrive for every game, so a phone in the call sees the whole
 * table; what it declines to do is offer a tap it cannot honestly say is a move.
 */

/** Somebody in a chair. */
data class GameSeat(val userId: String, val username: String) {
    companion object {
        fun from(json: JSONObject) = GameSeat(
            userId = json.optString("userId"),
            username = json.optString("username"),
        )
    }
}

/**
 * A board, mid-game. One shape for every game, as on the wire.
 *
 * [cells] is whatever the board is made of - squares in Tic-tac-toe and
 * Reversi, dropped discs in Connect Four, drawn lines in Dots and Boxes - and
 * each entry is the seat that owns it, or -1 for nothing. [boxes] is Dots and
 * Boxes alone. [data] is Ludo's tokens and Carrom's coins, which nothing here
 * reads.
 */
data class GameState(
    val gameId: String,
    val cells: List<Int>,
    val boxes: List<Int>,
    val data: List<Double>,
    val turn: Int,
    /** The seat that won, -1 for a draw, or null while the game is still on. */
    val winner: Int?,
    val lastMove: Int?,
    val moveCount: Int,
) {
    val over: Boolean get() = winner != null

    companion object {
        fun from(json: JSONObject) = GameState(
            gameId = json.optString("gameId"),
            cells = json.optJSONArray("cells").ints(),
            boxes = json.optJSONArray("boxes").ints(),
            data = json.optJSONArray("data").doubles(),
            turn = json.optInt("turn"),
            // Null is "still playing" and -1 is "a draw", so `optInt` alone -
            // which answers 0 for an absent key - would report seat zero as the
            // winner of every game in progress.
            winner = if (json.isNull("winner")) null else json.optInt("winner"),
            lastMove = if (json.isNull("lastMove")) null else json.optInt("lastMove"),
            moveCount = json.optInt("moveCount"),
        )
    }
}

data class GameSession(
    val rev: Int,
    val gameId: String,
    /** Seat index to whoever is in it; null is an empty chair anybody may take. */
    val seats: List<GameSeat?>,
    val state: GameState,
    val round: Int,
    /** Rounds won per seat. The tally belongs to the chair, not to the person. */
    val wins: List<Int>,
    val byUserId: String?,
) {
    fun seatOf(userId: String): Int = seats.indexOfFirst { it?.userId == userId }

    companion object {
        fun from(json: JSONObject) = GameSession(
            rev = json.optInt("rev"),
            gameId = json.optString("gameId"),
            seats = json.optJSONArray("seats").let { array ->
                (0 until (array?.length() ?: 0)).map { at ->
                    array?.optJSONObject(at)?.let { GameSeat.from(it) }
                }
            },
            state = GameState.from(json.optJSONObject("state") ?: JSONObject()),
            round = json.optInt("round"),
            wins = json.optJSONArray("wins").ints(),
            byUserId = if (json.isNull("byUserId")) null else json.optString("byUserId"),
        )
    }
}

private fun JSONArray?.ints(): List<Int> =
    (0 until (this?.length() ?: 0)).map { this?.optInt(it) ?: 0 }

private fun JSONArray?.doubles(): List<Double> =
    (0 until (this?.length() ?: 0)).map { this?.optDouble(it) ?: 0.0 }

/**
 * The library, as this client knows it.
 *
 * Names, chairs and colours mirrored from each rules module's `definition`,
 * because the seat rail and the board have to agree with the desktop about what
 * seat one is called and what colour it is drawn in. The *rules* are not here
 * and never will be - see the note at the top of this file.
 */
data class GameInfo(
    val id: String,
    val name: String,
    val blurb: String,
    val seats: Int,
    val seatNames: List<String>,
    val seatColours: List<Long>,
    /**
     * Whether this phone offers taps, or only shows the board.
     *
     * True where a legal move is visible in the board itself. False for
     * Reversi, Ludo and Carrom - see the file's note on why porting their rules
     * to get a fourth, fifth and sixth opinion is the thing being avoided.
     */
    val playableHere: Boolean,
)

object Games {
    val ALL = listOf(
        GameInfo(
            id = "tic-tac-toe",
            name = "Tic-tac-toe",
            blurb = "Three in a row. Two minutes, and everybody already knows how.",
            seats = 2,
            seatNames = listOf("X", "O"),
            seatColours = listOf(0xFF38BDF8, 0xFFFB7185),
            playableHere = true,
        ),
        GameInfo(
            id = "connect-four",
            name = "Connect Four",
            blurb = "Drop a disc, take a column, get four in a line before they do.",
            seats = 2,
            seatNames = listOf("Red", "Yellow"),
            seatColours = listOf(0xFFF43F5E, 0xFFFACC15),
            playableHere = true,
        ),
        GameInfo(
            id = "reversi",
            name = "Reversi",
            blurb = "Trap a run and it turns your colour. The lead changes hands all game.",
            seats = 2,
            seatNames = listOf("Black", "White"),
            seatColours = listOf(0xFF1E293B, 0xFFE2E8F0),
            playableHere = false,
        ),
        GameInfo(
            id = "dots-and-boxes",
            name = "Dots and Boxes",
            blurb = "Draw a line, close a square, go again.",
            seats = 2,
            seatNames = listOf("Blue", "Green"),
            seatColours = listOf(0xFF60A5FA, 0xFF4ADE80),
            playableHere = true,
        ),
        GameInfo(
            id = "ludo",
            name = "Ludo",
            blurb = "Roll a six to start, race four tokens home, send theirs back.",
            seats = 4,
            seatNames = listOf("Red", "Green", "Yellow", "Blue"),
            seatColours = listOf(0xFFF43F5E, 0xFF4ADE80, 0xFFFACC15, 0xFF60A5FA),
            playableHere = false,
        ),
        GameInfo(
            id = "carrom",
            name = "Carrom",
            blurb = "Aim, set the power, and watch the same shot play out both ends.",
            seats = 2,
            seatNames = listOf("White", "Black"),
            seatColours = listOf(0xFFE2E8F0, 0xFF1E293B),
            playableHere = false,
        ),
    )

    fun of(gameId: String): GameInfo? = ALL.firstOrNull { it.id == gameId }
}

/** Board geometry, mirrored from the rules modules that own each shape. */
object Boards {
    const val TIC_TAC_TOE_SIZE = 3

    const val CONNECT_COLUMNS = 7
    const val CONNECT_ROWS = 6

    const val REVERSI_SIZE = 8

    /** Dots per side; boxes per side is one less. */
    const val DOTS = 5
    const val BOX_CELLS = DOTS - 1
    /** Lines across the top of a row of boxes: [DOTS] rows of [BOX_CELLS]. */
    const val HORIZONTALS = DOTS * BOX_CELLS

    /** The horizontal line below dot-row [r], at column [c]. */
    fun horizontal(r: Int, c: Int): Int = r * BOX_CELLS + c

    /** The vertical line right of dot-column [c], in row [r]. */
    fun vertical(r: Int, c: Int): Int = HORIZONTALS + r * DOTS + c

    /** Where a disc dropped down [column] would land, or -1 when the column is full. */
    fun landing(cells: List<Int>, column: Int): Int {
        for (r in CONNECT_ROWS - 1 downTo 0) {
            val at = r * CONNECT_COLUMNS + column
            if (cells.getOrNull(at) == -1) return at
        }
        return -1
    }
}

/**
 * What is being played in this call, and the taps that change it.
 *
 * Every function here is a request. The gateway is the only thing that can
 * order two people tapping at the same instant, and a client that moved its own
 * board first would disagree with everybody until the answer arrived.
 */
object Play {
    private val _session = MutableStateFlow<GameSession?>(null)
    val session: StateFlow<GameSession?> = _session.asStateFlow()

    private var wired = false

    /** Idempotent: a reconnect must not add a second listener. */
    fun start() {
        if (wired) return
        wired = true
        CallSocket.on { event ->
            if (event.optString("type") != "game.state") return@on
            apply(event.optJSONObject("session")?.let { GameSession.from(it) })
        }
    }

    /**
     * One state from the gateway.
     *
     * A revision at or below the one held is dropped, so this client's echo of
     * its own move cannot undo somebody else's later one. A null session is the
     * game being closed and always applies - there is no revision on "nobody is
     * playing", and refusing it would leave a finished board on screen.
     */
    internal fun apply(session: GameSession?) {
        if (session == null) {
            _session.value = null
            return
        }
        val held = _session.value
        if (held != null && session.rev <= held.rev) return
        _session.value = session
    }

    fun clear() {
        _session.value = null
    }

    fun open(gameId: String) = CallSocket.send(
        JSONObject().put("type", "game.open").put("gameId", gameId),
    )

    /** Take a chair, or move to one. Standing up is seat -1. */
    fun sit(seat: Int) = CallSocket.send(
        JSONObject().put("type", "game.sit").put("seat", seat),
    )

    fun move(move: Int) = CallSocket.send(
        JSONObject().put("type", "game.move").put("move", move),
    )

    fun rematch() = CallSocket.send(JSONObject().put("type", "game.rematch"))

    fun close() = CallSocket.send(JSONObject().put("type", "game.close"))
}
