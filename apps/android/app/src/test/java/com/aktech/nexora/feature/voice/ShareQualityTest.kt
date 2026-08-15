package com.aktech.nexora.feature.voice

import org.junit.Assert.assertEquals
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
}
