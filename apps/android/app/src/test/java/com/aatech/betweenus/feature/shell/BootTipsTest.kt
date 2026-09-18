package com.aatech.betweenus.feature.shell

import com.aatech.betweenus.core.data.Session
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The boot screen's timing and copy.
 *
 * The animation itself cannot be asserted here. What can, and what would
 * otherwise only be caught by somebody staring at a launch they were not trying
 * to look at, is the same set of invariants `LoadingScreen.check.ts` holds the
 * desktop to - a tip that arrives before the wait is a wait, a rotation shorter
 * than the line takes to read, or a line long enough to shove the mark up the
 * screen mid-wait.
 */
class BootTipsTest {

    @Test
    fun `a tip does not flash up during an ordinary fast start`() {
        // It has to outlast the floor the splash itself is held for, or it is
        // on screen for the few hundred milliseconds between the two.
        assertTrue(BootTips.TIP_DELAY_MS > Session.MIN_SPLASH_MS)
    }

    @Test
    fun `the splash is held long enough to be seen, and no longer`() {
        assertTrue("below this the mark is a flash", Session.MIN_SPLASH_MS >= 900)
        assertTrue("held this long it is a delay, not a splash", Session.MIN_SPLASH_MS <= 2000)
    }

    @Test
    fun `a tip stays up long enough to be read`() {
        val longest = BootTips.TIPS.maxOf { it.split(" ").size }
        // Roughly 200ms a word at a lazy pace.
        assertTrue(
            "rotation ${BootTips.TIP_ROTATE_MS}ms is shorter than the longest tip takes to read",
            BootTips.TIP_ROTATE_MS >= longest * 200L,
        )
    }

    @Test
    fun `the list is long enough and says each thing once`() {
        assertTrue(BootTips.TIPS.size >= 3)
        assertEquals(BootTips.TIPS.toSet().size, BootTips.TIPS.size)
    }

    @Test
    fun `every tip fits the two lines reserved for it`() {
        for (tip in BootTips.TIPS) {
            assertTrue("an empty tip is a gap that looks like a failure", tip.isNotBlank())
            assertTrue("too long for the reserved two lines: $tip", tip.length <= 96)
            assertTrue("a tip is a sentence and ends like one: $tip", tip.endsWith(".") || tip.endsWith("?"))
        }
    }

    @Test
    fun `no tip claims progress`() {
        // There is none to claim - a token refresh answers or it does not - and
        // a percentage on a screen nobody is measuring is the one lie a loading
        // screen is always tempted into.
        val forbidden = Regex("%|loading|please wait", RegexOption.IGNORE_CASE)
        for (tip in BootTips.TIPS) {
            assertTrue("a tip is not a progress report: $tip", !forbidden.containsMatchIn(tip))
        }
    }

    @Test
    fun `the phone is not told to press a key it does not have`() {
        assertTrue(BootTips.phoneTips.none { it.contains("Ctrl") })
        // And dropping it is a filter on the shared list, never a second list:
        // one line removed, everything else identical to the desktop's.
        assertEquals(BootTips.TIPS.size - 1, BootTips.phoneTips.size)
        assertTrue(BootTips.TIPS.containsAll(BootTips.phoneTips))
    }
}
