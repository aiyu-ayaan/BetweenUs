package com.aatech.betweenus.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The BetweenUs multi-theme palette system for Android.
 *
 * Supports 16 rich curated themes, customizable accent tints,
 * and seamless reactive switching across all Compose UI components.
 */

// ---------------------------------------------------------------------------
// Static Tone Constants (Iris, Teal, Rose, Red, Amber)
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

val Teal10 = Color(0xFF002019)
val Teal20 = Color(0xFF00382C)
val Teal30 = Color(0xFF005141)
val Teal40 = Color(0xFF006C57)
val Teal60 = Color(0xFF16A97F)
val Teal80 = Color(0xFF67DBB0)
val Teal90 = Color(0xFF87F8CB)

val Rose10 = Color(0xFF3A0720)
val Rose20 = Color(0xFF561436)
val Rose30 = Color(0xFF75294D)
val Rose40 = Color(0xFF954066)
val Rose60 = Color(0xFFD1739A)
val Rose80 = Color(0xFFFFB0C9)
val Rose90 = Color(0xFFFFD9E3)

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

val NeutralVariant30 = Color(0xFF3A4152)
val NeutralVariant50 = Color(0xFF6B7488)
val NeutralVariant60 = Color(0xFF858FA5)
val NeutralVariant80 = Color(0xFFC1C7D6)

val Red10 = Color(0xFF410009)
val Red20 = Color(0xFF690014)
val Red30 = Color(0xFF930021)
val Red40 = Color(0xFFBE1F31)
val Red60 = Color(0xFFFF4D4F)
val Red80 = Color(0xFFFFB3AF)
val Red90 = Color(0xFFFFDAD5)

val Amber20 = Color(0xFF4A2E00)
val Amber60 = Color(0xFFF5B83D)
val Amber80 = Color(0xFFFFD98A)

// Status colors
val StatusOnline = Teal60
val StatusIdle = Amber60
val StatusDnd = Red60
val StatusOffline = Color(0xFF6B7280)

// ---------------------------------------------------------------------------
// BetweenUs Color Palette Specification
// ---------------------------------------------------------------------------

@Immutable
data class BetweenUsColorPalette(
    val ground: Color,
    val surface950: Color,
    val surface900: Color,
    val surface850: Color,
    val surface800: Color,
    val surface700: Color,
    val surface600: Color,
    val surface500: Color,
    val accent: Color,
    val accentHover: Color,
    val edge: Color,
    val slate50: Color,
    val slate100: Color,
    val slate200: Color,
    val slate300: Color,
    val slate400: Color,
    val slate500: Color,
    val slate600: Color,
    val slate700: Color,
    val slate800: Color,
    val slate900: Color,
    val slate950: Color,
    val rowActive: Color,
    val rowIdleHover: Color,
    val danger: Color = Red60,
    val dangerHover: Color = Red40,
    val isDark: Boolean = true,
)

// ---------------------------------------------------------------------------
// Accent Presets
// ---------------------------------------------------------------------------

data class AndroidAccentChoice(
    val id: String,
    val label: String,
    val color: Color?,
    val hover: Color?,
)

val ACCENT_PRESETS = listOf(
    AndroidAccentChoice("default", "Theme Default", null, null),
    AndroidAccentChoice("iris", "Iris", Color(0xFF7C5CFF), Color(0xFF6A44F5)),
    AndroidAccentChoice("sky", "Sky Blue", Color(0xFF0EA5E9), Color(0xFF0284C7)),
    AndroidAccentChoice("emerald", "Emerald", Color(0xFF10B981), Color(0xFF059669)),
    AndroidAccentChoice("rose", "Rose", Color(0xFFF43F5E), Color(0xFFE11D48)),
    AndroidAccentChoice("amber", "Amber", Color(0xFFF59E0B), Color(0xFFD97706)),
    AndroidAccentChoice("violet", "Electric Violet", Color(0xFFA855F7), Color(0xFF9333EA)),
    AndroidAccentChoice("teal", "Teal", Color(0xFF14B8A6), Color(0xFF0D9488)),
)

