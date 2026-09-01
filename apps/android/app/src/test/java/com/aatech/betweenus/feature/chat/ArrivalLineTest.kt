package com.aatech.betweenus.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The sentence an arrival gets, which is derived rather than stored.
 *
 * The point of these is the last two: they pin the same numbers
 * `apps/desktop/src/features/chat/arrival.check.ts` pins. A phone and a laptop
 * looking at the same conversation have to say the same thing happened in it,
 * and nothing in the row itself says what that is - so the only thing holding
 * the two clients together is that they compute it the same way.
 */
class ArrivalLineTest {

    @Test
    fun `the same id always gets the same line`() {
        val id = "3f1c0b2e-9a4d-4e7b-8c11-6d5a2f0e9b73"
        assertEquals(arrivalLine(id), arrivalLine(id))
    }

    @Test
    fun `an empty id is still a line rather than a crash`() {
        assertEquals("is here.", arrivalLine(""))
    }

    /** 'a' is 97, and 97 % 6 is 1. The desktop check asserts the same. */
    @Test
    fun `single character matches the desktop`() {
        assertEquals("just landed.", arrivalLine("a"))
    }

    /** 97 * 31 + 98 = 3105, and 3105 % 6 is 3. The desktop check asserts the same. */
    @Test
    fun `two characters match the desktop`() {
        assertEquals("joined the party.", arrivalLine("ab"))
    }
}
