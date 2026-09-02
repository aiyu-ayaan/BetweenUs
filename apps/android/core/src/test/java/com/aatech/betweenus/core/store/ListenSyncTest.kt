package com.aatech.betweenus.core.store

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * When a player is pulled back into step, and - more importantly - when it is
 * left alone.
 *
 * The half that fails silently is the second one. A correction that fires too
 * eagerly does not throw or log; it seeks, and a seek is a gap in the music. A
 * session that stutters every few minutes is how this feature stops being used,
 * and nothing in a stack trace would ever say so.
 *
 * The numbers are the desktop's on purpose. Two clients correcting on different
 * tolerances is two clients that disagree about whether they are in step.
 */
class ListenSyncTest {

    private fun session(
        paused: Boolean = false,
        positionMs: Long = 10_000,
        atServerMs: Long = 100_000,
        durationMs: Long = 0,
    ) = ListenSession(
        rev = 1,
        queue = listOf(
            ListenTrack(
                id = "t1",
                provider = "youtube",
                ref = "r",
                title = "",
                durationMs = durationMs,
                addedByUserId = "ana",
                addedByUsername = "ana",
            ),
        ),
        index = 0,
        paused = paused,
        positionMs = positionMs,
        atServerMs = atServerMs,
        byUserId = null,
    )

    @Test
    fun `small drift is left alone`() {
        val playing = session()
        // The call is at 10s; this player is a second out either way.
        assertNull(ListenSync.correction(playing, 100_000, 9_000))
        assertNull(ListenSync.correction(playing, 100_000, 11_000))
        // Exactly at the tolerance is still inside it.
        assertNull(ListenSync.correction(playing, 100_000, 8_500))
    }

    @Test
    fun `drift past the tolerance is corrected in one jump`() {
        val playing = session()
        assertEquals(10_000L, ListenSync.correction(playing, 100_000, 8_400))
        assertEquals(10_000L, ListenSync.correction(playing, 100_000, 30_000))
    }

    @Test
    fun `the target is where the call is now, not where it was measured`() {
        // Ten seconds after the state was made, the call is at 20s - and that
        // is what the player is sent to. Seeking to the stamped 10s is how a
        // correction lands ten seconds behind and immediately needs another.
        val playing = session(positionMs = 10_000, atServerMs = 100_000)
        assertEquals(20_000L, ListenSync.correction(playing, 110_000, 0))
    }

    @Test
    fun `a paused session has almost no tolerance`() {
        val paused = session(paused = true, positionMs = 10_000)
        // A quarter second out is fine; anything a person could read is not.
        assertNull(ListenSync.correction(paused, 999_999, 10_200))
        assertEquals(10_000L, ListenSync.correction(paused, 999_999, 10_400))
    }

    @Test
    fun `a paused session ignores how long ago it was paused`() {
        // Nothing is moving, so the clock does not enter into it. Reading the
        // elapsed time here would drag a stopped track forward.
        val paused = session(paused = true, positionMs = 10_000, atServerMs = 0)
        assertNull(ListenSync.correction(paused, 5_000_000, 10_000))
    }

    @Test
    fun `drift is signed, and positive means behind`() {
        val playing = session()
        assertEquals(2_000L, ListenSync.driftOf(playing, 100_000, 8_000))
        assertEquals(-2_000L, ListenSync.driftOf(playing, 100_000, 12_000))
    }

    @Test
    fun `a player past the end of a known track is pulled back to the end`() {
        // The position formula clamps to the duration, so the correction cannot
        // ask a player to seek past the end of its own video.
        val playing = session(positionMs = 0, atServerMs = 0, durationMs = 30_000)
        assertEquals(30_000L, ListenSync.correction(playing, 500_000, 0))
    }
}
