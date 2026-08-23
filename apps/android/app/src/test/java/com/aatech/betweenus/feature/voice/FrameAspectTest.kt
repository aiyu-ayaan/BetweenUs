package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The shape a frame is drawn in, which is what decides whether a tile
 * letterboxes it or crops it.
 *
 * Worth a test rather than a glance: the rotation is the half that is easy to
 * drop, and dropping it draws a phone's camera on its side - which looks like a
 * broken picture rather than like arithmetic.
 */
class FrameAspectTest {

    @Test
    fun `a landscape frame is wider than it is tall`() {
        assertEquals(16f / 9f, frameAspect(1280, 720, 0)!!, 0.001f)
    }

    @Test
    fun `a quarter turn swaps the sides`() {
        assertEquals(9f / 16f, frameAspect(1280, 720, 90)!!, 0.001f)
        assertEquals(9f / 16f, frameAspect(1280, 720, 270)!!, 0.001f)
    }

    @Test
    fun `half a turn is the shape it started as`() {
        assertEquals(4f / 3f, frameAspect(640, 480, 180)!!, 0.001f)
    }

    @Test
    fun `a negative rotation is still a quarter turn`() {
        assertEquals(3f / 4f, frameAspect(640, 480, -90)!!, 0.001f)
    }

    @Test
    fun `a resolution that says nothing is not a shape`() {
        assertNull(frameAspect(0, 720, 0))
        assertNull(frameAspect(1280, 0, 0))
    }
}