// ---------------------------------------------------------------------------
// Theme Definitions
// ---------------------------------------------------------------------------

data class AndroidThemeDefinition(
    val id: String,
    val name: String,
    val category: String,
    val isDark: Boolean,
    val description: String,
    val previewGround: Color,
    val previewSurface: Color,
    val previewAccent: Color,
    val previewText: Color,
    val palette: BetweenUsColorPalette,
)

val DEFAULT_DARK_PALETTE = BetweenUsColorPalette(
    ground = Color(0xFF06070A),
    surface950 = Color(0xFF0B0D12),
    surface900 = Color(0xFF15181F),
    surface850 = Color(0xFF0F1117),
    surface800 = Color(0xFF101319),
    surface700 = Color(0xFF222734),
    surface600 = Color(0xFF1A1E27),
    surface500 = Color(0xFF333A4A),
    accent = Color(0xFF7C5CFF),
    accentHover = Color(0xFF6A44F5),
    edge = Color(0x12FFFFFF),
    slate50 = Color(0xFFF8FAFC),
    slate100 = Color(0xFFF1F5F9),
    slate200 = Color(0xFFE2E8F0),
    slate300 = Color(0xFFCBD5E1),
    slate400 = Color(0xFF94A3B8),
    slate500 = Color(0xFF64748B),
    slate600 = Color(0xFF475569),
    slate700 = Color(0xFF334155),
    slate800 = Color(0xFF1E293B),
    slate900 = Color(0xFF0F172A),
    slate950 = Color(0xFF020617),
    rowActive = Color(0x12FFFFFF),
    rowIdleHover = Color(0x0AFFFFFF),
    isDark = true,
)

