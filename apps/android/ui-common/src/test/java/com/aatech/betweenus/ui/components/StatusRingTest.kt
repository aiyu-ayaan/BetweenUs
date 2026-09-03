package com.aatech.betweenus.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The segmented ring's geometry.
 *
 * Worth asserting because it is arithmetic nobody reads back off the screen: an
 * off-by-one in the angles draws overlapping arcs or a gap that grows around
 * the circle, and it looks like a rendering quirk rather than a bug in a
 * formula. The same assertions the desktop makes in `StatusRing.check.ts`.
 */
class StatusRingTest {

    @Test
    fun `one post is a whole circle with no notch in it`() {
        val arcs = ringArcs(1)
        assertEquals(1, arcs.size)
        assertEquals(360f, arcs[0].sweepDegrees, 0.001f)
        // Starting at the top, not at three o'clock: a ring that starts on the
        // side looks tilted next to a circular avatar.
        assertEquals(-90f, arcs[0].startDegrees, 0.001f)
    }

    @Test
    fun `four posts are four evenly spaced arcs`() {
        val arcs = ringArcs(4)
        assertEquals(4, arcs.size)
        arcs.forEachIndexed { index, arc ->
            assertEquals(-90f + index * 90f + 3f, arc.startDegrees, 0.001f)
            assertEquals(84f, arc.sweepDegrees, 0.001f)
        }
    }

    @Test
    fun `the arcs and the gaps between them are exactly one circle`() {
        val arcs = ringArcs(7)
        val drawn = arcs.sumOf { it.sweepDegrees.toDouble() }
        // Seven arcs, seven gaps, and no drift: what is not drawn is the gaps.
        assertEquals(360.0 - 7 * 6.0, drawn, 0.001)
    }

    @Test
    fun `past the point where arcs are shorter than gaps the ring goes solid`() {
        assertEquals(MAX_STATUS_SEGMENTS, ringArcs(MAX_STATUS_SEGMENTS).size)
        val many = ringArcs(MAX_STATUS_SEGMENTS + 1)
        assertEquals(1, many.size)
        assertEquals(360f, many[0].sweepDegrees, 0.001f)
    }

    @Test
    fun `nothing posted does not divide by zero`() {
        // The caller draws no ring at all for a zero, but a zero reaching here
        // must not come back as NaN.
        val arcs = ringArcs(0)
        assertEquals(1, arcs.size)
        assertTrue(arcs[0].sweepDegrees.isFinite())
    }
}
