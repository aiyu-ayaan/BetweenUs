package com.aatech.betweenus.feature.settings

import com.aatech.betweenus.core.data.Pictures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * The centre crop a stored picture is framed to.
 *
 * Worth pinning because the two cases that go wrong are the two nobody has to
 * hand while writing it: a portrait photograph cropped down to a 4:1 band, and
 * a panorama cropped up to a square. Both are arithmetic, so neither needs a
 * decoded bitmap or a device.
 *
 * The desktop pins the same arithmetic in `picture-crop.check.ts`, with the
 * same numbers. Two clients that frame the same photograph differently store
 * two different pictures for one upload.
 */
class PictureCropTest {

    @Test
    fun `a square comes out of the short edge of a landscape photograph`() {
        val box = Pictures.cropBox(1600, 900, 1f)
        assertEquals(900, box.width)
        assertEquals(900, box.height)
        assertEquals(350, box.x)
        assertEquals(0, box.y)
    }

    @Test
    fun `and out of the short edge of a portrait one`() {
        val box = Pictures.cropBox(900, 1600, 1f)
        assertEquals(900, box.width)
        assertEquals(900, box.height)
        assertEquals(0, box.x)
        assertEquals(350, box.y)
    }

    @Test
    fun `an ordinary photograph gives up height to become a cover band`() {
        // 4:3 is far taller than 4:1, so the full width is kept.
        val box = Pictures.cropBox(4000, 3000, Pictures.COVER_ASPECT)
        assertEquals(4000, box.width)
        assertEquals(1000, box.height)
        assertEquals(0, box.x)
        // Taken from the middle, so a horizon stays near the centre.
        assertEquals(1000, box.y)
    }

    @Test
    fun `a panorama gives up width instead`() {
        // 8:1 is flatter than 4:1, so this time width is what runs out.
        val box = Pictures.cropBox(8000, 1000, Pictures.COVER_ASPECT)
        assertEquals(1000, box.height)
        assertEquals(4000, box.width)
        assertEquals(0, box.y)
        assertEquals(2000, box.x)
    }

    @Test
    fun `the crop is always the requested shape and always inside the picture`() {
        // The property that actually matters. A crop that escaped the source
        // draws transparent pixels down one edge, which is the bug this
        // function exists to not have.
        val sizes = listOf(100 to 100, 1920 to 1080, 1080 to 1920, 3000 to 401, 17 to 4001)
        for ((width, height) in sizes) {
            for (aspect in listOf(1f, Pictures.COVER_ASPECT, 16f / 9f)) {
                val box = Pictures.cropBox(width, height, aspect)
                // Within a pixel, not within a ratio. A crop is measured in
                // whole pixels, so on a 17-pixel-wide source the truncation is
                // a quarter of a pixel and 6% of the aspect - checking the
                // ratio to a fixed tolerance fails on exactly the small
                // pictures where being off by one pixel does not matter.
                assertTrue(
                    "$width x $height at $aspect keeps its shape",
                    abs(box.width / aspect - box.height) <= 1f,
                )
                assertTrue("starts inside", box.x >= 0 && box.y >= 0)
                assertTrue(
                    "ends inside",
                    box.x + box.width <= width && box.y + box.height <= height,
                )
            }
        }
    }
}
