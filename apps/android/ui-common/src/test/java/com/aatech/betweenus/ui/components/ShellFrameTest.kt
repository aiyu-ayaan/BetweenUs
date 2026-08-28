package com.aatech.betweenus.ui.components

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shape of the shell, for the windows nobody testing this will be holding.
 *
 * Every interesting case here is a device or a posture that is awkward to
 * reproduce by hand - a foldable half-opened, a hinge nearer one edge than the
 * other, a tablet in portrait, a freeform window being dragged narrower while
 * the app runs. They are all one function call, so they are asserted here
 * instead of hoped for.
 */
class ShellFrameTest {

    @Test
    fun `a phone in portrait is one pane`() {
        // A small phone, a large phone, and the widest window that is still
        // one - 599dp, one below the boundary.
        for (width in listOf(320.dp, 411.dp, 599.dp)) {
            assertEquals(
                "$width should be a single pane",
                ShellPanes.SINGLE,
                shellFrame(width).panes,
            )
        }
    }

    @Test
    fun `a tablet and a phone in landscape are two panes`() {
        for (width in listOf(600.dp, 800.dp, 1280.dp)) {
            assertEquals(
                "$width should be two panes",
                ShellPanes.TWO,
                shellFrame(width).panes,
            )
        }
    }

    /**
     * The narrowest two-pane window is the one that breaks. A flat fraction of
     * 600dp hands the navigation 210dp, which is a column of truncated channel
     * names next to a conversation - so the lower bound is what makes the
     * boundary case usable rather than merely two panes.
     */
    @Test
    fun `the narrowest two-pane window still leaves both panes usable`() {
        val frame = shellFrame(600.dp)
        assertTrue("nav pane too narrow: ${frame.navPaneWidth}", frame.navPaneWidth >= NAV_PANE_MIN_WIDTH)
        assertTrue(
            "detail pane too narrow: ${600.dp - frame.navPaneWidth}",
            600.dp - frame.navPaneWidth >= DETAIL_PANE_MIN_WIDTH,
        )
    }

    @Test
    fun `a very wide window does not give the navigation the whole of it`() {
        // A desktop-sized freeform window. A third of 2400dp is 800dp of
        // channel list, which is 700dp of nothing.
        assertEquals(NAV_PANE_MAX_WIDTH, shellFrame(2400.dp).navPaneWidth)
    }

    @Test
    fun `an unfolded foldable splits on the hinge and leaves it empty`() {
        // A 7.6-inch book-posture device: two panels either side of a hinge
        // that is a few dp of real gap.
        val frame = shellFrame(width = 674.dp, hingeStart = 333.dp, hingeEnd = 341.dp)

        assertEquals(ShellPanes.TWO, frame.panes)
        assertEquals("the split belongs on the fold", 333.dp, frame.navPaneWidth)
        assertEquals("nothing is drawn on the hinge", 8.dp, frame.hingeGap)
    }

    /**
     * A hinge is a suggestion, not an order. One sitting near an edge would
     * hand a pane less room than it can draw anything in, and the proportional
     * split is the better answer.
     */
    @Test
    fun `a hinge too near an edge is ignored`() {
        // Hinge 60dp from the left: obeying it gives the navigation 60dp.
        val nearLeft = shellFrame(width = 900.dp, hingeStart = 60.dp, hingeEnd = 68.dp)
        assertEquals(ShellPanes.TWO, nearLeft.panes)
        assertTrue(nearLeft.navPaneWidth >= NAV_PANE_MIN_WIDTH)
        assertEquals("no gap when the hinge was not used", 0.dp, nearLeft.hingeGap)

        // Hinge 100dp from the right: obeying it gives the conversation 100dp.
        val nearRight = shellFrame(width = 900.dp, hingeStart = 792.dp, hingeEnd = 800.dp)
        assertTrue(900.dp - nearRight.navPaneWidth >= DETAIL_PANE_MIN_WIDTH)
        assertEquals(0.dp, nearRight.hingeGap)
    }

    /**
     * A folded foldable is a narrow phone that happens to have a hinge behind
     * the screen. Width decides, and it decides first.
     */
    @Test
    fun `a hinge on a narrow window does not force two panes`() {
        val frame = shellFrame(width = 400.dp, hingeStart = 200.dp, hingeEnd = 208.dp)
        assertEquals(ShellPanes.SINGLE, frame.panes)
        assertEquals(0.dp, frame.hingeGap)
    }

    /**
     * A laptop-posture foldable folds top to bottom. It does not split the
     * window left from right, so it never reaches this function as a hinge at
     * all - and a window with no hinge must not grow a gap out of nothing.
     */
    @Test
    fun `no hinge means no gap`() {
        assertEquals(0.dp, shellFrame(1000.dp).hingeGap)
        assertEquals(0.dp, shellFrame(1000.dp, hingeStart = null, hingeEnd = null).hingeGap)
    }

    /** Half-described hinges come back from real devices; neither half alone is a fold. */
    @Test
    fun `a half-described hinge is not a hinge`() {
        assertEquals(0.dp, shellFrame(900.dp, hingeStart = 400.dp, hingeEnd = null).hingeGap)
        assertEquals(0.dp, shellFrame(900.dp, hingeStart = null, hingeEnd = 408.dp).hingeGap)
        // Inverted bounds are nonsense rather than a zero-width fold.
        assertEquals(0.dp, shellFrame(900.dp, hingeStart = 500.dp, hingeEnd = 400.dp).hingeGap)
    }

    /**
     * A flat fold - a crease with no gap - is still where the split belongs.
     * The two panels are separate places to put things even when the seam has
     * no width to leave empty.
     */
    @Test
    fun `a zero-width fold still decides the split`() {
        val frame = shellFrame(width = 800.dp, hingeStart = 400.dp, hingeEnd = 400.dp)
        assertEquals(400.dp, frame.navPaneWidth)
        assertEquals(0.dp, frame.hingeGap)
    }
}
