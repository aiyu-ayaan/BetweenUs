package com.aatech.betweenus.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

/**
 * BetweenUs is a dark product. There is no light scheme and no dynamic colour:
 * the whole point of the palette in [Color.kt] is that the three clients look
 * like one another, and Material You would repaint this one to match a
 * wallpaper instead.
 */
private val BetweenUsColors = darkColorScheme(
    primary = Accent,
    onPrimary = Slate50,
    primaryContainer = Accent,
    onPrimaryContainer = Slate50,
    secondary = Surface700,
    onSecondary = Slate100,
    background = Ground,
    onBackground = Slate100,
    surface = Surface900,
    onSurface = Slate100,
    surfaceVariant = Surface950,
    onSurfaceVariant = Slate400,
    surfaceContainerHighest = Surface700,
    outline = Surface700,
    outlineVariant = Edge,
    error = Danger,
    onError = Slate50,
    errorContainer = Surface900,
    onErrorContainer = Danger,
)

/** `borderRadius.panel` on the other clients is 0.75rem; this is the same. */
private val BetweenUsShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

@Composable
fun BetweenUsTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = BetweenUsColors,
        typography = BetweenUsTypography,
        shapes = BetweenUsShapes,
        content = content,
    )
}
