package com.aatech.betweenus.feature.voice

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * How long a call has been running, as the strip along the top draws it.
 *
 * The cases that matter are the boundaries: seconds are always padded and
 * minutes never are - `4:07`, the way every phone on the planet draws this -
 * and the hour only appears once there has been one.
 */
class ElapsedTest {

    @Test
    fun `a call that has just started`() {
        assertEquals("0:00", formatElapsed(0))
        assertEquals("0:09", formatElapsed(9))
    }

    @Test
    fun `seconds are padded and minutes are not`() {
        assertEquals("4:07", formatElapsed(4 * 60 + 7))
        assertEquals("12:00", formatElapsed(12 * 60))
    }

    @Test
    fun `the hour appears only once there has been one`() {
        assertEquals("59:59", formatElapsed(59 * 60 + 59))
        assertEquals("1:00:00", formatElapsed(3600))
        assertEquals("1:04:07", formatElapsed(3600 + 4 * 60 + 7))
        assertEquals("10:00:00", formatElapsed(10 * 3600))
    }
}
