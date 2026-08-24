package com.aatech.betweenus.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The BetweenUs palette, as Material 3 Expressive tonal ramps.
 *
 * The desktop and web clients are drawn as floating panels on a near-black
 * ground with an iris accent. This client keeps that identity - the source hue
 * is still `#7C5CFF` - but expresses it the way Material 3 does: one tonal
 * palette per role, and every colour a component reads comes out of the scheme
 * in [Theme.kt] rather than being picked here.
 *
 * Two rules hold this file together:
 *
 * - **Ramps, not picks.** A role's colour is a tone off a ramp. That is what
 *   makes container/on-container pairs contrast correctly without anybody
 *   checking each pair by hand.
 * - **Dark only.** There is no light scheme and no dynamic colour: the point of
 *   the palette is that the three clients look like one product, and Material
 *   You would repaint this one to match a wallpaper instead.
 */

// ---------------------------------------------------------------------------
// Iris - the primary ramp. Tone 60 is the brand accent the other clients use.
// ---------------------------------------------------------------------------

val Iris0 = Color(0xFF000000)
val Iris10 = Color(0xFF190A4E)
val Iris20 = Color(0xFF291570)
val Iris30 = Color(0xFF3D2596)
val Iris40 = Color(0xFF5136BE)
val Iris50 = Color(0xFF6749E4)
val Iris60 = Color(0xFF7C5CFF)
val Iris70 = Color(0xFF9C82FF)
val Iris80 = Color(0xFFBCA6FF)
val Iris90 = Color(0xFFDCCCFF)
val Iris95 = Color(0xFFEEE6FF)
val Iris99 = Color(0xFFFDFAFF)

// ---------------------------------------------------------------------------
// Teal - the secondary ramp. The quieter half of a two-tone expressive layout:
// selected rows, presence, the "this is live" tint.
// ---------------------------------------------------------------------------

val Teal10 = Color(0xFF002019)
val Teal20 = Color(0xFF00382C)
val Teal30 = Color(0xFF005141)
val Teal40 = Color(0xFF006C57)
val Teal60 = Color(0xFF16A97F)
val Teal80 = Color(0xFF67DBB0)
val Teal90 = Color(0xFF87F8CB)

// ---------------------------------------------------------------------------
// Rose - the tertiary ramp. Expressive leans on a third accent for the moments
// that are neither the primary action nor an error: mentions, reactions, a
// call coming in.
// ---------------------------------------------------------------------------

val Rose10 = Color(0xFF3A0720)
val Rose20 = Color(0xFF561436)
val Rose30 = Color(0xFF75294D)
val Rose40 = Color(0xFF954066)
val Rose60 = Color(0xFFD1739A)
val Rose80 = Color(0xFFFFB0C9)
val Rose90 = Color(0xFFFFD9E3)

// ---------------------------------------------------------------------------
// Neutral - the surfaces. A near-black ground with a ramp of containers on top
// of it, which is what gives a screen depth without a single drop shadow.
// ---------------------------------------------------------------------------

val Neutral4 = Color(0xFF06070A)
val Neutral6 = Color(0xFF0B0D12)
val Neutral10 = Color(0xFF101319)
val Neutral12 = Color(0xFF15181F)
val Neutral17 = Color(0xFF1B1F28)
val Neutral22 = Color(0xFF222734)
val Neutral24 = Color(0xFF272D3B)
val Neutral30 = Color(0xFF333A4A)
val Neutral80 = Color(0xFFC7CAD3)
val Neutral90 = Color(0xFFE3E5EC)
val Neutral95 = Color(0xFFF1F3F8)
val Neutral99 = Color(0xFFFBFCFF)

/** Neutral variant - the outline ramp, one step cooler than the surfaces. */
val NeutralVariant30 = Color(0xFF3A4152)
val NeutralVariant50 = Color(0xFF6B7488)
val NeutralVariant60 = Color(0xFF858FA5)
val NeutralVariant80 = Color(0xFFC1C7D6)

// ---------------------------------------------------------------------------
// Red - errors, and only errors. A destructive action is the one place a
// screen is allowed to leave the iris/teal/rose triad.
// ---------------------------------------------------------------------------

val Red10 = Color(0xFF410009)
val Red20 = Color(0xFF690014)
val Red30 = Color(0xFF930021)
val Red40 = Color(0xFFBE1F31)
val Red60 = Color(0xFFFF4D4F)
val Red80 = Color(0xFFFFB3AF)
val Red90 = Color(0xFFFFDAD5)

/** Amber - the one warning tone, for a caution that is not a failure. */
val Amber60 = Color(0xFFF5B83D)
val Amber80 = Color(0xFFFFD98A)
val Amber20 = Color(0xFF4A2E00)

// ---------------------------------------------------------------------------
// Presence. Status is a fixed vocabulary shared with the other clients, so
// these do not move with the scheme.
// ---------------------------------------------------------------------------

val StatusOnline = Teal60
val StatusIdle = Amber60
val StatusDnd = Red60
val StatusOffline = Color(0xFF6B7280)

// ---------------------------------------------------------------------------
// Legacy names.
//
// About a thousand call sites across the feature modules name a colour
// directly - `Slate400`, `Surface900`, `Accent`. They keep working and they
// repaint themselves, because every one of these now points at a tone off the
// ramps above. New code reads `MaterialTheme.colorScheme` instead; these are
// here so the migration is a screen at a time rather than one enormous diff.
// ---------------------------------------------------------------------------

/** The ground the panels float on. Nothing else is this dark. */
val Ground = Neutral4

val Surface950 = Neutral6
val Surface900 = Neutral12
val Surface850 = Neutral10
val Surface800 = Neutral10
val Surface700 = Neutral22
val Surface600 = Neutral17
val Surface500 = Neutral30

val Accent = Iris60
val AccentHover = Iris50

val Danger = Red60
val DangerHover = Red40

/** The hairline every panel is drawn with. One value, used everywhere. */
val Edge = Color(0x12FFFFFF)

val Slate50 = Neutral99
val Slate100 = Neutral95
val Slate300 = Neutral80
val Slate400 = NeutralVariant60
val Slate500 = NeutralVariant50
val Amber200 = Amber80
