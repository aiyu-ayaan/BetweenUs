package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The mirror of `apps/desktop/src/services/call-stats.check.ts`.
 *
 * Every case here is a case there, deliberately: the two clients sit in the
 * same call and a phone that disagrees with a laptop about what 5% loss is is
 * worse than a phone with no panel at all - one of them is then lying and
 * nobody can tell which.
 */
class CallStatsTest {

    private fun sample(
        at: Long = 0,
        inboundAudioBytes: Long = 0,
        inboundVideoBytes: Long = 0,
        outboundAudioBytes: Long = 0,
        outboundVideoBytes: Long = 0,
        packetsLost: Long = 0,
        packetsReceived: Long = 0,
        roundTripSeconds: Double? = null,
        frameWidth: Int? = null,
        frameHeight: Int? = null,
        framesPerSecond: Double? = null,
    ) = LinkSample(
        at = at,
        inboundAudioBytes = inboundAudioBytes,
        inboundVideoBytes = inboundVideoBytes,
        outboundAudioBytes = outboundAudioBytes,
        outboundVideoBytes = outboundVideoBytes,
        packetsLost = packetsLost,
        packetsReceived = packetsReceived,
        roundTripSeconds = roundTripSeconds,
        frameWidth = frameWidth,
        frameHeight = frameHeight,
        framesPerSecond = framesPerSecond,
    )

    private val second = CallStats.toStats(
        "p1",
        "Ann",
        sample(
            at = 2_000,
            inboundAudioBytes = 4_000,
            inboundVideoBytes = 121_000,
            outboundAudioBytes = 4_000,
            packetsLost = 2,
            packetsReceived = 198,
            roundTripSeconds = 0.042,
            frameWidth = 1920,
            frameHeight = 1080,
            framesPerSecond = 29.6,
        ),
        sample(at = 1_000),
    )

    @Test
    fun `a rate with nothing to compare against is unknown, not zero`() {
        assertNull(CallStats.kbpsBetween(1_000, 0, 0))
        // A counter that went backwards is a connection rebuilt underneath us.
        assertNull(CallStats.kbpsBetween(0, 1_000, 1_000))
        assertEquals(8, CallStats.kbpsBetween(1_000, 0, 1_000))
    }

    @Test
    fun `loss is a percentage, and unknown before anything arrives`() {
        assertEquals(0.0, CallStats.lossPercent(0, 100)!!, 1e-9)
        // Nothing has arrived yet, so the loss rate is not 100% - it is unknown.
        assertNull(CallStats.lossPercent(0, 0))
        // One decimal place, so a fifth of a percent does not read as zero.
        assertEquals(0.1, CallStats.lossPercent(1, 799)!!, 1e-9)
    }

    @Test
    fun `the first sample of a call reports rates as unknown`() {
        // Reporting "you are not being heard" for the first second of every
        // call would train everyone to ignore it.
        val first = CallStats.toStats("p1", "Ann", sample(at = 1_000), null)
        assertNull(first.downKbps)
        assertNull(first.upKbps)
        assertTrue(first.sendingAudio)
    }

    @Test
    fun `two samples a second apart give the numbers the panel shows`() {
        assertEquals(1_000, second.downKbps)
        assertEquals(32, second.upKbps)
        assertEquals(1.0, second.lossPercent!!, 1e-9)
        assertEquals(42, second.roundTripMs)
        assertEquals(30, second.framesPerSecond)
        assertTrue(second.sendingAudio)
    }

    @Test
    fun `outbound audio that has not moved is a microphone off the wire`() {
        // Whatever the level meter says.
        val silent = CallStats.toStats(
            "p1",
            "Ann",
            sample(at = 3_000, outboundAudioBytes = 4_000),
            sample(at = 2_000, outboundAudioBytes = 4_000),
        )
        assertEquals(false, silent.sendingAudio)
    }

    @Test
    fun `the not-being-heard warning needs an intent, an audience and persistence`() {
        val silent = CallStats.toStats(
            "p1",
            "Ann",
            sample(at = 3_000, outboundAudioBytes = 4_000),
            sample(at = 2_000, outboundAudioBytes = 4_000),
        )
        val quiet = listOf(silent)

        assertTrue(CallStats.notBeingHeard(true, quiet, 3))
        // One quiet sample is a scheduling hiccup.
        assertEquals(false, CallStats.notBeingHeard(true, quiet, 1))
        assertEquals(
            "a muted microphone is not a fault",
            false,
            CallStats.notBeingHeard(false, quiet, 9),
        )
        assertEquals(false, CallStats.notBeingHeard(true, listOf(second), 9))
        assertEquals(
            "nobody to be heard by is not a fault",
            false,
            CallStats.notBeingHeard(true, emptyList(), 9),
        )
        // One peer hearing us and another not is that peer's problem, and the
        // microphone is what this warning is about.
        assertEquals(false, CallStats.notBeingHeard(true, listOf(silent, second), 9))

        // A link with no path carries nothing whatever the microphone does, so
        // it is no evidence about the microphone: "nobody can hear you, try
        // another input" is the wrong answer to a call that never connected.
        val unreachable = silent.copy(connected = false)
        assertEquals(
            "a link with no path is not a microphone fault",
            false,
            CallStats.notBeingHeard(true, listOf(unreachable), 9),
        )
        // A dead link is ignored, not counted as a vote either way.
        assertTrue(CallStats.notBeingHeard(true, listOf(unreachable, silent), 9))
        assertEquals(false, CallStats.notBeingHeard(true, listOf(unreachable, second), 9))
    }

