package com.aatech.betweenus.ui.components

import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.currentWindowSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * How much of the app fits on screen at once.
 *
 * A phone shows one thing and reaches the rest through a drawer. A tablet, an
 * unfolded foldable and a phone turned sideways have room for the channel list
 * *and* the conversation, and hiding one behind a hamburger on a 10-inch screen
 * is throwing away the screen.
 */
enum class ShellPanes {
    /** The navigation lives in a modal drawer, over the content. */
    SINGLE,

    /** The navigation lives permanently beside the content. */
    TWO,
}

/**
 * The shape of the shell for one window: how many panes, how wide the first one
 * is, and what to leave empty between them.
 */
data class ShellFrame(
    val panes: ShellPanes,
    /** Meaningless when [panes] is [ShellPanes.SINGLE]. */
    val navPaneWidth: Dp,
    /**
     * The gap between the two panes, which is the hinge when there is one.
     *
     * A folding screen is two panels with a physical seam between them. Content
     * drawn across that seam is content drawn on a hinge - unreadable on a book-
     * posture device and cut in half on one with a real gap - so the seam is
     * left empty rather than covered.
     */
    val hingeGap: Dp,
)

/**
 * Below this, one pane. It is the Material window-size-class boundary between
 * compact and medium, which is where a phone in portrait stops and everything
 * else starts - a large phone in landscape, a small tablet, an unfolded
 * foldable.
 */
val TWO_PANE_MIN_WIDTH: Dp = 600.dp

/** Narrower than this and the channel list stops being a list and starts being a column of ellipses. */
val NAV_PANE_MIN_WIDTH: Dp = 280.dp

/** Wider than this it is just empty space; the rail and one column of channels is all it holds. */
val NAV_PANE_MAX_WIDTH: Dp = 360.dp

/** A conversation narrower than this is a phone screen's worth, and below it messages stop being readable. */
val DETAIL_PANE_MIN_WIDTH: Dp = 320.dp

/** How much of a wide window the navigation takes when no hinge decides for it. */
private const val NAV_PANE_FRACTION = 0.35f

/**
 * Decides the shell's shape from the window and the hardware.
 *
 * Pure, and separated from the composable that feeds it, because every
 * interesting case here is a device nobody testing this will be holding: a
 * foldable half-opened, a hinge closer to one edge than the other, a tablet in
 * portrait. Those are cheap to assert about and expensive to find by hand.
 *
 * [hingeStart] and [hingeEnd] describe a *vertical, separating* fold only.
 * A horizontal one - a laptop-posture foldable, screen above keyboard - does
 * not split the window left from right and so has no bearing on this.
 */
fun shellFrame(width: Dp, hingeStart: Dp? = null, hingeEnd: Dp? = null): ShellFrame {
    if (width < TWO_PANE_MIN_WIDTH) return ShellFrame(ShellPanes.SINGLE, 0.dp, 0.dp)

    // A hinge is where the split belongs, when it leaves both halves usable.
    // Ignoring it would put the channel list across the fold on exactly the
    // devices this exists for; obeying one that sits 40dp from the edge would
    // give the navigation a pane it cannot draw anything in.
    if (
        hingeStart != null &&
        hingeEnd != null &&
        hingeEnd >= hingeStart &&
        hingeStart >= NAV_PANE_MIN_WIDTH &&
        width - hingeEnd >= DETAIL_PANE_MIN_WIDTH
    ) {
        return ShellFrame(ShellPanes.TWO, hingeStart, hingeEnd - hingeStart)
    }

    // No usable hinge: a share of the width, bounded at both ends. The lower
    // bound is what makes the narrowest two-pane window still work - at exactly
    // TWO_PANE_MIN_WIDTH the fraction would hand the navigation 210dp, which is
    // a column of truncated channel names.
    val proportional = width * NAV_PANE_FRACTION
    return ShellFrame(
        panes = ShellPanes.TWO,
        navPaneWidth = proportional.coerceIn(NAV_PANE_MIN_WIDTH, NAV_PANE_MAX_WIDTH),
        hingeGap = 0.dp,
    )
}

/**
 * [shellFrame] for the window this composable is drawn in.
 *
 * Recomposes when the window changes, which on Android is not only a rotation:
 * unfolding a phone, dragging a freeform window's edge and entering split
 * screen all resize it while the app is running, and all three used to leave
 * the layout as whatever it was at launch.
 *
 * The width is read from the window rather than from a size class enum on
 * purpose. The enum has been renamed more than once across the adaptive
 * library's versions, and what this actually needs is a number.
 */
@Composable
fun rememberShellFrame(): ShellFrame {
    val windowSize = currentWindowSize()
    val posture = currentWindowAdaptiveInfo().windowPosture
    val density = LocalDensity.current

    // Only a fold that is both vertical and separating splits the window into
    // two places to put things. A flat one is a screen with a crease, which is
    // still one screen.
    val hinge = posture.hingeList.firstOrNull { it.isVertical && it.isSeparating }

    return remember(windowSize, hinge, density) {
        with(density) {
            shellFrame(
                width = windowSize.width.toDp(),
                hingeStart = hinge?.bounds?.left?.toDp(),
                hingeEnd = hinge?.bounds?.right?.toDp(),
            )
        }
    }
}
