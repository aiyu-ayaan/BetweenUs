package com.aktech.nexora.feature.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The message list's latch.
 *
 * Every case here is a bug somebody has already reported: a channel of photos
 * that stopped following the conversation, a chat that opened somewhere in the
 * middle of itself. The rule is arithmetic, so it is checked as arithmetic
 * rather than by scrolling a phone.
 *
 * The desktop's `follow.check.ts` holds the same cases against a scroll
 * position. If one of these ever has to change, so does that one.
 */
class FollowTest {

    @Test
    fun `at the end of the conversation, however it got there`() {
        assertTrue(nextFollow(following = true, scrolledUp = false, gapPx = 0))
        assertTrue(nextFollow(following = false, scrolledUp = false, gapPx = 0))
        // Coming back to the end re-pins even though the reader scrolled to get
        // there - the direction stops mattering once they have arrived.
        assertTrue(nextFollow(following = false, scrolledUp = true, gapPx = 0))
        // Within the slack still counts: a fling that is a pixel from settling
        // must not read as somebody walking away.
        assertTrue(nextFollow(following = true, scrolledUp = false, gapPx = FOLLOW_SLACK_PX - 1))
    }

    @Test
    fun `the reader scrolling up is what stops the following`() {
        assertFalse(nextFollow(following = true, scrolledUp = true, gapPx = 900))
        // And having stopped, scrolling down without reaching the end does not
        // start it again on its own.
        assertFalse(nextFollow(following = false, scrolledUp = false, gapPx = 900))
    }

    @Test
    fun `a row growing must never stop the following`() {
        // A picture decrypted and its row became three hundred taller: the end
        // of the list is suddenly far below the screen and nobody scrolled.
        // This is the case the old rule got wrong.
        assertTrue(nextFollow(following = true, scrolledUp = false, gapPx = 300))
        // A channel of them, one after another.
        var following = true
        for (gap in listOf(300, 640, 980, 1320)) {
            following = nextFollow(following, scrolledUp = false, gapPx = gap)
        }
        assertTrue(following)
        // A reader who had already walked away is not dragged back by any of it.
        assertFalse(nextFollow(following = false, scrolledUp = false, gapPx = 300))
    }

    @Test
    fun `the newest message being off screen is as far away as it gets`() {
        // Scrolled up into history: the last row laid out is not the last row
        // there is, so there is nothing to measure and no need to.
        assertEquals(Int.MAX_VALUE, bottomGap(40, 1200, totalItems = 80, viewportEnd = 2000))
        // The newest message is on screen and its bottom is above the fold.
        assertEquals(-140, bottomGap(79, 1860, totalItems = 80, viewportEnd = 2000))
        // On screen, and hanging 300 below it - the row that just grew.
        assertEquals(300, bottomGap(79, 2300, totalItems = 80, viewportEnd = 2000))
    }

    @Test
    fun `up is the first visible item, then how far into it`() {
        assertTrue(scrolledUp(previous = 8 to 40, current = 7 to 900))
        assertTrue(scrolledUp(previous = 8 to 400, current = 8 to 40))
        assertFalse(scrolledUp(previous = 8 to 40, current = 9 to 0))
        assertFalse(scrolledUp(previous = 8 to 40, current = 8 to 400))
        // Standing still is not scrolling in either direction.
        assertFalse(scrolledUp(previous = 8 to 40, current = 8 to 40))
    }

    @Test
    fun `growth pushing the end away leaves the list following, and a jump back`() {
        // The whole sequence, as it happens when a channel of photos opens:
        // pinned at the end, four rows decrypt and grow, and the list is still
        // following - so the correction after each one puts it back.
        var following = true
        var position = 12 to 0
        for (gap in listOf(0, 300, 0, 620, 0, 940, 0)) {
            // The list only ever moves down when it is the one moving.
            val next = if (gap == 0) position.first + 1 to 0 else position
            following = nextFollow(following, scrolledUp(position, next), gap)
            position = next
        }
        assertTrue("growth must leave the list following", following)
    }
}