    @Test
    fun `health warnings fire where a person would notice, and not before`() {
        assertNull(CallStats.healthWarning(listOf(second)))

        val lossy = second.copy(lossPercent = 12.0)
        val warning = CallStats.healthWarning(listOf(lossy))
        assertNotNull(warning)
        assertTrue("was $warning", warning!!.contains("12%"))
        assertTrue("was $warning", warning.contains("Ann"))

        val slow = second.copy(roundTripMs = 420)
        assertTrue(CallStats.healthWarning(listOf(slow))!!.contains("420 ms"))

        // Loss is the louder complaint when both are true: it is what breaks
        // speech.
        assertTrue(
            CallStats.healthWarning(listOf(lossy.copy(roundTripMs = 420)))!!.contains("%"),
        )
    }

    @Test
    fun `a degraded share is checked last and names its own reason`() {
        val cpuBound = second.copy(shareReduced = true, sendLimitedBy = "cpu")
        assertTrue(CallStats.healthWarning(listOf(cpuBound))!!.contains("encode"))

        val bandwidthBound = second.copy(shareReduced = true, sendLimitedBy = "bandwidth")
        assertTrue(CallStats.healthWarning(listOf(bandwidthBound))!!.contains("upload"))

        // A conversation problem still wins the one warning slot over a share
        // problem.
        val both = second.copy(lossPercent = 12.0, shareReduced = true, sendLimitedBy = "cpu")
        assertTrue(CallStats.healthWarning(listOf(both))!!.contains("%"))
    }

    @Test
    fun `the send-side helpers say the same things the desktop panel does`() {
        assertEquals("the link", CallStats.limitReason("bandwidth"))
        assertEquals("this phone", CallStats.limitReason("cpu"))
        assertEquals("the encoder", CallStats.limitReason("other"))
        assertNull(CallStats.limitReason(null))

        assertEquals("via relay", CallStats.pathLabel("relay"))
        assertEquals("direct", CallStats.pathLabel("direct"))
        assertNull("ICE has not settled on a pair yet", CallStats.pathLabel(null))

        assertEquals("960×540", CallStats.sendResolution(second.copy(sendWidth = 960, sendHeight = 540)))
        assertNull(CallStats.sendResolution(second.copy(sendWidth = null, sendHeight = 540)))
    }

    @Test
    fun `rates change unit where a number stops being readable`() {
        assertEquals("—", CallStats.rate(null))
        assertEquals("999 kbps", CallStats.rate(999))
        assertEquals("1.0 Mbps", CallStats.rate(1_000))
        assertEquals("2.4 Mbps", CallStats.rate(2_400))
    }

    @Test
    fun `the largest picture on the connection wins, which is the share`() {
        var picture: Triple<Int?, Int?, Double?> = Triple(null, null, null)
        picture = CallStats.larger(picture, 640, 360, 30.0)
        picture = CallStats.larger(picture, 1920, 1080, 15.0)
        // A camera arriving after a share must not replace it.
        picture = CallStats.larger(picture, 320, 180, 30.0)
        assertEquals(1920, picture.first)
        assertEquals(1080, picture.second)
        assertEquals(15.0, picture.third!!, 1e-9)
    }

    @Test
    fun `a slot with no picture on it contributes nothing`() {
        val none = CallStats.larger(Triple(null, null, null), 0, 0, 0.0)
        assertNull(none.first)
        assertNull(CallStats.resolution(second.copy(frameWidth = 0)))
        assertEquals("1920×1080 @ 30", CallStats.resolution(second))
    }

    // --- Which candidate pair is actually carrying the call ---

    private val dead = mapOf<String, Any>(
        "id" to "pair-old",
        "state" to "succeeded",
        "nominated" to true,
        "bytesSent" to 900_000L,
        "bytesReceived" to 900_000L,
    )
    private val live = mapOf<String, Any>(
        "id" to "pair-new",
        "state" to "succeeded",
        "nominated" to true,
        "bytesSent" to 12_000L,
        "bytesReceived" to 30_000L,
        "currentRoundTripTime" to 0.08,
    )

    @Test
    fun `the transport names the live pair, whatever the report order`() {
        // The guarded bug is silent and only appears after a link has had a bad
        // minute: an ICE restart leaves the pair that died in the report, still
        // succeeded and still nominated, and `getStats` guarantees no order.
        assertEquals("pair-new", CallStats.selectedPair(listOf(dead, live), "pair-new")?.get("id"))
        assertEquals("pair-new", CallStats.selectedPair(listOf(live, dead), "pair-new")?.get("id"))
    }

    @Test
    fun `a transport naming a pair that is not there still gets an answer`() {
        assertNotNull(CallStats.selectedPair(listOf(dead, live), "missing"))
    }

    @Test
    fun `without a transport entry the choice is order-independent`() {
        // The fallback is a guess; what it must not be is a coin flip on the
        // order `getStats` happened to return.
        val one = CallStats.selectedPair(listOf(dead, live), null)
        val other = CallStats.selectedPair(listOf(live, dead), null)
        assertNotNull(one)
        assertEquals(one?.get("id"), other?.get("id"))
    }

    @Test
    fun `a pair that never succeeded is never chosen`() {
        val failed = mapOf<String, Any>("id" to "f", "state" to "failed", "nominated" to true)
        val waiting = mapOf<String, Any>("id" to "w", "state" to "waiting", "nominated" to false)
        assertNull(CallStats.selectedPair(listOf(failed, waiting), null))
    }

    @Test
    fun `nothing to choose between is null rather than a throw`() {
        // A report taken before ICE has settled has no pairs at all, which is
        // the normal first second of every call.
        assertNull(CallStats.selectedPair(emptyList(), null))
        assertNull(CallStats.selectedPair(emptyList(), "pair-new"))
    }
}
