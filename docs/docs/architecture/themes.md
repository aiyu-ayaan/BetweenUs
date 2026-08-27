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
