package com.aatech.betweenus.core.store

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * What arrives from the referee, and the geometry this client mirrors.
 *
 * No game rules are tested here because none are implemented here - the only
 * implementation is `packages/shared-types/src/games/`. What is tested is the
 * three things a client can get wrong on its own: reading a board off the wire,
 * dropping a state it has already seen, and the index arithmetic it needs to
 * draw a grid and turn a tap back into the move the referee expects.
 */
class PlayTest {

    private fun state(
        gameId: String = "tic-tac-toe",
        cells: List<Int> = List(9) { -1 },
        winner: Int? = null,
    ) = GameState(
        gameId = gameId,
        cells = cells,
        boxes = emptyList(),
        data = emptyList(),
        turn = 0,
        winner = winner,
        lastMove = null,
        moveCount = 0,
    )

    private fun session(rev: Int = 1, winner: Int? = null) = GameSession(
        rev = rev,
        gameId = "tic-tac-toe",
        seats = listOf(GameSeat("ana", "ana"), null),
        state = state(winner = winner),
        round = 0,
        wins = listOf(0, 0),
        byUserId = "ana",
    )

    @Before
    fun reset() = Play.clear()

    @Test
    fun `a game in progress has no winner, and seat zero has not won it`() {
        // The bug this exists for: `optInt` answers 0 for an absent key, so a
        // board still being played reports seat zero as the winner of it.
        val json = JSONObject(
            """{"gameId":"tic-tac-toe","cells":[-1,-1,-1],"boxes":[],"data":[],
                "turn":1,"winner":null,"lastMove":null,"moveCount":0}""",
        )
        val parsed = GameState.from(json)
        assertNull(parsed.winner)
        assertFalse(parsed.over)
        assertNull(parsed.lastMove)
    }

    @Test
    fun `a draw is a winner of minus one, which is not the same as no winner`() {
        val drawn = GameState.from(
            JSONObject(
                """{"gameId":"tic-tac-toe","cells":[],"boxes":[],"data":[],
                    "turn":0,"winner":-1,"lastMove":4,"moveCount":9}""",
            ),
        )
        assertEquals(-1, drawn.winner)
        assertTrue(drawn.over)
        assertEquals(4, drawn.lastMove)
    }

    @Test
    fun `an empty chair parses as an empty chair`() {
        val json = JSONObject(
            """{"rev":2,"gameId":"tic-tac-toe","round":0,"wins":[1,0],"byUserId":"ana",
                "seats":[{"userId":"ana","username":"ana"},null],
                "state":{"gameId":"tic-tac-toe","cells":[],"boxes":[],"data":[],
                         "turn":0,"winner":null,"lastMove":null,"moveCount":0}}""",
        )
        val parsed = GameSession.from(json)
        assertEquals(2, parsed.seats.size)
        assertEquals("ana", parsed.seats[0]?.username)
        assertNull(parsed.seats[1])
        assertEquals(0, parsed.seatOf("ana"))
        // Nobody, rather than seat zero.
        assertEquals(-1, parsed.seatOf("bo"))
    }

    @Test
    fun `a revision at or below the one held is dropped`() {
        Play.apply(session(rev = 5))
        Play.apply(session(rev = 5, winner = 0))
        Play.apply(session(rev = 4, winner = 1))
        assertNull(Play.session.value?.state?.winner)

        Play.apply(session(rev = 6, winner = 0))
        assertEquals(0, Play.session.value?.state?.winner)
    }

    @Test
    fun `closing the game always applies`() {
        Play.apply(session(rev = 9))
        Play.apply(null)
        assertNull(Play.session.value)
    }

    @Test
    fun `a disc falls to the lowest free square in its column`() {
        val empty = List(Boards.CONNECT_COLUMNS * Boards.CONNECT_ROWS) { -1 }
        // Bottom row, column 0: row 5 of 6.
        assertEquals(5 * Boards.CONNECT_COLUMNS, Boards.landing(empty, 0))

        val oneDeep = empty.toMutableList().also { it[5 * Boards.CONNECT_COLUMNS] = 0 }
        assertEquals(4 * Boards.CONNECT_COLUMNS, Boards.landing(oneDeep, 0))

        val full = List(Boards.CONNECT_COLUMNS * Boards.CONNECT_ROWS) { 0 }
        assertEquals(-1, Boards.landing(full, 0))
    }

    @Test
    fun `dots and boxes line indices match the rules module's own`() {
        // Mirrored arithmetic, so it is asserted rather than assumed: the
        // horizontals come first and the verticals follow them, and a client
        // that got the offset wrong would draw one line and play another.
        assertEquals(0, Boards.horizontal(0, 0))
        assertEquals(Boards.BOX_CELLS, Boards.horizontal(1, 0))
        assertEquals(Boards.HORIZONTALS, Boards.vertical(0, 0))
        assertEquals(Boards.HORIZONTALS + Boards.DOTS, Boards.vertical(1, 0))
        // Forty lines in total, and no index collides across the two families.
        val all = (0 until Boards.DOTS).flatMap { r ->
            (0 until Boards.BOX_CELLS).map { c -> Boards.horizontal(r, c) }
        } + (0 until Boards.BOX_CELLS).flatMap { r ->
            (0 until Boards.DOTS).map { c -> Boards.vertical(r, c) }
        }
        assertEquals(40, all.size)
        assertEquals(40, all.toSet().size)
    }

    @Test
    fun `the library agrees with itself about seats`() {
        // A seat rail drawn from `seats` and coloured from `seatColours` needs
        // one entry per chair, or a four-player game draws two of them.
        for (game in Games.ALL) {
            assertEquals(game.name, game.seats, game.seatNames.size)
            assertEquals(game.name, game.seats, game.seatColours.size)
        }
    }
}