val ANDROID_THEMES: Map<String, AndroidThemeDefinition> = mapOf(
    "dark" to AndroidThemeDefinition(
        id = "dark",
        name = "Dark (Iris)",
        category = "Signature",
        isDark = true,
        description = "BetweenUs signature cool near-black ink with vibrant iris accents.",
        previewGround = Color(0xFF06070A),
        previewSurface = Color(0xFF15181F),
        previewAccent = Color(0xFF7C5CFF),
        previewText = Color(0xFFF1F5F9),
        palette = DEFAULT_DARK_PALETTE,
    ),
    "light" to AndroidThemeDefinition(
        id = "light",
        name = "Daylight",
        category = "Light",
        isDark = false,
        description = "Crisp, high-contrast light theme with soft slate panels on an airy workbench.",
        previewGround = Color(0xFFE9EDF4),
        previewSurface = Color(0xFFFFFFFF),
        previewAccent = Color(0xFF6355D8),
        previewText = Color(0xFF0F172A),
        palette = BetweenUsColorPalette(
            ground = Color(0xFFE9EDF4),
            surface950 = Color(0xFFFFFFFF),
            surface900 = Color(0xFFFFFFFF),
            surface850 = Color(0xFFF8FAFC),
            surface800 = Color(0xFFF1F5F9),
            surface700 = Color(0xFFE2E8F0),
            surface600 = Color(0xFFCBD5E1),
            surface500 = Color(0xFF94A3B8),
            accent = Color(0xFF6355D8),
            accentHover = Color(0xFF5042C4),
            edge = Color(0x180F172A),
            slate50 = Color(0xFF090D16),
            slate100 = Color(0xFF0F172A),
            slate200 = Color(0xFF1E293B),
            slate300 = Color(0xFF334155),
            slate400 = Color(0xFF64748B),
            slate500 = Color(0xFF94A3B8),
            slate600 = Color(0xFFCBD5E1),
            slate700 = Color(0xFFE2E8F0),
            slate800 = Color(0xFFF1F5F9),
            slate900 = Color(0xFFF8FAFC),
            slate950 = Color(0xFFFFFFFF),
            rowActive = Color(0x100F172A),
            rowIdleHover = Color(0x080F172A),
            isDark = false,
        ),
    ),
    "midnight" to AndroidThemeDefinition(
        id = "midnight",
        name = "Midnight (OLED)",
        category = "Monochrome",
        isDark = true,
        description = "Pitch black backdrop designed for OLED displays and deep focus.",
        previewGround = Color(0xFF000000),
        previewSurface = Color(0xFF0D0D11),
        previewAccent = Color(0xFF8B5CF6),
        previewText = Color(0xFFF3F4F6),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF000000),
            surface950 = Color(0xFF060608),
            surface900 = Color(0xFF0D0D11),
            surface850 = Color(0xFF08080A),
            surface800 = Color(0xFF09090D),
            surface700 = Color(0xFF191922),
            surface600 = Color(0xFF13131A),
            surface500 = Color(0xFF2A2A38),
            accent = Color(0xFF8B5CF6),
            accentHover = Color(0xFF7C3AED),
            edge = Color(0x18FFFFFF),
            slate50 = Color(0xFFFFFFFF),
            slate100 = Color(0xFFF3F4F6),
            slate200 = Color(0xFFE5E7EB),
            slate300 = Color(0xFFD1D5DB),
            slate400 = Color(0xFF9CA3AF),
            slate500 = Color(0xFF6B7280),
            slate600 = Color(0xFF4B5563),
            slate700 = Color(0xFF374151),
            slate800 = Color(0xFF1F2937),
            slate900 = Color(0xFF111827),
            slate950 = Color(0xFF030712),
            rowActive = Color(0x14FFFFFF),
            rowIdleHover = Color(0x0AFFFFFF),
            isDark = true,
        ),
    ),
    "nord" to AndroidThemeDefinition(
        id = "nord",
        name = "Nord Frost",
        category = "Palette",
        isDark = true,
        description = "Arctic, north-bluish palette with soothing cool grey surfaces and frost cyan.",
        previewGround = Color(0xFF242933),
        previewSurface = Color(0xFF3B4252),
        previewAccent = Color(0xFF88C0D0),
        previewText = Color(0xFFECEFF4),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF242933),
            surface950 = Color(0xFF2B303C),
            surface900 = Color(0xFF3B4252),
            surface850 = Color(0xFF2E3440),
            surface800 = Color(0xFF323846),
            surface700 = Color(0xFF434C5E),
            surface600 = Color(0xFF4C566A),
            surface500 = Color(0xFFD8DEE9),
            accent = Color(0xFF88C0D0),
            accentHover = Color(0xFF81A1C1),
            edge = Color(0x18D8DEE9),
            slate50 = Color(0xFFECEFF4),
            slate100 = Color(0xFFE5E9F0),
            slate200 = Color(0xFFD8DEE9),
            slate300 = Color(0xFFC2C8D2),
            slate400 = Color(0xFF9AA2B1),
            slate500 = Color(0xFF788294),
            slate600 = Color(0xFF4C566A),
            slate700 = Color(0xFF434C5E),
            slate800 = Color(0xFF3B4252),
            slate900 = Color(0xFF2E3440),
            slate950 = Color(0xFF242933),
            rowActive = Color(0x14D8DEE9),
            rowIdleHover = Color(0x0AD8DEE9),
            isDark = true,
        ),
    ),
    "catppuccin" to AndroidThemeDefinition(
        id = "catppuccin",
        name = "Catppuccin Mocha",
        category = "Pastel",
        isDark = true,
        description = "Warm, cozy pastel tones with lavender accents and soft contrasts.",
        previewGround = Color(0xFF11111B),
        previewSurface = Color(0xFF1E1E2E),
        previewAccent = Color(0xFFCBA6F7),
        previewText = Color(0xFFCDD6F4),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF11111B),
            surface950 = Color(0xFF181825),
            surface900 = Color(0xFF1E1E2E),
            surface850 = Color(0xFF181825),
            surface800 = Color(0xFF1B1B2A),
            surface700 = Color(0xFF313244),
            surface600 = Color(0xFF45475A),
            surface500 = Color(0xFF585B70),
            accent = Color(0xFFCBA6F7),
            accentHover = Color(0xFFB4BEFE),
            edge = Color(0x1ACDD6F4),
            slate50 = Color(0xFFCDD6F4),
            slate100 = Color(0xFFBAC2DE),
            slate200 = Color(0xFFA6ADC8),
            slate300 = Color(0xFF9399B2),
            slate400 = Color(0xFF7F849C),
            slate500 = Color(0xFF6C7086),
            slate600 = Color(0xFF585B70),
            slate700 = Color(0xFF45475A),
            slate800 = Color(0xFF313244),
            slate900 = Color(0xFF1E1E2E),
            slate950 = Color(0xFF11111B),
            rowActive = Color(0x14CDD6F4),
            rowIdleHover = Color(0x0ACDD6F4),
            isDark = true,
        ),
    ),
    "tokyo-night" to AndroidThemeDefinition(
        id = "tokyo-night",
        name = "Tokyo Night",
        category = "Vibrant",
        isDark = true,
        description = "Cyberpunk neon dusk inspired by the lights of downtown Tokyo.",
        previewGround = Color(0xFF13141C),
        previewSurface = Color(0xFF1A1B26),
        previewAccent = Color(0xFF7AA2F7),
        previewText = Color(0xFFC0CAF5),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF13141C),
            surface950 = Color(0xFF16161E),
            surface900 = Color(0xFF1A1B26),
            surface850 = Color(0xFF161622),
            surface800 = Color(0xFF181924),
            surface700 = Color(0xFF24283B),
            surface600 = Color(0xFF2F3549),
            surface500 = Color(0xFF414868),
            accent = Color(0xFF7AA2F7),
            accentHover = Color(0xFF618BF5),
            edge = Color(0x207AA2F7),
            slate50 = Color(0xFFC0CAF5),
            slate100 = Color(0xFFA9B1D6),
            slate200 = Color(0xFF9AA5CE),
            slate300 = Color(0xFF7AA2F7),
            slate400 = Color(0xFF565F89),
            slate500 = Color(0xFF414868),
            slate600 = Color(0xFF343B58),
            slate700 = Color(0xFF24283B),
            slate800 = Color(0xFF1F2335),
            slate900 = Color(0xFF1A1B26),
            slate950 = Color(0xFF13141C),
            rowActive = Color(0x187AA2F7),
            rowIdleHover = Color(0x0C7AA2F7),
            isDark = true,
        ),
    ),
    "crimson" to AndroidThemeDefinition(
        id = "crimson",
        name = "Crimson Dusk",
        category = "Vibrant",
        isDark = true,
        description = "Deep wine and velvety burgundy surfaces with luminous rose accents.",
        previewGround = Color(0xFF0F090D),
        previewSurface = Color(0xFF1E121B),
        previewAccent = Color(0xFFF43F5E),
        previewText = Color(0xFFFFE4E6),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF0F090D),
            surface950 = Color(0xFF160D13),
            surface900 = Color(0xFF1E121B),
            surface850 = Color(0xFF180E15),
            surface800 = Color(0xFF1A0F18),
            surface700 = Color(0xFF331C2C),
            surface600 = Color(0xFF291624),
            surface500 = Color(0xFF4A2940),
            accent = Color(0xFFF43F5E),
            accentHover = Color(0xFFE11D48),
            edge = Color(0x20F43F5E),
            slate50 = Color(0xFFFFE4E6),
            slate100 = Color(0xFFFECDD3),
            slate200 = Color(0xFFFDA4AF),
            slate300 = Color(0xFFFB7185),
            slate400 = Color(0xFFF43F5E),
            slate500 = Color(0xFF9F1239),
            slate600 = Color(0xFF881337),
            slate700 = Color(0xFF4C0519),
            slate800 = Color(0xFF1E121B),
            slate900 = Color(0xFF160D13),
            slate950 = Color(0xFF0F090D),
            rowActive = Color(0x18F43F5E),
            rowIdleHover = Color(0x0CF43F5E),
            isDark = true,
        ),
    ),
    "emerald" to AndroidThemeDefinition(
        id = "emerald",
        name = "Emerald Matrix",
        category = "Vibrant",
        isDark = true,
        description = "Moody deep botanical greens with radiant emerald highlights.",
        previewGround = Color(0xFF060D09),
        previewSurface = Color(0xFF0E1C16),
        previewAccent = Color(0xFF10B981),
        previewText = Color(0xFFD1FAE5),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF060D09),
            surface950 = Color(0xFF0A140F),
            surface900 = Color(0xFF0E1C16),
            surface850 = Color(0xFF0C1712),
            surface800 = Color(0xFF0D1913),
            surface700 = Color(0xFF193327),
            surface600 = Color(0xFF142920),
            surface500 = Color(0xFF274F3D),
            accent = Color(0xFF10B981),
            accentHover = Color(0xFF059669),
            edge = Color(0x2010B981),
            slate50 = Color(0xFFD1FAE5),
            slate100 = Color(0xFFA7F3D0),
            slate200 = Color(0xFF6EE7B7),
            slate300 = Color(0xFF34D399),
            slate400 = Color(0xFF10B981),
            slate500 = Color(0xFF059669),
            slate600 = Color(0xFF047857),
            slate700 = Color(0xFF065F46),
            slate800 = Color(0xFF064E3B),
            slate900 = Color(0xFF0E1C16),
            slate950 = Color(0xFF060D09),
            rowActive = Color(0x1810B981),
            rowIdleHover = Color(0x0C10B981),
            isDark = true,
        ),
    ),
    "dracula" to AndroidThemeDefinition(
        id = "dracula",
        name = "Dracula",
        category = "Developer",
        isDark = true,
        description = "The famous gothic developer palette with purple surfaces and pink highlights.",
        previewGround = Color(0xFF21222C),
        previewSurface = Color(0xFF282A36),
        previewAccent = Color(0xFFBD93F9),
        previewText = Color(0xFFF8F8F2),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF21222C),
            surface950 = Color(0xFF1E1F29),
            surface900 = Color(0xFF282A36),
            surface850 = Color(0xFF21222C),
            surface800 = Color(0xFF282A36),
            surface700 = Color(0xFF44475A),
            surface600 = Color(0xFF6272A4),
            surface500 = Color(0xFFF8F8F2),
            accent = Color(0xFFBD93F9),
            accentHover = Color(0xFFFF79C6),
            edge = Color(0x24BD93F9),
            slate50 = Color(0xFFF8F8F2),
            slate100 = Color(0xFFF1F1EA),
            slate200 = Color(0xFFE2E2DC),
            slate300 = Color(0xFFBD93F9),
            slate400 = Color(0xFF6272A4),
            slate500 = Color(0xFF44475A),
            slate600 = Color(0xFF323442),
            slate700 = Color(0xFF282A36),
            slate800 = Color(0xFF21222C),
            slate900 = Color(0xFF191A21),
            slate950 = Color(0xFF121318),
            rowActive = Color(0x1FBD93F9),
            rowIdleHover = Color(0x0DBD93F9),
            isDark = true,
        ),
    ),
    "solarized-light" to AndroidThemeDefinition(
        id = "solarized-light",
        name = "Solarized Light",
        category = "Light",
        isDark = false,
        description = "Ethan Schoonover’s calibrated warm parchment palette for fatigue-free reading.",
        previewGround = Color(0xFFEEE8D5),
        previewSurface = Color(0xFFFDF6E3),
        previewAccent = Color(0xFF268BD2),
        previewText = Color(0xFF073642),
        palette = BetweenUsColorPalette(
            ground = Color(0xFFEEE8D5),
            surface950 = Color(0xFFFDF6E3),
            surface900 = Color(0xFFFDF6E3),
            surface850 = Color(0xFFEEE8D5),
            surface800 = Color(0xFFE4DDC8),
            surface700 = Color(0xFFD3CBB7),
            surface600 = Color(0xFFB58900),
            surface500 = Color(0xFF839496),
            accent = Color(0xFF268BD2),
            accentHover = Color(0xFF2AA198),
            edge = Color(0x28586E75),
            slate50 = Color(0xFF002B36),
            slate100 = Color(0xFF073642),
            slate200 = Color(0xFF586E75),
            slate300 = Color(0xFF657B83),
            slate400 = Color(0xFF839496),
            slate500 = Color(0xFF93A1A1),
            slate600 = Color(0xFFD3CBB7),
            slate700 = Color(0xFFE4DDC8),
            slate800 = Color(0xFFEEE8D5),
            slate900 = Color(0xFFF8F2E3),
            slate950 = Color(0xFFFDF6E3),
            rowActive = Color(0x1A268BD2),
            rowIdleHover = Color(0x10586E75),
            isDark = false,
        ),
    ),
    "solarized-dark" to AndroidThemeDefinition(
        id = "solarized-dark",
        name = "Solarized Dark",
        category = "Developer",
        isDark = true,
        description = "Precision low-contrast cyan and teal dark palette for long night shifts.",
        previewGround = Color(0xFF00212B),
        previewSurface = Color(0xFF073642),
        previewAccent = Color(0xFF2AA198),
        previewText = Color(0xFF93A1A1),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF00212B),
            surface950 = Color(0xFF002B36),
            surface900 = Color(0xFF073642),
            surface850 = Color(0xFF002B36),
            surface800 = Color(0xFF003847),
            surface700 = Color(0xFF0E4B5C),
            surface600 = Color(0xFF586E75),
            surface500 = Color(0xFF93A1A1),
            accent = Color(0xFF2AA198),
            accentHover = Color(0xFF268BD2),
            edge = Color(0x242AA198),
            slate50 = Color(0xFFFDF6E3),
            slate100 = Color(0xFFEEE8D5),
            slate200 = Color(0xFF93A1A1),
            slate300 = Color(0xFF839496),
            slate400 = Color(0xFF657B83),
            slate500 = Color(0xFF586E75),
            slate600 = Color(0xFF0E4B5C),
            slate700 = Color(0xFF073642),
            slate800 = Color(0xFF002B36),
            slate900 = Color(0xFF00212B),
            slate950 = Color(0xFF00141A),
            rowActive = Color(0x1F2AA198),
            rowIdleHover = Color(0x0D2AA198),
            isDark = true,
        ),
    ),
    "monokai" to AndroidThemeDefinition(
        id = "monokai",
        name = "Monokai Pro",
        category = "Developer",
        isDark = true,
        description = "Warm obsidian background with vibrant phosphor yellow and pink accents.",
        previewGround = Color(0xFF19181A),
        previewSurface = Color(0xFF2D2A2E),
        previewAccent = Color(0xFFFFD866),
        previewText = Color(0xFFFCFCFA),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF19181A),
            surface950 = Color(0xFF221F22),
            surface900 = Color(0xFF2D2A2E),
            surface850 = Color(0xFF221F22),
            surface800 = Color(0xFF272428),
            surface700 = Color(0xFF403E41),
            surface600 = Color(0xFF727072),
            surface500 = Color(0xFFFFD866),
            accent = Color(0xFFFFD866),
            accentHover = Color(0xFFFF6188),
            edge = Color(0x20FFD866),
            slate50 = Color(0xFFFCFCFA),
            slate100 = Color(0xFFF0F0EC),
            slate200 = Color(0xFFC1C0C0),
            slate300 = Color(0xFF939293),
            slate400 = Color(0xFF727072),
            slate500 = Color(0xFF595759),
            slate600 = Color(0xFF403E41),
            slate700 = Color(0xFF2D2A2E),
            slate800 = Color(0xFF221F22),
            slate900 = Color(0xFF19181A),
            slate950 = Color(0xFF121113),
            rowActive = Color(0x1FFFD866),
            rowIdleHover = Color(0x0DFFD866),
            isDark = true,
        ),
    ),
    "cyberpunk" to AndroidThemeDefinition(
        id = "cyberpunk",
        name = "Cyberpunk 2077",
        category = "Vibrant",
        isDark = true,
        description = "High-octane neon yellow, intense cyan, and deep asphalt futuristic noir.",
        previewGround = Color(0xFF08080C),
        previewSurface = Color(0xFF171724),
        previewAccent = Color(0xFFFFEE00),
        previewText = Color(0xFF00F0FF),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF08080C),
            surface950 = Color(0xFF0F0F18),
            surface900 = Color(0xFF171724),
            surface850 = Color(0xFF11111C),
            surface800 = Color(0xFF141421),
            surface700 = Color(0xFF28283F),
            surface600 = Color(0xFF3D3D5C),
            surface500 = Color(0xFFFFEE00),
            accent = Color(0xFFFFEE00),
            accentHover = Color(0xFF00F0FF),
            edge = Color(0x28FFEE00),
            slate50 = Color(0xFFFFFFFF),
            slate100 = Color(0xFF00F0FF),
            slate200 = Color(0xFFB3F5FF),
            slate300 = Color(0xFFFFEE00),
            slate400 = Color(0xFF8A8AB8),
            slate500 = Color(0xFF5C5C80),
            slate600 = Color(0xFF383852),
            slate700 = Color(0xFF212133),
            slate800 = Color(0xFF171724),
            slate900 = Color(0xFF0F0F18),
            slate950 = Color(0xFF08080C),
            rowActive = Color(0x26FFEE00),
            rowIdleHover = Color(0x1400F0FF),
            isDark = true,
        ),
    ),
    "sepia" to AndroidThemeDefinition(
        id = "sepia",
        name = "Espresso & Cream",
        category = "Warm",
        isDark = true,
        description = "Roasted espresso ground with creamy latte text and warm caramel bronze.",
        previewGround = Color(0xFF161210),
        previewSurface = Color(0xFF27211D),
        previewAccent = Color(0xFFD4A373),
        previewText = Color(0xFFFAEDCD),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF161210),
            surface950 = Color(0xFF1D1815),
            surface900 = Color(0xFF27211D),
            surface850 = Color(0xFF1F1A16),
            surface800 = Color(0xFF231D19),
            surface700 = Color(0xFF3D332C),
            surface600 = Color(0xFF5C4E43),
            surface500 = Color(0xFFD4A373),
            accent = Color(0xFFD4A373),
            accentHover = Color(0xFFBC6C25),
            edge = Color(0x24D4A373),
            slate50 = Color(0xFFFAEDCD),
            slate100 = Color(0xFFF3E2BA),
            slate200 = Color(0xFFD4A373),
            slate300 = Color(0xFFBC6C25),
            slate400 = Color(0xFF8A7563),
            slate500 = Color(0xFF635244),
            slate600 = Color(0xFF45392F),
            slate700 = Color(0xFF302721),
            slate800 = Color(0xFF231D19),
            slate900 = Color(0xFF1A1512),
            slate950 = Color(0xFF100D0B),
            rowActive = Color(0x1FD4A373),
            rowIdleHover = Color(0x0DD4A373),
            isDark = true,
        ),
    ),
    "rose-pine-dawn" to AndroidThemeDefinition(
        id = "rose-pine-dawn",
        name = "Rosé Pine Dawn",
        category = "Light",
        isDark = false,
        description = "Gentle Scandinavian morning light palette with soft rose, pine, and gold.",
        previewGround = Color(0xFFFAF4ED),
        previewSurface = Color(0xFFFFFAF3),
        previewAccent = Color(0xFFD7827E),
        previewText = Color(0xFF575279),
        palette = BetweenUsColorPalette(
            ground = Color(0xFFFAF4ED),
            surface950 = Color(0xFFFFFAF3),
            surface900 = Color(0xFFFFFAF3),
            surface850 = Color(0xFFF2E9E1),
            surface800 = Color(0xFFEBE1D7),
            surface700 = Color(0xFFDFD2C4),
            surface600 = Color(0xFFCEBEAD),
            surface500 = Color(0xFF9893A5),
            accent = Color(0xFFD7827E),
            accentHover = Color(0xFFB4637A),
            edge = Color(0x1C575279),
            slate50 = Color(0xFF28253B),
            slate100 = Color(0xFF575279),
            slate200 = Color(0xFF797593),
            slate300 = Color(0xFF9893A5),
            slate400 = Color(0xFFB4637A),
            slate500 = Color(0xFFCEBEAD),
            slate600 = Color(0xFFDFD2C4),
            slate700 = Color(0xFFEBE1D7),
            slate800 = Color(0xFFF2E9E1),
            slate900 = Color(0xFFFAF4ED),
            slate950 = Color(0xFFFFFAF3),
            rowActive = Color(0x1AD7827E),
            rowIdleHover = Color(0x0A575279),
            isDark = false,
        ),
    ),
    "abyss" to AndroidThemeDefinition(
        id = "abyss",
        name = "Abyss (Deep Sea)",
        category = "Palette",
        isDark = true,
        description = "Deep oceanic navy trenches with radiant aquamarine bioluminescence.",
        previewGround = Color(0xFF050C14),
        previewSurface = Color(0xFF0F1E30),
        previewAccent = Color(0xFF38BDF8),
        previewText = Color(0xFFE0F2FE),
        palette = BetweenUsColorPalette(
            ground = Color(0xFF050C14),
            surface950 = Color(0xFF091420),
            surface900 = Color(0xFF0F1E30),
            surface850 = Color(0xFF0B1725),
            surface800 = Color(0xFF0D1B2C),
            surface700 = Color(0xFF193352),
            surface600 = Color(0xFF264D7A),
            surface500 = Color(0xFF38BDF8),
            accent = Color(0xFF38BDF8),
            accentHover = Color(0xFF0284C7),
            edge = Color(0x2438BDF8),
            slate50 = Color(0xFFE0F2FE),
            slate100 = Color(0xFFBAE6FD),
            slate200 = Color(0xFF7DD3FC),
            slate300 = Color(0xFF38BDF8),
            slate400 = Color(0xFF5E92C2),
            slate500 = Color(0xFF36638F),
            slate600 = Color(0xFF1E4163),
            slate700 = Color(0xFF132E4A),
            slate800 = Color(0xFF0D1B2C),
            slate900 = Color(0xFF091420),
            slate950 = Color(0xFF050C14),
            rowActive = Color(0x1F38BDF8),
            rowIdleHover = Color(0x0D38BDF8),
            isDark = true,
        ),
    ),
)

