package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    // --- The resolution ladder ---
    //
    // The desktop's, rule for rule: `share-quality.check.ts` asserts the same
    // answers on the other side.

    private fun reading(limitedBy: String?, fps: Double?) =
        ShareQuality.Reading(limitedBy, fps)

    @Test
    fun `a still screen is never treated as a fault`() {
        // A capturer only emits a frame when pixels change, so a terminal
        // nobody is typing in at 4 fps and a few kbps is a correct answer. The
        // first version of this ladder read exactly that as a small link and
        // shrank the picture, on loopback, where capacity is unlimited.
        assertFalse(ShareQuality.isStarved(reading(null, 4.0)))
        assertFalse(ShareQuality.isStarved(reading(null, 0.0)))
        assertFalse(ShareQuality.isStarved(reading(null, 2.0)))
    }

    @Test
    fun `neither half of the signal is enough on its own`() {
        // `bandwidth` shows up transiently on shares that are completely fine.
        assertFalse(ShareQuality.isStarved(reading("bandwidth", 60.0)))
        assertFalse(ShareQuality.isStarved(reading("bandwidth", 30.0)))
        // A CPU limit wants fewer frames, not fewer pixels.
        assertFalse(ShareQuality.isStarved(reading("cpu", 2.0)))
        // No frame rate reported is not evidence of anything.
        assertFalse(ShareQuality.isStarved(reading("bandwidth", null)))
    }

    @Test
    fun `both together is the encoder saying it could not send more`() {
        assertTrue(ShareQuality.isStarved(reading("bandwidth", 3.0)))
        assertTrue(ShareQuality.isStarved(reading("bandwidth", 12.0)))
    }

    @Test
    fun `a healthy or quiet share never costs pixels`() {
        val ladder = ShareQuality.Ladder()
        assertEquals(1.0, ladder.scale, 0.001)
        assertFalse(ladder.step(reading(null, 58.0)))
        assertFalse(ladder.step(reading(null, 4.0)))
        assertFalse(ladder.step(reading(null, 4.0)))
        assertEquals(1.0, ladder.scale, 0.001)
    }

    @Test
    fun `the ladder steps down on a sustained collapse and stops at the bottom`() {
        val ladder = ShareQuality.Ladder()
        val starved = reading("bandwidth", 3.0)

        assertFalse("one reading is a hiccup", ladder.step(starved))
        assertTrue(ladder.step(starved))
        assertEquals(1.5, ladder.scale, 0.001)

        assertFalse(ladder.step(starved))
        assertTrue(ladder.step(starved))
        assertEquals(2.0, ladder.scale, 0.001)

        repeat(20) { ladder.step(starved) }
        assertEquals("the ladder has a bottom", 3.0, ladder.scale, 0.001)
    }

    @Test
    fun `climbing back needs a sustained run, one step at a time`() {
        val ladder = ShareQuality.Ladder()
        val starved = reading("bandwidth", 3.0)
        val healthy = reading(null, 58.0)
        ladder.step(starved)
        ladder.step(starved)
        ladder.step(starved)
        ladder.step(starved)
        assertEquals(2.0, ladder.scale, 0.001)

        for (tick in 1 until 6) assertFalse("climbed on reading $tick", ladder.step(healthy))
        assertTrue(ladder.step(healthy))
        assertEquals(1.5, ladder.scale, 0.001)
    }

    @Test
    fun `a quiet screen counts toward the climb`() {
        // The opposite of the old behaviour, where quiet meant shrink. There is
        // no evidence left that the link is the problem, and the only way to
        // find out is to try a bigger picture.
        val ladder = ShareQuality.Ladder()
        ladder.step(reading("bandwidth", 3.0))
        ladder.step(reading("bandwidth", 3.0))
        assertEquals(1.5, ladder.scale, 0.001)

        val quiet = reading(null, 4.0)
        for (tick in 1 until 6) ladder.step(quiet)
        assertTrue(ladder.step(quiet))
        assertEquals(1.0, ladder.scale, 0.001)
    }

    @Test
    fun `a run has to be a run`() {
        val ladder = ShareQuality.Ladder()
        val starved = reading("bandwidth", 3.0)
        val healthy = reading(null, 58.0)
        ladder.step(starved)
        ladder.step(starved)
        ladder.step(healthy)
        ladder.step(healthy)
        ladder.step(starved)
        for (tick in 1 until 6) assertFalse("climbed on a broken run at $tick", ladder.step(healthy))
        assertTrue(ladder.step(healthy))
    }

    @Test
    fun `a new capture starts at the top`() {
        val ladder = ShareQuality.Ladder()
        ladder.step(reading("bandwidth", 3.0))
        ladder.step(reading("bandwidth", 3.0))
        assertEquals(1.5, ladder.scale, 0.001)
        ladder.reset()
        assertEquals(1.0, ladder.scale, 0.001)
    }
}
