package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The capture size and the bitrate ceiling, which are the two numbers that
 * decide whether a share arrives readable.
 *
 * They are checked rather than eyeballed because getting either wrong is
 * invisible at the sending end: the phone looks fine, and only the person
 * watching sees the soft picture.
 */
class ShareQualityTest {

    @Test
    fun `a 1080p display is captured whole`() {
        val size = ShareQuality.scaleToFit(1080, 1920)
        assertEquals(1080, size.width)
        assertEquals(1920, size.height)
    }

    @Test
    fun `a taller than 1080p display is brought down by its long edge, in shape`() {
        // A 1440x3120 phone. The long edge lands on the cap and the aspect
        // ratio survives, because a share in the wrong shape is worse than a
        // smaller one.
        val size = ShareQuality.scaleToFit(1440, 3120)
        assertEquals(1920, size.height)
        assertEquals(886, size.width)

        val before = 1440.0 / 3120.0
        val after = size.width.toDouble() / size.height.toDouble()
        assertTrue("aspect drifted: $before to $after", kotlin.math.abs(before - after) < 0.01)
    }

    @Test
    fun `capture sizes are always even`() {
        // An odd dimension is a size no H264 encoder will take, and the failure
        // is a share that produces no frames at all rather than a warning.
        for (height in listOf(2001, 2399, 1081, 999)) {
            val size = ShareQuality.scaleToFit(1079, height)
            assertEquals(0, size.width % 2)
            assertEquals(0, size.height % 2)
        }
    }

    @Test
    fun `bitrate scales with pixels and stays inside its bounds`() {
        val fullHd = ShareQuality.screenBitrate(ShareQuality.Size(1920, 1080))
        assertEquals(20_000_000, fullHd)

        // Small screens still get a floor worth having: the old default was
        // about 3 Mbps at any size, which is what made this soft.
        val small = ShareQuality.screenBitrate(ShareQuality.Size(640, 360))
        assertEquals(8_000_000, small)

        // And a huge one cannot ask for the moon.
        val huge = ShareQuality.screenBitrate(ShareQuality.Size(7680, 4320))
        assertEquals(50_000_000, huge)
    }

    // --- Which codec, and which H.264 ---------------------------------------

    @Test
    fun `H264 outranks everything else`() {
        assertTrue(
            ShareQuality.codecRank("H264", emptyMap()) >
                ShareQuality.codecRank("VP9", mapOf("profile-level-id" to "64001f")),
        )
    }

    @Test
    fun `high profile outranks the baseline a phone offers first`() {
        val baseline = ShareQuality.codecRank(
            "H264",
            mapOf("profile-level-id" to "42e01f", "packetization-mode" to "1"),
        )
        val high = ShareQuality.codecRank(
            "H264",
            mapOf("profile-level-id" to "64001f", "packetization-mode" to "1"),
        )
        assertTrue("baseline $baseline should not beat high $high", high > baseline)
    }

    @Test
    fun `high profile is read from the profile byte, not the whole prefix`() {
        // 640c1f is High with constraint_set3 set. Matching on "6400" alone
        // would rank it as baseline and hand a phone the softer encoder.
        val constrained = ShareQuality.codecRank("H264", mapOf("profile-level-id" to "640c1f"))
        val plain = ShareQuality.codecRank("H264", mapOf("profile-level-id" to "64001f"))
        assertEquals(plain, constrained)
    }

    @Test
    fun `a whole NAL unit beats one chopped to the MTU`() {
        val mode1 = ShareQuality.codecRank(
            "H264",
            mapOf("profile-level-id" to "42e01f", "packetization-mode" to "1"),
        )
        val mode0 = ShareQuality.codecRank("H264", mapOf("profile-level-id" to "42e01f"))
        assertTrue(mode1 > mode0)
    }

    // --- The frame-rate ladder ---
    //
    // The desktop's, tier for tier: `share-quality.check.ts` asserts the same
    // answers on the other side, because a call has both clients in it and two
    // ladders that disagree is a smoothness that depends on who is sending.

    private val hd = ShareQuality.Size(1920, 1080)

    private fun rung(bps: Double?) =
        ShareQuality.adapt(hd, ShareQuality.screenBitrate(hd), ShareQuality.SCREEN_FRAME_RATE, bps)

    @Test
    fun `a collapsed link keeps a watchable frame rate`() {
        // The reported bug as a number: 405 kbps arriving as 1920x1080 at 2 fps.
        // MAINTAIN_RESOLUTION held the size and spent every frame it had doing
        // it. Whatever comes out now, it is not two frames a second.
        val low = rung(405_000.0)
        assertEquals(24, low.frameRate)
        assertTrue("it has to pay in pixels: ${low.scale}", low.scale > 2.0)

        // And what it pays is a picture somebody can still watch.
        val height = 1080 / low.scale
        assertTrue("got ${height}p", height > 300 && height < 540)
    }