// ---------------------------------------------------------------------------
// Dynamic Theme Token State & CompositionLocal
// ---------------------------------------------------------------------------

object BetweenUsThemeTokens {
    var current: BetweenUsColorPalette = DEFAULT_DARK_PALETTE
}

val LocalBetweenUsColors = staticCompositionLocalOf { DEFAULT_DARK_PALETTE }

// ---------------------------------------------------------------------------
// Reactive property getters for seamless compatibility across existing call sites
// ---------------------------------------------------------------------------

val Ground: Color get() = BetweenUsThemeTokens.current.ground
val Surface950: Color get() = BetweenUsThemeTokens.current.surface950
val Surface900: Color get() = BetweenUsThemeTokens.current.surface900
val Surface850: Color get() = BetweenUsThemeTokens.current.surface850
val Surface800: Color get() = BetweenUsThemeTokens.current.surface800
val Surface700: Color get() = BetweenUsThemeTokens.current.surface700
val Surface600: Color get() = BetweenUsThemeTokens.current.surface600
val Surface500: Color get() = BetweenUsThemeTokens.current.surface500

val Accent: Color get() = BetweenUsThemeTokens.current.accent
val AccentHover: Color get() = BetweenUsThemeTokens.current.accentHover

val Danger: Color get() = BetweenUsThemeTokens.current.danger
val DangerHover: Color get() = BetweenUsThemeTokens.current.dangerHover

val Edge: Color get() = BetweenUsThemeTokens.current.edge

val Slate50: Color get() = BetweenUsThemeTokens.current.slate50
val Slate100: Color get() = BetweenUsThemeTokens.current.slate100
val Slate200: Color get() = BetweenUsThemeTokens.current.slate200
val Slate300: Color get() = BetweenUsThemeTokens.current.slate300
val Slate400: Color get() = BetweenUsThemeTokens.current.slate400
val Slate500: Color get() = BetweenUsThemeTokens.current.slate500

val Amber200: Color = Amber80
