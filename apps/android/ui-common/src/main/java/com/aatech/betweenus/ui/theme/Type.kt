package com.aatech.betweenus.ui.theme

import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Typography
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.sp

/**
 * The Material 3 Expressive type scale.
 *
 * Expressive types on two axes rather than one. Size still says how important
 * something is; *weight* now says how loud it is, and the scale carries an
 * emphasized cut of every role for the places that need to be loud - a screen
 * title, the label on the button you are meant to press, the empty state that
 * has to be read before anything else happens.
 *
 * The face is the system's. Bundling Roboto Flex would add about a megabyte to
 * the APK to make the app look slightly less like the phone it is running on,
 * and the weights the scale actually uses are all ones the platform face has.
 *
 * ponytail: the emphasized cuts step the weight rather than the optical width,
 * because a static face has no width axis. Swap in a variable Roboto Flex and
 * the same styles can carry `FontVariation.width` if it ever proves worth the
 * download.
 */
private val Sans = FontFamily.SansSerif

/**
 * Text sits on its line, not on itself, and the platform line carries the
 * font's asymmetric ascent padding. Every style trims it, so vertical centring
 * means the glyphs and a tight row is actually tight.
 */
private val Trimmed = LineHeightStyle(
    alignment = LineHeightStyle.Alignment.Center,
    trim = LineHeightStyle.Trim.Both,
)

@Suppress("DEPRECATION")
private fun style(
    size: Int,
    lineHeight: Int,
    weight: FontWeight,
    tracking: Double = 0.0,
) = TextStyle(
    fontFamily = Sans,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    letterSpacing = tracking.sp,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    lineHeightStyle = Trimmed,
)

private val Regular = FontWeight.Normal
private val Medium = FontWeight.Medium
private val Semi = FontWeight.SemiBold
private val Bold = FontWeight.Bold

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
val BetweenUsTypography = Typography(
    // Display. One thing on a screen at a time: the sign-in wordmark, the name
    // of whoever is calling.
    displayLarge = style(57, 64, Regular, -0.25),
    displayLargeEmphasized = style(57, 64, Bold, -0.25),
    displayMedium = style(45, 52, Regular),
    displayMediumEmphasized = style(45, 52, Bold),
    displaySmall = style(36, 44, Regular),
    displaySmallEmphasized = style(36, 44, Bold),

    // Headline. The title of a screen or of a sheet.
    headlineLarge = style(32, 40, Regular),
    headlineLargeEmphasized = style(32, 40, Bold),
    headlineMedium = style(28, 36, Regular),
    headlineMediumEmphasized = style(28, 36, Bold),
    headlineSmall = style(24, 32, Medium),
    headlineSmallEmphasized = style(24, 32, Bold),

    // Title. The name of a region: a channel header, a card, a list section.
    titleLarge = style(22, 28, Medium),
    titleLargeEmphasized = style(22, 28, Bold),
    titleMedium = style(17, 24, Semi, 0.15),
    titleMediumEmphasized = style(17, 24, Bold, 0.15),
    titleSmall = style(14, 20, Medium, 0.1),
    titleSmallEmphasized = style(14, 20, Semi, 0.1),

    // Body. Everything anyone actually reads - which here is every message.
    bodyLarge = style(16, 24, Regular, 0.5),
    bodyLargeEmphasized = style(16, 24, Medium, 0.5),
    bodyMedium = style(14, 20, Regular, 0.25),
    bodyMediumEmphasized = style(14, 20, Medium, 0.25),
    bodySmall = style(12, 16, Regular, 0.4),
    bodySmallEmphasized = style(12, 16, Medium, 0.4),

    // Label. Controls, and the uppercase dividers the sidebars group under.
    labelLarge = style(15, 20, Medium, 0.1),
    labelLargeEmphasized = style(15, 20, Semi, 0.1),
    labelMedium = style(12, 16, Medium, 0.5),
    labelMediumEmphasized = style(12, 16, Semi, 0.5),
    labelSmall = style(11, 16, Semi, 0.8),
    labelSmallEmphasized = style(11, 16, Bold, 0.8),
)
