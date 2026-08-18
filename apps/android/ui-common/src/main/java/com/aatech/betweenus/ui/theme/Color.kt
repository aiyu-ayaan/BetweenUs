package com.aatech.betweenus.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The BetweenUs palette, ported hex for hex from `apps/desktop/tailwind.theme.mjs`.
 *
 * The desktop and web clients are drawn as floating panels on a near-black
 * ground with an iris accent, and this client is meant to look like the same
 * product. When that file changes, this one changes with it.
 */

/** The ground the panels float on. Nothing else is this dark. */
val Ground = Color(0xFF06070A)

// Surface ramp. The names are positional so a component never has to know
// which shade it is standing on.
val Surface950 = Color(0xFF0B0D12)
val Surface900 = Color(0xFF15181F)
val Surface850 = Color(0xFF0F1117)
val Surface800 = Color(0xFF101319)
val Surface700 = Color(0xFF222734)
val Surface600 = Color(0xFF1A1E27)
val Surface500 = Color(0xFF333A4A)

val Accent = Color(0xFF7C5CFF)
val AccentHover = Color(0xFF6A44F5)

// Status dots, and the only place these hues are used.
val StatusOnline = Color(0xFF3FD68C)
val StatusIdle = Color(0xFFF5B83D)
val StatusDnd = Color(0xFFFF5D5D)
val StatusOffline = Color(0xFF6B7280)

val Danger = Color(0xFFFF4D4F)
val DangerHover = Color(0xFFD13537)

/** The hairline every panel is drawn with. One value, used everywhere. */
val Edge = Color(0x12FFFFFF)

// Text ramp. Tailwind's slate, which is what the other clients write in.
val Slate50 = Color(0xFFF8FAFC)
val Slate100 = Color(0xFFF1F5F9)
val Slate300 = Color(0xFFCBD5E1)
val Slate400 = Color(0xFF94A3B8)
val Slate500 = Color(0xFF64748B)
val Amber200 = Color(0xFFFDE68A)
