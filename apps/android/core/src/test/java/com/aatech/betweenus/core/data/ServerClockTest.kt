package com.aatech.betweenus.core.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import kotlin.math.abs

/**
 * The clock the client trusts.
 *
 * The desktop's `server-clock.check.ts` holds the same cases. If one of these
 * ever has to change, so does that one.
 */
class ServerClockTest {

    private val hour = 60 * 60 * 1000L

    @Before
    fun clear() = ServerClock.reset()

    @Test
    fun `an unmeasured clock is this phone's clock`() {
        assertEquals(0L, ServerClock.offsetMs.value)
        assertTrue(abs(ServerClock.nowMs() - System.currentTimeMillis()) < 50)
        assertFalse(ServerClock.isWrong())
    }

    @Test
    fun `a reply with no usable date teaches nothing`() {
        // A proxy that strips `Date`, or writes nonsense into it, must not be
        // able to move this client's idea of the time.
        ServerClock.sample(0, 100, null)
        ServerClock.sample(0, 100, 0)
        ServerClock.sample(0, 100, -1)
        assertEquals(0L, ServerClock.offsetMs.value)
    }

    @Test
    fun `an hour behind, measured across a round trip`() {
        // Out 200ms, and the server stamped it an hour ahead of this phone: the
        // estimate is the midpoint, so the offset is the hour plus the 100ms
        // the reply spent in flight.
        val sent = 1_000_000L
        ServerClock.sample(sent, sent + 200, sent + hour + 100)
        assertTrue(abs(ServerClock.offsetMs.value - hour) < 1_000)
        assertTrue(ServerClock.isWrong())
        // A positive offset means the phone is behind; the wording must agree.
        assertTrue(ServerClock.wording(hour).contains("behind"))
        assertTrue(ServerClock.wording(-hour).contains("ahead of"))
    }

    @Test
    fun `the fastest round trip decides`() {
        // A slow round trip is slow because something queued, and a queue is
        // rarely symmetric - so a delayed sample is biased, not merely noisy.
        ServerClock.sample(0, 8_000, 2_000)
        ServerClock.sample(0, 100, 1_000_050)
        assertTrue(abs(ServerClock.offsetMs.value - 1_000_000L) < 200)
    }

    @Test
    fun `only the last few measurements are kept`() {
        // A clock corrected an hour ago stops being held against the phone.
        ServerClock.sample(0, 100, hour)
        repeat(ServerClock.SAMPLES + 4) { ServerClock.sample(0, 100, 50) }
        assertTrue(abs(ServerClock.offsetMs.value) < 1_000)
    }

    @Test
    fun `a round trip too slow to mean anything is not believed`() {
        // The offset is the midpoint of the round trip, so it carries up to
        // half of however asymmetric that trip was. An upload that took twelve
        // minutes to answer would otherwise report a six-minute skew on a phone
        // whose clock is exactly right - and one quiet spell later that is the
        // best sample held, and the banner is up.
        ServerClock.sample(0, 12 * 60 * 1000L, 1)
        assertEquals(0L, ServerClock.offsetMs.value)

        // The edge is inclusive, and a trip that came back before it left is
        // the clock moving under the measurement itself.
        assertTrue(usable(ServerClock.Sample(0, ServerClock.MAX_ROUND_TRIP_MS, 1)))
        assertFalse(usable(ServerClock.Sample(0, ServerClock.MAX_ROUND_TRIP_MS + 1, 1)))
        assertFalse(usable(ServerClock.Sample(5_000, 4_000, 5_000)))
    }

    @Test
    fun `a corrected clock stops being wrong`() {
        // The measurement that keeps a banner up: the offset is the
        // least-delayed sample held, so a fast one taken while the clock was an
        // hour out stays the best after the clock is fixed. It was timed
        // against a clock that no longer exists.
        val then = 1_000_000L
        ServerClock.sample(then, then + 100, then + hour + 50)
        assertTrue(ServerClock.isWrong())

        val now = then + ServerClock.SAMPLE_TTL_MS + 60_000L
        ServerClock.sample(now, now + 100, now + 50)
        assertFalse(ServerClock.isWrong())

        // Within the window it is kept, so an ordinary session still has
        // several to choose the least-delayed one from.
        assertTrue(fresh(ServerClock.Sample(0, then, then), then + ServerClock.SAMPLE_TTL_MS))
        assertFalse(fresh(ServerClock.Sample(0, then, then), then + ServerClock.SAMPLE_TTL_MS + 1))
        // And a sample from before a clock that stepped backwards goes too.
        assertFalse(fresh(ServerClock.Sample(0, then, then), then - 1))
    }

    @Test
    fun `five minutes is the line`() {
        // Below it nothing on screen misleads, and a phone whose clock drifts a
        // little must not be nagged about it.
        assertFalse(ServerClock.isWrong(ServerClock.WARNING_MS - 1))
        assertFalse(ServerClock.isWrong(-(ServerClock.WARNING_MS - 1)))
        assertTrue(ServerClock.isWrong(ServerClock.WARNING_MS))
        assertTrue(ServerClock.isWrong(-ServerClock.WARNING_MS))
    }

    @Test
    fun `the wording scales with the gap`() {
        assertTrue(ServerClock.wording(10 * 60 * 1000L).contains("10 minutes"))
        assertTrue(ServerClock.wording(5 * hour).contains("5 hours"))
        assertTrue(ServerClock.wording(3 * 24 * hour).contains("3 days"))
    }
}
