package com.aatech.betweenus.ui.theme

import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable

/**
 * Motion, said once.
 *
 * Expressive animates with springs rather than durations: a spring has no fixed
 * length, so an interrupted one carries its velocity into whatever happens next
 * instead of restarting. The four specs below are the whole vocabulary this
 * client uses.
 *
 * The `spatial` half is for anything that moves or resizes; the `effect` half is
 * for anything that only changes colour or alpha. They are different because a
 * bouncing colour looks like a bug and a non-bouncing slide looks dead - only
 * the spatial springs overshoot.
 *
 * Each is generic in what it animates, because the caller decides whether it is
 * a `Dp`, a `Color`, an `IntOffset` or a bare float. Everything reads
 * `MaterialTheme.motionScheme`, which is what [BetweenUsTheme] sets; nothing in
 * this app should hand-write a `tween`.
 */
object BetweenUsMotion {

    /** Something arriving, leaving, or changing size. Springy, slight overshoot. */
    @Composable
    @ReadOnlyComposable
    fun <T> spatial(): FiniteAnimationSpec<T> = MaterialTheme.motionScheme.defaultSpatialSpec()

    /** The same, for a small thing that should settle fast. */
    @Composable
    @ReadOnlyComposable
    fun <T> spatialFast(): FiniteAnimationSpec<T> = MaterialTheme.motionScheme.fastSpatialSpec()

    /** A colour or an alpha. No overshoot: colour does not bounce. */
    @Composable
    @ReadOnlyComposable
    fun <T> effect(): FiniteAnimationSpec<T> = MaterialTheme.motionScheme.defaultEffectsSpec()

    /** The same, for a press - fast enough to feel like part of the touch. */
    @Composable
    @ReadOnlyComposable
    fun <T> effectFast(): FiniteAnimationSpec<T> = MaterialTheme.motionScheme.fastEffectsSpec()
}
