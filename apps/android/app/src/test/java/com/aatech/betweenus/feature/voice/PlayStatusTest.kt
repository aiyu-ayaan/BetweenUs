package com.aatech.betweenus.feature.voice

import com.aatech.betweenus.core.store.GameSeat
import com.aatech.betweenus.core.store.GameSession
import com.aatech.betweenus.core.store.GameState
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The one line under a game's name.
 *
 * Small, and worth pinning because the failure is silent and confusing rather
 * than loud: a board that still says "Your move" after somebody has won is the
 * most misleading thing this screen can say, and nothing about it throws.
 */
class PlayStatusTest {

    private val names = listOf("X", "O")

    private fun session(
        turn: Int = 0,
        winner: Int? = null,
        seats: List<GameSeat?> = listOf(GameSeat("ana", "Ana"), GameSeat("bo", "Bo")),
    ) = GameSession(
        rev = 1,
        gameId = "tic-tac-toe",
        seats = seats,
        state = GameState(
            gameId = "tic-tac-toe",
            cells = List(9) { -1 },
            boxes = emptyList(),
            data = emptyList(),
            turn = turn,
            winner = winner,
            lastMove = null,
            moveCount = 0,
        ),
        round = 0,
        wins = listOf(0, 0),
        byUserId = "ana",
    )

    @Test
    fun `whose move it is, from the seat's own point of view`() {
        assertEquals("Your move.", statusLine(session(turn = 0), names, mySeat = 0))
        assertEquals("Their move.", statusLine(session(turn = 1), names, mySeat = 0))
    }

    @Test
    fun `a finished game never reports a turn`() {
        // The case this test exists for.
        assertEquals("You won.", statusLine(session(turn = 0, winner = 0), names, mySeat = 0))
        assertEquals("Bo won.", statusLine(session(turn = 0, winner = 1), names, mySeat = 0))
        assertEquals("A draw.", statusLine(session(turn = 0, winner = -1), names, mySeat = 0))
    }

    @Test
    fun `a watcher is told who is up, not that it is their move`() {
        assertEquals("Watching · Ana to move", statusLine(session(turn = 0), names, mySeat = -1))
        assertEquals("Watching · Bo to move", statusLine(session(turn = 1), names, mySeat = -1))
    }

    @Test
    fun `an empty chair falls back to the seat's name`() {
        val open = session(turn = 1, seats = listOf(GameSeat("ana", "Ana"), null))
        assertEquals("Watching · O to move", statusLine(open, names, mySeat = -1))
    }

    @Test
    fun `a watcher of a finished game is told who won by name`() {
        val done = session(winner = 1)
        assertEquals("Bo won.", statusLine(done, names, mySeat = -1))
    }
}
