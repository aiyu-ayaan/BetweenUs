---
sidebar_position: 6
---

# Multi-Theme Architecture & Design System

BetweenUs features a universal multi-theme system across **Desktop (Electron)**, **Web (Vite)**, and **Android (Jetpack Compose)**. The design architecture delivers 16 handcrafted themes across 5 categories, custom accent tints, dynamic OS Light/Dark auto-synchronization, and dedicated appearance settings interfaces on all platforms.

---

## The 16-Theme Collection

| Category | Theme ID | Display Name | Theme Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Signature & Dark** | `dark` | Dark (Iris) | Dark | Signature near-black ink surfaces with vibrant `#7C5CFF` iris highlights. |
| | `midnight` | Midnight (OLED) | Dark | True black (`#000000`) surfaces optimized for OLED panels and deep focus. |
| | `nord` | Nord Frost | Dark | Arctic north-bluish palette with cool grey tones and frost cyan. |
| | `abyss` | Abyss (Deep Sea) | Dark | Deep oceanic navy trenches with bioluminescent aquamarine accents. |
| **Light Mode** | `light` | Daylight | Light | High-contrast light theme with soft slate panels on an airy workbench. |
| | `solarized-light` | Solarized Light | Light | Calibrated warm parchment palette for low eye strain. |
| | `rose-pine-dawn` | Rosé Pine Dawn | Light | Scandinavian morning light with soft rose, pine, and gold. |
| **Developer** | `dracula` | Dracula | Dark | Gothic purple developer palette with neon pink and cyan highlights. |
| | `solarized-dark` | Solarized Dark | Dark | Calibrated low-contrast cyan and teal dark palette for night coding. |
| | `monokai` | Monokai Pro | Dark | Warm obsidian background with vibrant phosphor yellow and pink accents. |
| **Vibrant & Warm** | `catppuccin` | Catppuccin Mocha | Dark | Cozy pastel tones with lavender accents and soft contrasts. |
| | `tokyo-night` | Tokyo Night | Dark | Cyberpunk neon dusk inspired by the lights of downtown Tokyo. |
| | `crimson` | Crimson Dusk | Dark | Deep wine and velvety burgundy surfaces with luminous rose accents. |
| | `emerald` | Emerald Matrix | Dark | Moody deep botanical greens with radiant emerald highlights. |
| | `cyberpunk` | Cyberpunk 2077 | Dark | High-octane neon yellow, intense cyan, and deep asphalt noir. |
| | `sepia` | Espresso & Cream | Dark | Roasted espresso ground with creamy latte text and warm caramel bronze. |

---

## Accent Tint Customization

Users can optionally override the theme's default brand accent with personalized accent tints:
- **Theme Default** (Theme native primary)
- **Iris** (`#7C5CFF`)
- **Sky Blue** (`#0EA5E9`)
- **Emerald** (`#10B981`)
- **Rose** (`#F43F5E`)
- **Amber** (`#F59E0B`)
- **Electric Violet** (`#A855F7`)
- **Teal** (`#14B8A6`)

---

## Desktop & Web Implementation

### CSS Variable Injection
- Defined in `apps/desktop/src/index.css` under `:root[data-theme="..."]` and `body[data-theme="..."]`.
- The store (`apps/desktop/src/stores/theme.ts`) syncs properties to both `document.documentElement` and `document.body` via `useThemeStore`.
- Custom accent tints dynamically override `--color-accent` and `--color-accent-hover`.

### Native Windows Title Bar Integration
- In Electron (`apps/desktop/electron/main.ts`), an IPC bridge (`window:titlebar-overlay`) handles dynamic overlay color updates:
  ```typescript
  ipcMain.handle('window:titlebar-overlay', (_event, options) => {
    if (mainWindow && process.platform === 'win32') {
      mainWindow.setTitleBarOverlay(options);
    }
  });
  ```
- Title bar controls seamlessly match each theme's surface color, active status, and light/dark button symbols.

---

## Android Implementation

