package com.aatech.betweenus.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalInspectionMode
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What the two faces of the mark do. */
enum class MarkMotion {
    /** Nothing: the mark at rest. */
    Still,

    /** They slide in from either side and lean in, once - the splash's entrance. */
    In,

    /**
     * From rest, leaning in by turns for as long as it is on screen. No
     * entrance: on Android the system splash has just played it.
     */
    Talk,
}

/** The same curve the desktop uses for the entrance (`mark-in-l` in index.css). */
private val EnterEasing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

/** How far apart the faces start, in 256-box units each side. Same as the splashes. */
private const val SPREAD = 36f

/** How far a face leans in while talking. */
private const val LEAN = 4f

/**
 * The BetweenUs mark: two faces leaning in, the gap between them what they
 * share. Drawn from [BrandMarkPaths], which design/brand/build.py writes, as
 * two halves so they can move.
 *
 * [small] is the cut with only a nose and a chin, for 24dp and under, where
 * the full drawing's lips close up.
 */
@Composable
fun BetweenUsMark(
    color: Color,
    modifier: Modifier = Modifier,
    small: Boolean = false,
    motion: MarkMotion = MarkMotion.Still,
) {
    val (left, right) = remember(small) {
        val l = if (small) BrandMarkPaths.LEFT_SMALL else BrandMarkPaths.LEFT
        val r = if (small) BrandMarkPaths.RIGHT_SMALL else BrandMarkPaths.RIGHT
        PathParser().parsePathString(l).toPath() to PathParser().parsePathString(r).toPath()
    }

    // Previews and screenshots get the mark at rest: an animation that has not
    // started is two invisible faces.
    val animate = motion != MarkMotion.Still && !LocalInspectionMode.current
    val enter = animate && motion == MarkMotion.In
    val offsetL = remember { Animatable(if (enter) -SPREAD else 0f) }
    val offsetR = remember { Animatable(if (enter) SPREAD else 0f) }
    val alphaL = remember { Animatable(if (enter) 0f else 1f) }
    val alphaR = remember { Animatable(if (enter) 0f else 1f) }

    if (animate) {
        LaunchedEffect(motion) {
            if (enter) coroutineScope {
                // In from either side, 80ms apart, overshooting into each other
                // by a hair before settling - as in the splash.
                launch { alphaL.animateTo(1f, tween(320, easing = LinearEasing)) }
                launch {
                    offsetL.animateTo(0f, keyframes {
                        durationMillis = 680
                        2f at 476 using EnterEasing
                    })
                }
                launch {
                    delay(80)
                    launch { alphaR.animateTo(1f, tween(320, easing = LinearEasing)) }
                    offsetR.animateTo(0f, keyframes {
                        durationMillis = 680
                        -2f at 476 using EnterEasing
                    })
                }
            }
            if (motion != MarkMotion.Talk) return@LaunchedEffect
            delay(300)
            // A conversation: the left face leans in and back, then the right.
            while (true) {
                offsetL.animateTo(LEAN, tween(600, easing = FastOutSlowInEasing))
                offsetL.animateTo(0f, tween(600, easing = FastOutSlowInEasing))
                offsetR.animateTo(-LEAN, tween(600, easing = FastOutSlowInEasing))
                offsetR.animateTo(0f, tween(600, easing = FastOutSlowInEasing))
            }
        }
    }

    Canvas(modifier) {
        val unit = size.minDimension / 256f
        translate((size.width - 256f * unit) / 2f, (size.height - 256f * unit) / 2f) {
            scale(unit, unit, pivot = Offset.Zero) {
                translate(left = offsetL.value) { drawPath(left, color, alpha = alphaL.value) }
                translate(left = offsetR.value) { drawPath(right, color, alpha = alphaR.value) }
            }
        }
    }
}
