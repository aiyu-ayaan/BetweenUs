package com.aatech.betweenus.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

/**
 * The BetweenUs theme: Material 3 Expressive, dark, iris.
 *
 * Expressive is three things at once and this file carries all three:
 *
 * - **A wider colour scheme.** Not one accent and a grey, but three tonal
 *   families (iris, teal, rose) and a five-step container ramp, so a screen can
 *   separate regions with tone instead of borders.
 * - **A bigger shape scale.** Corners run to 48dp, and the scale has the
 *   half-steps expressive components morph between when they are pressed.
 * - **A motion scheme.** Spring-based, and slightly overshooting - the thing
 *   that makes the toolkit's own components feel like this rather than like
 *   the default. Components read it through `MaterialTheme.motionScheme`, which
 *   only exists because the theme is built here rather than with
 *   `MaterialTheme`.
 *
 * There is deliberately no light scheme and no dynamic colour: the three
 * clients are meant to look like one product, and Material You would repaint
 * this one to match a wallpaper.
 */
private val BetweenUsColors = darkColorScheme(
    // Primary: the iris the whole product is named after.
    primary = Iris80,
    onPrimary = Iris20,
    primaryContainer = Iris30,
    onPrimaryContainer = Iris90,
    inversePrimary = Iris40,

    // Secondary: teal. Presence, live state, the quieter of two actions.
    secondary = Teal80,
    onSecondary = Teal20,
    secondaryContainer = Teal30,
    onSecondaryContainer = Teal90,

    // Tertiary: rose. Mentions, reactions, an incoming call - the moments that
    // are neither the primary action nor a failure.
    tertiary = Rose80,
    onTertiary = Rose20,
    tertiaryContainer = Rose30,
    onTertiaryContainer = Rose90,

    error = Red80,
    onError = Red20,
    errorContainer = Red30,
    onErrorContainer = Red90,

    // The ground, and the ramp of containers standing on it. Expressive builds
    // depth out of this ramp rather than out of elevation shadows, which is why
    // there are five of them and why nothing here casts one.
    background = Neutral4,
    onBackground = Neutral95,
    surface = Neutral4,
    onSurface = Neutral95,
    surfaceDim = Neutral4,
    surfaceBright = Neutral24,
    surfaceContainerLowest = Neutral4,
    surfaceContainerLow = Neutral6,
    surfaceContainer = Neutral12,
    surfaceContainerHigh = Neutral17,
    surfaceContainerHighest = Neutral22,
    surfaceVariant = Neutral17,
    onSurfaceVariant = NeutralVariant60,

    outline = NeutralVariant50,
    outlineVariant = NeutralVariant30,

    inverseSurface = Neutral90,
    inverseOnSurface = Neutral12,
    scrim = Iris0,
)

/**
 * The expressive corner scale.
 *
 * The three `*Increased` steps are not decoration: they are the shapes the
 * toolkit's buttons and sheets morph *to* when pressed or dragged, so leaving
 * them at the default would flatten every one of those animations.
 */
private val BetweenUsShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    largeIncreased = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
    extraLargeIncreased = RoundedCornerShape(32.dp),
    extraExtraLarge = RoundedCornerShape(48.dp),
)

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun BetweenUsTheme(content: @Composable () -> Unit) {
    MaterialExpressiveTheme(
        colorScheme = BetweenUsColors,
        typography = BetweenUsTypography,
        shapes = BetweenUsShapes,
        // Expressive rather than standard: springier, with a little overshoot.
        // Every animation the toolkit runs for us - a button's press morph, a
        // sheet settling, a nav item swapping - is read off this.
        motionScheme = MotionScheme.expressive(),
        content = content,
    )
}