### Dynamic Material 3 Expressive Theming
- Located in `apps/android/ui-common/.../theme/`:
  - [`Color.kt`](file:///D:/VS-Code/AI%20Expermients/Betweenus/apps/android/ui-common/src/main/java/com/aatech/betweenus/ui/theme/Color.kt): Contains all 16 `BetweenUsColorPalette` definitions, `ACCENT_PRESETS`, and `BetweenUsThemeTokens`.
  - [`Theme.kt`](file:///D:/VS-Code/AI%20Expermients/Betweenus/apps/android/ui-common/src/main/java/com/aatech/betweenus/ui/theme/Theme.kt): Generates dynamic `darkColorScheme` and `lightColorScheme` container ramps and provides `LocalBetweenUsColors` CompositionLocal.
  - **Material You Dynamic Theming (Android 12+)**: Uses `dynamicDarkColorScheme(context)` and `dynamicLightColorScheme(context)` to automatically extract palette and accent tokens from the device's wallpaper.
  - [`ThemePreferences.kt`](file:///D:/VS-Code/AI%20Expermients/Betweenus/apps/android/core/src/main/java/com/aatech/betweenus/core/store/ThemePreferences.kt): Persists choices in `SharedPreferences` with reactive Kotlin `StateFlow`.

### Dedicated Themes Page & Fluid Motion
- Accessible via `Route.Themes` in [`ThemesScreen.kt`](file:///D:/VS-Code/AI%20Expermients/Betweenus/apps/android/app/src/main/java/com/aatech/betweenus/feature/settings/ThemesScreen.kt).
- Features a **Live Preview Sandbox**, **System Sync toggle**, **Dynamic Theming (Material You) toggle**, **Animated Category Filter Pills** (`AnimatedContent`), and **2-Column Interactive Theme Cards**.
- Forward and backward transitions use Material 3 Expressive spring physics (`slideInHorizontally(travel) { it } + fadeIn(fade)` and `popExitTransition = { slideOutHorizontally(travel) { it } + fadeOut(fade) }`).

## Contrast, measured

Sixteen themes, every one with a hand-written tonal ramp, and none of them had
ever been measured. "It looks fine on my monitor" is exactly what contrast
ratios exist to replace: a hint line at 3:1 looks fine to somebody with good
sight on a good screen in a dark room, and is unreadable on a phone in daylight
or to anybody whose contrast sensitivity is not perfect.

So the ratios are computed from the palettes themselves.
[`contrast.ts`](file:///D:/VS-Code/AI%20Expermients/Betweenus/apps/desktop/src/services/contrast.ts)
implements WCAG 2.1 relative luminance and the contrast ratio, and
`contrast.check.ts` — part of `pnpm check` — runs six pairs against every
shipped theme:

| Pair | Bar |
| --- | --- |
| Body text on the main panel, the sidebar, and the ground | 4.5:1 (AA normal text) |
| Hint text on the main panel and the sidebar | 4.5:1 |
| The accent on the main panel | 3:1 (AA large text / UI component) |

Six rather than every colour against every other colour, deliberately: a hundred
assertions about combinations nothing renders is a check that gets relaxed the
first time one fails.

**The first run found eighteen failures across eleven of the sixteen themes.**
Body text was never the problem — 5.6:1 at worst. Every failure but one was the
`slate-400` hint ramp, which is the shade chosen to recede, and receding has a
floor: Tokyo Night at 2.76:1, Monokai Pro at 2.88:1, Solarized in both
directions near 2.9:1, Dracula at 3.03:1. The exception was Rosé Pine Dawn's
accent at 2.74:1 against a 3:1 bar.

Each was corrected by the **minimum** nudge toward whichever of black or white
raises contrast against that theme's own surface — computed, not chosen, because
the smallest change that clears the bar is the one least likely to undo what the
theme was meant to look like. The check now holds the line for any theme added
or edited later.

Note that gamma is why this is a function rather than a comparison of hex
values: sRGB is stored gamma-encoded, so the stored numbers are not proportional
to the light coming off the screen, and a naive average gets the answer wrong in
the middle of the range — which is precisely where hint text lives.

## Density

`density.ts`, and it is a separate axis from the theme: a theme decides what
colour things are, density decides how much space they get. Cozy is the default
and compact is every step tighter — the gap above a message continuing a run,
the gap above one starting a run, the gutter beside the avatar column, and the
list's own inset.

Both spacing sets live in one table so the two values for a measurement sit next
to each other. A check asserts that every measurement differs between the modes,
which is what catches somebody adding a fifth measurement and setting only one
of its values, and that none of them collapses to zero — a run with no gap at
all stops reading as several messages and starts reading as one long one with
odd line breaks, a different failure from being cramped.

Two things it deliberately is not:

- **Not a font-size control.** The OS already has one, it is the accessible way
  to ask for larger text, and a second control inside the app that disagreed
  with it would be worse than none. Density changes the space *around*
  messages, which is the thing the OS cannot know about because it is about how
  many messages somebody wants on screen at once.
- **Not the grouping rule.** Consecutive messages from one author within five
  minutes already collapse into a run on every client, broken by a day divider.
  That is untouched: density decides how much air a run gets, not what counts as
  one.

The choice is stored in `ThemeSettings` alongside the theme and the accent, so
it is per machine rather than per account — it is about this screen at this
sitting distance, and the same person on a laptop and a large monitor
reasonably wants different answers.
