package com.aatech.betweenus.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import com.aatech.betweenus.core.store.ThemePreferences

private fun Context.findActivity(): Activity? {
    var ctx = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}

/**
 * Build a Material3 ColorScheme dynamically derived from a BetweenUsColorPalette.
 */
private fun buildColorScheme(palette: BetweenUsColorPalette): ColorScheme {
    return if (palette.isDark) {
        darkColorScheme(
            primary = palette.accent,
            onPrimary = palette.surface950,
            primaryContainer = palette.surface800,
            onPrimaryContainer = palette.slate50,
            inversePrimary = palette.accentHover,

            secondary = palette.accentHover,
            onSecondary = palette.surface950,
            secondaryContainer = palette.surface700,
            onSecondaryContainer = palette.slate100,

            tertiary = Rose80,
            onTertiary = Rose20,
            tertiaryContainer = Rose30,
            onTertiaryContainer = Rose90,

            error = Red80,
            onError = Red20,
            errorContainer = Red30,
            onErrorContainer = Red90,

            background = palette.ground,
            onBackground = palette.slate100,
            surface = palette.surface900,
            onSurface = palette.slate100,
            surfaceDim = palette.ground,
            surfaceBright = palette.surface700,
            surfaceContainerLowest = palette.ground,
            surfaceContainerLow = palette.surface950,
            surfaceContainer = palette.surface900,
            surfaceContainerHigh = palette.surface800,
            surfaceContainerHighest = palette.surface700,
            surfaceVariant = palette.surface800,
            onSurfaceVariant = palette.slate400,

            outline = palette.slate500,
            outlineVariant = palette.edge,

            inverseSurface = palette.slate100,
            inverseOnSurface = palette.surface900,
            scrim = Color.Black,
        )
    } else {
        lightColorScheme(
            primary = palette.accent,
            onPrimary = Color.White,
            primaryContainer = palette.surface800,
            onPrimaryContainer = palette.slate50,
            inversePrimary = palette.accentHover,

            secondary = palette.accentHover,
            onSecondary = Color.White,
            secondaryContainer = palette.surface700,
            onSecondaryContainer = palette.slate100,

            tertiary = Rose40,
            onTertiary = Color.White,
            tertiaryContainer = Rose90,
            onTertiaryContainer = Rose10,

            error = Red60,
            onError = Color.White,
            errorContainer = Red90,
            onErrorContainer = Red10,

            background = palette.ground,
            onBackground = palette.slate100,
            surface = palette.surface900,
            onSurface = palette.slate100,
            surfaceDim = palette.surface800,
            surfaceBright = palette.surface950,
            surfaceContainerLowest = palette.surface950,
            surfaceContainerLow = palette.surface850,
            surfaceContainer = palette.surface800,
            surfaceContainerHigh = palette.surface700,
            surfaceContainerHighest = palette.surface600,
            surfaceVariant = palette.surface800,
            onSurfaceVariant = palette.slate400,

            outline = palette.slate500,
            outlineVariant = palette.edge,

            inverseSurface = palette.slate900,
            inverseOnSurface = palette.slate50,
            scrim = Color.Black,
        )
    }
}

/**
 * Build a BetweenUsColorPalette dynamically extracted from Android Material You wallpaper colors.
 */
private fun paletteFromDynamicScheme(scheme: ColorScheme, isDark: Boolean): BetweenUsColorPalette {
    return BetweenUsColorPalette(
        ground = scheme.background,
        surface950 = scheme.surfaceContainerLowest,
        surface900 = scheme.surface,
        surface850 = scheme.surfaceContainerLow,
        surface800 = scheme.surfaceContainer,
        surface700 = scheme.surfaceContainerHigh,
        surface600 = scheme.surfaceContainerHighest,
        surface500 = scheme.surfaceVariant,
        accent = scheme.primary,
        accentHover = scheme.secondary,
        edge = scheme.outlineVariant.copy(alpha = 0.35f),
        slate50 = scheme.onSurface,
        slate100 = scheme.onSurface,
        slate200 = scheme.onSurfaceVariant,
        slate300 = scheme.outline,
        slate400 = scheme.outlineVariant,
        slate500 = scheme.outline,
        slate600 = scheme.surfaceContainerHighest,
        slate700 = scheme.surfaceContainerHigh,
        slate800 = scheme.surfaceContainer,
        slate900 = scheme.surfaceContainerLow,
        slate950 = scheme.surfaceContainerLowest,
        rowActive = scheme.primary.copy(alpha = 0.12f),
        rowIdleHover = scheme.onSurface.copy(alpha = 0.06f),
        danger = scheme.error,
        dangerHover = scheme.errorContainer,
        isDark = isDark,
    )
}

/**
 * The expressive corner scale.
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
fun BetweenUsTheme(
    content: @Composable () -> Unit,
) {
    val selectedTheme by ThemePreferences.selectedTheme.collectAsState()
    val followSystem by ThemePreferences.followSystem.collectAsState()
    val dynamicColor by ThemePreferences.dynamicColor.collectAsState()
    val customAccentId by ThemePreferences.customAccentId.collectAsState()

    val context = LocalContext.current
    val isSystemDark = isSystemInDarkTheme()
    val isDynamicSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    val (colorScheme, activePalette) = if (dynamicColor && isDynamicSupported) {
        val isDark = if (followSystem) isSystemDark else selectedTheme != "light"
        val dynScheme = if (isDark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        val dynPalette = paletteFromDynamicScheme(dynScheme, isDark)
        Pair(dynScheme, dynPalette)
    } else {
        val effectiveThemeId = if (followSystem) {
            if (!isSystemDark) "light"
            else if (selectedTheme == "light") "dark"
            else selectedTheme
        } else {
            selectedTheme
        }

        val themeDef = ANDROID_THEMES[effectiveThemeId] ?: ANDROID_THEMES["dark"] ?: error("Dark theme missing")
        val basePalette = themeDef.palette

        val customAccent = ACCENT_PRESETS.find { it.id == customAccentId }?.color
        val customAccentHover = ACCENT_PRESETS.find { it.id == customAccentId }?.hover

        val active = if (customAccent != null && customAccentHover != null) {
            basePalette.copy(
                accent = customAccent,
                accentHover = customAccentHover,
            )
        } else {
            basePalette
        }
        Pair(buildColorScheme(active), active)
    }

    BetweenUsThemeTokens.current = activePalette

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val activity = view.context.findActivity()
            if (activity != null) {
                val insetsController = WindowCompat.getInsetsController(activity.window, view)
                insetsController.isAppearanceLightStatusBars = !activePalette.isDark
                insetsController.isAppearanceLightNavigationBars = !activePalette.isDark
            }
        }
    }

    CompositionLocalProvider(LocalBetweenUsColors provides activePalette) {
        MaterialExpressiveTheme(
            colorScheme = colorScheme,
            typography = BetweenUsTypography,
            shapes = BetweenUsShapes,
            motionScheme = MotionScheme.expressive(),
            content = content,
        )
    }
}