    @Test
    fun `a link with room gives up nothing`() {
        val roomy = rung(30_000_000.0)
        assertEquals(60, roomy.frameRate)
        assertEquals(1.0, roomy.scale, 0.001)
    }

    @Test
    fun `nothing measured yet is not a bad link`() {
        // The estimator only measures what is sent, so a share that starts
        // small reports a small link and never climbs out of it.
        assertEquals(60, rung(null).frameRate)
        assertEquals(1.0, rung(null).scale, 0.001)
        assertEquals(1.0, rung(0.0).scale, 0.001)
    }

    @Test
    fun `more bitrate is never a worse share`() {
        var fps = 0
        var scale = Double.MAX_VALUE
        for (bps in listOf(200_000, 405_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 25_000_000)) {
            val next = rung(bps.toDouble())
            assertTrue("$bps is not a tier", ShareQuality.FRAME_TIERS.contains(next.frameRate))
            assertTrue("a share is never scaled up", next.scale >= 1.0)
            val better = next.frameRate > fps || (next.frameRate == fps && next.scale <= scale + 0.001)
            assertTrue("$bps bps is worse than less bitrate was", better)
            fps = next.frameRate
            scale = next.scale
        }
    }

    @Test
    fun `every tier is reachable`() {
        // A ladder whose middle rung nothing lands on is two tiers wearing
        // three names.
        assertEquals(24, rung(405_000.0).frameRate)
        assertEquals(30, rung(2_000_000.0).frameRate)
        assertEquals(60, rung(8_000_000.0).frameRate)
    }

    @Test
    fun `a chosen frame rate is a ceiling, not a starting point`() {
        val capped = ShareQuality.adapt(hd, ShareQuality.screenBitrate(hd), 30, 30_000_000.0)
        assertEquals(30, capped.frameRate)
        assertEquals(24, ShareQuality.adapt(hd, ShareQuality.screenBitrate(hd), 30, 405_000.0).frameRate)
    }

    @Test
    fun `the budget is quoted against the pixels captured`() {
        // The guarded bug is a budget computed for 1080p applied to a 4K
        // capture, which is a share sized for a pipe it is not being sent down.
        val uhd = ShareQuality.Size(3840, 2160)
        val big = ShareQuality.adapt(uhd, ShareQuality.screenBitrate(uhd), 60, 5_000_000.0)
        assertTrue(big.scale > rung(5_000_000.0).scale)
    }

    @Test
    fun `the ladder drops at once and climbs slowly`() {
        val ladder = ShareQuality.Ladder()
        val ceiling = ShareQuality.screenBitrate(hd)
        fun step(bps: Double) = ladder.step(hd, ceiling, ShareQuality.SCREEN_FRAME_RATE, bps)

        // The first reading always applies: nothing to compare it against, and
        // no reason to spend a second on a share that is already wrong.
        assertEquals(60, step(30_000_000.0)?.frameRate)
        // A tick saying the same thing changes nothing. This is what stops a
        // re-encode, and the keyframe behind it, every second forever.
        assertNull(step(30_000_000.0))
        assertNull("a few percent of wobble is not a change", step(28_000_000.0))

        // Down immediately: a link that cannot carry the picture is already
        // dropping frames, and waiting to be sure is more of the bug.
        assertEquals(24, step(405_000.0)?.frameRate)

        // Up slowly - the estimate rises by probing, so the first rise is the
        // probe and not the link. Four readings are not enough; the fifth is.
        for (tick in 1 until 5) assertNull("climbed on reading $tick", step(30_000_000.0))
        assertEquals(60, step(30_000_000.0)?.frameRate)
    }

    @Test
    fun `a run of headroom has to be a run`() {
        // One bad reading mid-run puts the count back to nothing, or a link
        // flapping once a second climbs anyway.
        val ladder = ShareQuality.Ladder()
        val ceiling = ShareQuality.screenBitrate(hd)
        fun step(bps: Double) = ladder.step(hd, ceiling, ShareQuality.SCREEN_FRAME_RATE, bps)

        step(405_000.0)
        step(30_000_000.0)
        step(30_000_000.0)
        step(405_000.0)
        for (tick in 1 until 5) assertNull("climbed on a broken run at $tick", step(30_000_000.0))
        assertNotNull("a whole run must still climb", step(30_000_000.0))
    }

    @Test
    fun `a new capture is a new ladder`() {
        val ladder = ShareQuality.Ladder()
        ladder.step(hd, ShareQuality.screenBitrate(hd), 60, 405_000.0)
        assertNotNull(ladder.position)
        ladder.reset()
        assertNull(ladder.position)
    }
}
