package com.aatech.betweenus.feature.voice

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Where the self-view lands when it is let go.
 *
 * The tile is dragged in stage pixels and settles into a corner, and the two
 * things that make that wrong are both arithmetic: a corner worked out from
 * the tile's top-left rather than its centre snaps the wrong way for every
 * drag that ends past the middle by less than half a tile, and insets bigger
 * than the stage produce a range that runs backwards.
 */
class PipCornerTest {

    private val stage = Size(1080f, 2400f)
    private val tile = Size(300f, 420f)
    private val side = 40f
    private val top = 200f
    private val bottom = 300f

    private val bounds = pipBounds(stage, tile, side, top, bottom)

    private fun corner(x: Float, y: Float) = pipNearestCorner(bounds, stage, tile, Offset(x, y))

    @Test
    fun `the bounds are the four resting places`() {
        assertEquals(40f, bounds.left, 0.01f)
        assertEquals(200f, bounds.top, 0.01f)
        // 1080 - 300 - 40, and 2400 - 420 - 300.
        assertEquals(740f, bounds.right, 0.01f)
        assertEquals(1680f, bounds.bottom, 0.01f)
    }

    @Test
    fun `each quadrant settles into its own corner`() {
        assertEquals(Offset(40f, 200f), corner(100f, 300f))
        assertEquals(Offset(740f, 200f), corner(700f, 300f))
        assertEquals(Offset(40f, 1680f), corner(100f, 2000f))
        assertEquals(Offset(740f, 1680f), corner(700f, 2000f))
    }

    @Test
    fun `it is the tile's centre that picks the corner, not its top-left`() {
        // Top-left at 400 is left of the 540 midline, but the tile spans
        // 400..700 and its centre is at 550 - so it belongs on the right.
        assertEquals(bounds.right, corner(400f, 1000f).x, 0.01f)
        // And one pixel further left it does not.
        assertEquals(bounds.left, corner(389f, 1000f).x, 0.01f)
    }

    @Test
    fun `a stage with no room left collapses rather than inverting`() {
        val cramped = pipBounds(Size(200f, 400f), tile, side, top, bottom)
        assertEquals(side, cramped.left, 0.01f)
        assertEquals(side, cramped.right, 0.01f)
        assertEquals(top, cramped.top, 0.01f)
        assertEquals(top, cramped.bottom, 0.01f)
        // Which is still a position the tile can be clamped to, not a range
        // that throws when it is used as one.
        assertEquals(
            side,
            500f.coerceIn(cramped.left, cramped.right),
            0.01f,
        )
    }
}
