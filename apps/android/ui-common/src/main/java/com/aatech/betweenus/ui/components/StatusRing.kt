package com.aatech.betweenus.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aatech.betweenus.ui.theme.StatusOnline

/**
 * The ring around an avatar that says somebody has posted, split into one arc
 * per post.
 *
 * The split is the point: a solid ring says "there is something here" and a
 * ring in four pieces says "there are four things here", which is the question
 * people have before deciding to open it. The same device the tray uses to
 * count, so the count is never a number to read.
 *
 * The port of `apps/desktop/src/components/StatusRing.tsx`; the arithmetic in
 * [ringArcs] is the same and is tested in `StatusRingTest`. If one changes, so
 * does the other.
 */

/** The gap between two arcs, in degrees. */
private const val GAP_DEGREES = 6f

/**
 * Above this the arcs would be shorter than the gaps between them, so the
 * count stops being drawn and the ring goes solid. It stopped being legible
 * well before that.
 */
const val MAX_STATUS_SEGMENTS = 12

/** One arc: where it starts, clockwise from twelve o'clock, and how long it is. */
data class StatusArc(val startDegrees: Float, val sweepDegrees: Float)

/**
 * One entry per post.
 *
 * A single post gets the whole circle with no notch in it - a lone arc with a
 * gap in it reads as a rendering fault rather than as a count of one.
 */
fun ringArcs(count: Int): List<StatusArc> {
    if (count <= 1 || count > MAX_STATUS_SEGMENTS) return listOf(StatusArc(-90f, 360f))
    val step = 360f / count
    return (0 until count).map { index ->
        // -90 puts the first arc at the top; a ring that starts at three
        // o'clock looks tilted next to a circular avatar.
        StatusArc(startDegrees = -90f + index * step + GAP_DEGREES / 2f, sweepDegrees = step - GAP_DEGREES)
    }
}

/**
 * Draws the ring just outside whatever it is laid over.
 *
 * Green while there is something unopened and grey once there is not - the two
 * states everybody already reads without being told which is which.
 */
@Composable
fun StatusRing(
    count: Int,
    unseen: Boolean,
    size: Dp,
    modifier: Modifier = Modifier,
    width: Dp = 2.5.dp,
    seenColor: Color = Color(0xFF6B7280),
) {
    if (count <= 0) return
    val colour = if (unseen) StatusOnline else seenColor
    Canvas(modifier = modifier) {
        val stroke = width.toPx()
        // Inset by half the stroke so the ring is drawn inside the box rather
        // than half outside it, which is what clips it against a list row.
        val inset = stroke / 2f
        val diameter = size.toPx() - stroke
        ringArcs(count).forEach { arc ->
            drawArc(
                color = colour,
                startAngle = arc.startDegrees,
                sweepAngle = arc.sweepDegrees,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = Size(diameter, diameter),
                style = Stroke(width = stroke, cap = androidx.compose.ui.graphics.StrokeCap.Round),
            )
        }
    }
}
