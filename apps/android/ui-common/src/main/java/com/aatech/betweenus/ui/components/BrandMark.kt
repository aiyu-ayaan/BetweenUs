package com.aatech.betweenus.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
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

/** What the mark does. */
enum class MarkMotion {
    /** Nothing: the mark at rest. */
    Still,

    /** The bubble pops, the stem rises out of it, the tail flicks out - once. */
    In,

    /**
     * From rest, three typing dots playing in the bowl for as long as it is on
     * screen. No entrance: on Android the system splash has just played it.
     */
    Talk,
}

/** The same curve the desktop uses for the entrance (`mark-stem-in` in index.css). */
private val EnterEasing = CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)

/** One typing dot's round, and how far behind each other they run. */
private const val DOT_CYCLE_MS = 1200
private const val DOT_STAGGER_MS = 150

/** How far a dot hops while it is lit, in 256-box units. */
private const val DOT_HOP = 6f

/**
 * The BetweenUs mark: a lowercase b whose bowl is a speech bubble. Drawn from
 * [BrandMarkPaths], which design/brand/build.py writes, as three parts so it
 * can move, plus the typing dots that play in the bowl while it waits.
 *
 * [small] is the heavier cut for 24dp and under, where the counter would
 * otherwise close up.
 */
@Composable
fun BetweenUsMark(
    color: Color,
    modifier: Modifier = Modifier,
    small: Boolean = false,
    motion: MarkMotion = MarkMotion.Still,
) {
    val paths = remember(small) {
        val p = BrandMarkPaths
        listOf(
            if (small) p.STEM_SMALL else p.STEM,
            if (small) p.TAIL_SMALL else p.TAIL,
            if (small) p.BOWL_SMALL else p.BOWL,
        ).map { PathParser().parsePathString(it).toPath() }
    }
    val (stem, tail, bowl) = paths

    // Previews and screenshots get the mark at rest: an animation that has not
    // started is an invisible mark.
    val animate = motion != MarkMotion.Still && !LocalInspectionMode.current
    val enter = animate && motion == MarkMotion.In
    val bowlScale = remember { Animatable(if (enter) 0.3f else 1f) }
    val bowlAlpha = remember { Animatable(if (enter) 0f else 1f) }
    val stemScale = remember { Animatable(if (enter) 0f else 1f) }
    val tailScale = remember { Animatable(if (enter) 0f else 1f) }

    if (enter) {
        LaunchedEffect(Unit) {
            coroutineScope {
                // The same beats as the splash: pop, rise, flick.
                launch { bowlAlpha.animateTo(1f, tween(150, easing = LinearEasing)) }
                launch {
                    bowlScale.animateTo(1f, keyframes {
                        durationMillis = 450
                        1.06f at 290 using EnterEasing
                    })
                }
                launch {
                    delay(130)
                    stemScale.animateTo(1f, tween(380, easing = EnterEasing))
                }
                launch {
                    delay(340)
                    tailScale.animateTo(1f, keyframes {
                        durationMillis = 320
                        1.15f at 190 using EnterEasing
                    })
                }
            }
        }
    }

    val dots = if (animate && motion == MarkMotion.Talk) typingDots() else null

    Canvas(modifier) {
        val unit = size.minDimension / 256f
        translate((size.width - 256f * unit) / 2f, (size.height - 256f * unit) / 2f) {
            scale(unit, unit, pivot = Offset.Zero) {
                scale(1f, stemScale.value, pivot = Offset(0f, BrandMarkPaths.STEM_FOOT_Y)) {
                    drawPath(stem, color)
                }
                scale(tailScale.value, pivot = Offset(BrandMarkPaths.TAIL_X, BrandMarkPaths.TAIL_Y)) {
                    drawPath(tail, color)
                }
                scale(bowlScale.value, pivot = Offset(BrandMarkPaths.BOWL_X, BrandMarkPaths.BOWL_Y)) {
                    drawPath(bowl, color, alpha = bowlAlpha.value)
                }
                dots?.forEachIndexed { i, lit ->
                    val t = lit.value
                    if (t > 0f) {
                        drawCircle(
                            color = color,
                            radius = BrandMarkPaths.DOT_R * (0.6f + 0.4f * t),
                            center = Offset(BrandMarkPaths.DOTS_X[i], BrandMarkPaths.BOWL_Y - DOT_HOP * t),
                            alpha = t,
                        )
                    }
                }
            }
        }
    }
}

/**
 * The three dots in the bowl, each 0 (out) to 1 (lit and hopped), running a
 * little behind the one before - somebody typing. The first starts 150ms in,
 * so a mark that has only just taken over from the splash does not change at
 * once.
 */
@Composable
private fun typingDots(): List<State<Float>> {
    val transition = rememberInfiniteTransition(label = "typing")
    return List(BrandMarkPaths.DOTS_X.size) { i ->
        transition.animateFloat(
            initialValue = 0f,
            targetValue = 0f,
            animationSpec = infiniteRepeatable(
                animation = keyframes {
                    durationMillis = DOT_CYCLE_MS
                    0f at 0
                    1f at 240 using FastOutSlowInEasing
                    0f at 600 using FastOutSlowInEasing
                },
                repeatMode = RepeatMode.Restart,
                initialStartOffset = StartOffset(150 + i * DOT_STAGGER_MS),
            ),
            label = "dot$i",
        )
    }
}
