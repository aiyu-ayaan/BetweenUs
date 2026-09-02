package com.aatech.betweenus.core.store

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * The position formula, and the rule that stops a queue jumping backwards.
 *
 * The formula is written twice - here and as `listenPositionAt` in
 * `packages/shared-types` - because a phone and a desktop in the same session
 * have to put the needle in the same place. The cases below are the ones where
 * two plausible implementations disagree, which is exactly where a session goes
 * quietly out of step rather than loudly wrong.
 */
class ListenTest {

    private fun track(id: String, durationMs: Long = 0) = ListenTrack(
        id = id,
        provider = "youtube",
        ref = "dQw4w9WgXcQ",
        title = "",
        durationMs = durationMs,
        addedByUserId = "ana",
        addedByUsername = "ana",
    )

    private fun session(
        rev: Int = 1,
        paused: Boolean = false,
        positionMs: Long = 0,
        atServerMs: Long = 1_000,
        durationMs: Long = 0,
    ) = ListenSession(
        rev = rev,
        queue = listOf(track("t1", durationMs)),
        index = 0,
        paused = paused,
        positionMs = positionMs,
        atServerMs = atServerMs,
        byUserId = "ana",
    )

    @Before
    fun reset() = Listen.clear()

    @Test
    fun `a playing track advances with the clock`() {
        val playing = session(positionMs = 5_000, atServerMs = 10_000)
        assertEquals(5_000L, listenPositionAt(playing, 10_000))
        assertEquals(8_000L, listenPositionAt(playing, 13_000))
    }

    @Test
    fun `a paused track does not`() {
        // The whole point of the pair: `positionMs` is where it was, and while
        // paused that is also where it is, however long ago the state was made.
        val paused = session(paused = true, positionMs = 5_000, atServerMs = 10_000)
        assertEquals(5_000L, listenPositionAt(paused, 10_000))
        assertEquals(5_000L, listenPositionAt(paused, 900_000))
    }

    @Test
    fun `a clock behind the stamp does not run the track backwards`() {
        // A phone whose offset has not been measured yet reads "now" as earlier
        // than the state was made. Without the floor that is a negative elapsed
        // and a position before the one the gateway sent.
        val playing = session(positionMs = 5_000, atServerMs = 10_000)
        assertEquals(5_000L, listenPositionAt(playing, 1_000))
    }

    @Test
    fun `the position is clamped to a known duration`() {
        // A session left playing while everybody was away must not report a
        // position in the next hour.
        val playing = session(positionMs = 0, atServerMs = 0, durationMs = 30_000)
        assertEquals(30_000L, listenPositionAt(playing, 500_000))
    }

    @Test
    fun `an unknown duration is not a clamp to zero`() {
        // `durationMs` is 0 until some player reports it, and reading that as a
        // length is a track that is over before it starts.
        val playing = session(positionMs = 0, atServerMs = 0, durationMs = 0)
        assertEquals(500_000L, listenPositionAt(playing, 500_000))
    }

    @Test
    fun `an older revision is dropped`() {
        Listen.apply(session(rev = 5, positionMs = 5_000))
        Listen.apply(session(rev = 4, positionMs = 99_000))
        assertEquals(5_000L, Listen.session.value?.positionMs)

        // The same revision too: it is an echo of what is already held.
        Listen.apply(session(rev = 5, positionMs = 77_000))
        assertEquals(5_000L, Listen.session.value?.positionMs)

        Listen.apply(session(rev = 6, positionMs = 12_000))
        assertEquals(12_000L, Listen.session.value?.positionMs)
    }

    @Test
    fun `the end of a session always applies`() {
        // There is no revision on "nothing is playing", so refusing it would
        // leave a dead track on screen for ever.
        Listen.apply(session(rev = 9))
        Listen.apply(null)
        assertNull(Listen.session.value)
    }

    @Test
    fun `a session parses off the wire`() {
        val json = JSONObject(
            """
            {"rev":3,"index":1,"paused":true,"positionMs":4200,"atServerMs":99,
             "byUserId":null,
             "queue":[
               {"id":"a","provider":"youtube","ref":"r1","title":"","durationMs":0,
                "addedByUserId":"u1","addedByUsername":"ana"},
               {"id":"b","provider":"youtube","ref":"r2","title":"Two","durationMs":1000,
                "addedByUserId":"u2","addedByUsername":"bo"}]}
            """.trimIndent(),
        )
        val parsed = ListenSession.from(json)
        assertEquals(3, parsed.rev)
        assertEquals(2, parsed.queue.size)
        // `byUserId` is nullable on the wire, and `optString` on a JSON null
        // answers the string "null" rather than null - which would draw a line
        // saying somebody called null skipped the track.
        assertNull(parsed.byUserId)
        assertEquals("Two", parsed.current?.title)
    }
}
