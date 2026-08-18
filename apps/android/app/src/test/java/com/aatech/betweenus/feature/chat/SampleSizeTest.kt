package com.aatech.betweenus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * How much a picture is shrunk while it is decoded.
 *
 * The one part of the decode that is arithmetic rather than platform, and the
 * one worth checking: too large a sample size is a blurry picture, too small is
 * a decode that saves nothing - and both look like somebody else's bug rather
 * than a number in this file.
 */
class SampleSizeTest {

    @Test
    fun `a picture already small enough is not shrunk`() {
        assertEquals(1, sampleSizeFor(800, 600, 1080))
        assertEquals(1, sampleSizeFor(1080, 1080, 1080))
    }

    @Test
    fun `a phone photo is halved until it is about the target`() {
        // 4000 -> 2000 -> 1000, and 1000 is under the target, so it stops at 2.
        assertEquals(2, sampleSizeFor(4000, 3000, 1080))
        // 8000 -> 4000 -> 2000 -> 1000.
        assertEquals(4, sampleSizeFor(8000, 6000, 1080))
    }

    @Test
    fun `the longest edge is what decides, whichever way round it is`() {
        assertEquals(sampleSizeFor(4000, 500, 1080), sampleSizeFor(500, 4000, 1080))
    }

    @Test
    fun `the result never leaves it softer than what is drawn`() {
        // The rule: after shrinking, the longest edge is still at or above the
        // target - anything else is a picture drawn larger than it was decoded.
        for (edge in listOf(1081, 2000, 2160, 4000, 6000, 12000)) {
            val sample = sampleSizeFor(edge, edge / 2, 1080)
            assert(edge / sample >= 1080) { "$edge / $sample is under the target" }
        }
    }

    @Test
    fun `a size the decoder could not read is left alone`() {
        // `inJustDecodeBounds` reports -1 for anything it cannot parse, and a
        // sample size derived from that would be a crash or a blank row.
        assertEquals(1, sampleSizeFor(-1, -1, 1080))
        assertEquals(1, sampleSizeFor(0, 0, 1080))
        assertEquals(1, sampleSizeFor(4000, 3000, 0))
    }
}
