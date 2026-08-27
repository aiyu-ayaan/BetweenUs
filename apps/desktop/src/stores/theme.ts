/**
 * Themes and visual appearance for BetweenUs.
 *
 * Persisted to local storage so a theme is remembered per machine/browser.
 * Also synchronizes early before React mounts to avoid any flash of unstyled theme.
 */
import { create } from 'zustand';

export type ThemeId =
  | 'dark'
  | 'light'
  | 'midnight'
  | 'nord'
  | 'catppuccin'
  | 'tokyo-night'
  | 'crimson'
  | 'emerald';

export type ThemeType = 'dark' | 'light';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  category: string;
  type: ThemeType;
  description: string;
  preview: {
    ground: string;
    surface: string;
    accent: string;
    text: string;
  };
  colors: Record<string, string>;
}

export interface AccentChoice {
  id: string;
  label: string;
  hex: string;
  value: string;
  hover: string;
}

export const ACCENT_PRESETS: AccentChoice[] = [
  { id: 'default', label: 'Theme Default', hex: '', value: '', hover: '' },
  { id: 'iris', label: 'Iris', hex: '#7c5cff', value: '124 92 255', hover: '106 68 245' },
  { id: 'sky', label: 'Sky Blue', hex: '#0ea5e9', value: '14 165 233', hover: '2 132 199' },
  { id: 'emerald', label: 'Emerald', hex: '#10b981', value: '16 185 129', hover: '5 150 105' },
  { id: 'rose', label: 'Rose', hex: '#f43f5e', value: '244 63 94', hover: '225 29 72' },
  { id: 'amber', label: 'Amber', hex: '#f59e0b', value: '245 158 11', hover: '217 119 6' },
  { id: 'violet', label: 'Electric Violet', hex: '#a855f7', value: '168 85 247', hover: '147 51 234' },
  { id: 'teal', label: 'Teal', hex: '#14b8a6', value: '20 184 166', hover: '13 148 136' },
];

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  dark: {
    id: 'dark',
    name: 'Dark (Iris)',
    category: 'Signature',
    type: 'dark',
    description: 'BetweenUs signature cool near-black ink with vibrant iris accents.',
    preview: {
      ground: '#06070a',
      surface: '#15181f',
      accent: '#7c5cff',
      text: '#f1f5f9',
    },
    colors: {
      '--color-ground': '6 7 10',
      '--color-surface-950': '11 13 18',
      '--color-surface-900': '21 24 31',
      '--color-surface-850': '15 17 23',
      '--color-surface-800': '16 19 25',
      '--color-surface-700': '34 39 52',
      '--color-surface-600': '26 30 39',
      '--color-surface-500': '51 58 74',
      '--color-accent': '124 92 255',
      '--color-accent-hover': '106 68 245',
      '--color-edge': 'rgba(255, 255, 255, 0.07)',
      '--color-slate-50': '248 250 252',
      '--color-slate-100': '241 245 249',
      '--color-slate-200': '226 232 240',
      '--color-slate-300': '203 213 225',
      '--color-slate-400': '148 163 184',
      '--color-slate-500': '100 116 139',
      '--color-slate-600': '71 85 105',
      '--color-slate-700': '51 65 85',
      '--color-slate-800': '30 41 59',
      '--color-slate-900': '15 23 42',
      '--color-slate-950': '2 6 23',
      '--color-row-active': 'rgba(255, 255, 255, 0.07)',
      '--color-row-idle-hover': 'rgba(255, 255, 255, 0.04)',
      '--color-scrollbar-thumb': 'rgba(255, 255, 255, 0.06)',
      '--color-scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.15)',
    },
  },
  light: {
    id: 'light',
    name: 'Daylight',
    category: 'Light',
    type: 'light',
    description: 'Crisp, high-contrast light theme with soft slate panels on an airy workbench.',
    preview: {
      ground: '#e9edf4',
      surface: '#ffffff',
      accent: '#6355d8',
      text: '#0f172a',
    },
    colors: {
      '--color-ground': '233 237 244',
      '--color-surface-950': '255 255 255',
      '--color-surface-900': '255 255 255',
      '--color-surface-850': '248 250 252',
      '--color-surface-800': '241 245 249',
      '--color-surface-700': '226 232 240',
      '--color-surface-600': '203 213 225',
      '--color-surface-500': '148 163 184',
      '--color-accent': '99 85 216',
      '--color-accent-hover': '80 66 196',
      '--color-edge': 'rgba(15, 23, 42, 0.09)',
      '--color-slate-50': '9 13 22',
      '--color-slate-100': '15 23 42',
      '--color-slate-200': '30 41 59',
      '--color-slate-300': '51 65 85',
      '--color-slate-400': '100 116 139',
      '--color-slate-500': '148 163 184',
      '--color-slate-600': '203 213 225',
      '--color-slate-700': '226 232 240',
      '--color-slate-800': '241 245 249',
      '--color-slate-900': '248 250 252',
      '--color-slate-950': '255 255 255',
      '--color-row-active': 'rgba(15, 23, 42, 0.06)',
      '--color-row-idle-hover': 'rgba(15, 23, 42, 0.035)',
      '--color-scrollbar-thumb': 'rgba(15, 23, 42, 0.12)',
      '--color-scrollbar-thumb-hover': 'rgba(15, 23, 42, 0.22)',
    },
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight (OLED)',
    category: 'Monochrome',
    type: 'dark',
    description: 'Pitch black backdrop designed for OLED displays and deep focus.',
    preview: {
      ground: '#000000',
      surface: '#0d0d11',
      accent: '#8b5cf6',
      text: '#f3f4f6',
    },
    colors: {
      '--color-ground': '0 0 0',
      '--color-surface-950': '6 6 8',
      '--color-surface-900': '13 13 17',
      '--color-surface-850': '8 8 10',
      '--color-surface-800': '9 9 13',
      '--color-surface-700': '25 25 34',
      '--color-surface-600': '19 19 26',
      '--color-surface-500': '42 42 56',
      '--color-accent': '139 92 246',
      '--color-accent-hover': '124 58 237',
      '--color-edge': 'rgba(255, 255, 255, 0.09)',
      '--color-slate-50': '255 255 255',
      '--color-slate-100': '243 244 246',
      '--color-slate-200': '229 231 235',
      '--color-slate-300': '209 213 219',
      '--color-slate-400': '156 163 175',
      '--color-slate-500': '107 114 128',
      '--color-slate-600': '75 85 99',
      '--color-slate-700': '55 65 81',
      '--color-slate-800': '31 41 55',
      '--color-slate-900': '17 24 39',
      '--color-slate-950': '3 7 18',
      '--color-row-active': 'rgba(255, 255, 255, 0.08)',
      '--color-row-idle-hover': 'rgba(255, 255, 255, 0.04)',
      '--color-scrollbar-thumb': 'rgba(255, 255, 255, 0.07)',
      '--color-scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.16)',
    },
  },
  nord: {
    id: 'nord',
    name: 'Nord Frost',
    category: 'Palette',
    type: 'dark',
    description: 'Arctic, north-bluish palette with soothing cool grey surfaces and frost cyan.',
    preview: {
      ground: '#242933',
      surface: '#3b4252',
      accent: '#88c0d0',
      text: '#eceff4',
    },
    colors: {
      '--color-ground': '36 41 51',
      '--color-surface-950': '43 48 60',
      '--color-surface-900': '59 66 82',
      '--color-surface-850': '46 52 64',
      '--color-surface-800': '50 56 70',
      '--color-surface-700': '67 76 94',
      '--color-surface-600': '76 86 106',
      '--color-surface-500': '216 222 233',
      '--color-accent': '136 192 208',
      '--color-accent-hover': '129 161 193',
      '--color-edge': 'rgba(216, 222, 233, 0.09)',
      '--color-slate-50': '236 239 244',
      '--color-slate-100': '229 233 240',
      '--color-slate-200': '216 222 233',
      '--color-slate-300': '194 200 210',
      '--color-slate-400': '154 162 177',
      '--color-slate-500': '120 130 148',
      '--color-slate-600': '76 86 106',
      '--color-slate-700': '67 76 94',
      '--color-slate-800': '59 66 82',
      '--color-slate-900': '46 52 64',
      '--color-slate-950': '36 41 51',
      '--color-row-active': 'rgba(216, 222, 233, 0.08)',
      '--color-row-idle-hover': 'rgba(216, 222, 233, 0.04)',
      '--color-scrollbar-thumb': 'rgba(216, 222, 233, 0.08)',
      '--color-scrollbar-thumb-hover': 'rgba(216, 222, 233, 0.16)',
    },
  },
  catppuccin: {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    category: 'Pastel',
    type: 'dark',
    description: 'Warm, cozy pastel tones with lavender accents and soft contrasts.',
    preview: {
      ground: '#11111b',
      surface: '#1e1e2e',
      accent: '#cba6f7',
      text: '#cdd6f4',
    },
    colors: {
      '--color-ground': '17 17 27',
      '--color-surface-950': '24 24 37',
      '--color-surface-900': '30 30 46',
      '--color-surface-850': '24 24 37',
      '--color-surface-800': '27 27 42',
      '--color-surface-700': '49 50 68',
      '--color-surface-600': '69 71 90',
      '--color-surface-500': '88 91 112',
      '--color-accent': '203 166 247',
      '--color-accent-hover': '180 190 254',
      '--color-edge': 'rgba(205, 214, 244, 0.1)',
      '--color-slate-50': '205 214 244',
      '--color-slate-100': '186 194 222',
      '--color-slate-200': '166 173 200',
      '--color-slate-300': '147 153 178',
      '--color-slate-400': '127 132 156',
      '--color-slate-500': '108 112 134',
      '--color-slate-600': '88 91 112',
      '--color-slate-700': '69 71 90',
      '--color-slate-800': '49 50 68',
      '--color-slate-900': '30 30 46',
      '--color-slate-950': '17 17 27',
      '--color-row-active': 'rgba(205, 214, 244, 0.08)',
      '--color-row-idle-hover': 'rgba(205, 214, 244, 0.04)',
      '--color-scrollbar-thumb': 'rgba(205, 214, 244, 0.08)',
      '--color-scrollbar-thumb-hover': 'rgba(205, 214, 244, 0.16)',
    },
  },
  'tokyo-night': {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    category: 'Vibrant',
    type: 'dark',
    description: 'Cyberpunk neon dusk inspired by the lights of downtown Tokyo.',
    preview: {
      ground: '#13141c',
      surface: '#1a1b26',
      accent: '#7aa2f7',
      text: '#c0caf5',
    },
    colors: {
      '--color-ground': '19 20 28',
      '--color-surface-950': '22 22 30',
      '--color-surface-900': '26 27 38',
      '--color-surface-850': '22 22 34',
      '--color-surface-800': '24 25 36',
      '--color-surface-700': '36 40 59',
      '--color-surface-600': '47 53 73',
      '--color-surface-500': '65 72 104',
      '--color-accent': '122 162 247',
      '--color-accent-hover': '97 139 245',
      '--color-edge': 'rgba(122, 162, 247, 0.12)',
      '--color-slate-50': '192 202 245',
      '--color-slate-100': '169 177 214',
      '--color-slate-200': '154 165 206',
      '--color-slate-300': '122 162 247',
      '--color-slate-400': '86 95 137',
      '--color-slate-500': '65 72 104',
      '--color-slate-600': '52 59 88',
      '--color-slate-700': '36 40 59',
      '--color-slate-800': '31 35 53',
      '--color-slate-900': '26 27 38',
      '--color-slate-950': '19 20 28',
      '--color-row-active': 'rgba(122, 162, 247, 0.1)',
      '--color-row-idle-hover': 'rgba(122, 162, 247, 0.05)',
      '--color-scrollbar-thumb': 'rgba(122, 162, 247, 0.1)',
      '--color-scrollbar-thumb-hover': 'rgba(122, 162, 247, 0.2)',
    },
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson Dusk',
    category: 'Vibrant',
    type: 'dark',
    description: 'Deep wine and velvety burgundy surfaces with luminous rose accents.',
    preview: {
      ground: '#0f090d',
      surface: '#1e121b',
      accent: '#f43f5e',
      text: '#ffe4e6',
    },
    colors: {
      '--color-ground': '15 9 13',
      '--color-surface-950': '22 13 19',
      '--color-surface-900': '30 18 27',
      '--color-surface-850': '24 14 21',
      '--color-surface-800': '26 15 24',
      '--color-surface-700': '51 28 44',
      '--color-surface-600': '41 22 36',
      '--color-surface-500': '74 41 64',
      '--color-accent': '244 63 94',
      '--color-accent-hover': '225 29 72',
      '--color-edge': 'rgba(244, 63, 94, 0.12)',
      '--color-slate-50': '255 228 230',
      '--color-slate-100': '254 205 211',
      '--color-slate-200': '253 164 175',
      '--color-slate-300': '251 113 133',
      '--color-slate-400': '244 63 94',
      '--color-slate-500': '159 18 57',
      '--color-slate-600': '136 19 55',
      '--color-slate-700': '76 5 25',
      '--color-slate-800': '30 18 27',
      '--color-slate-900': '22 13 19',
      '--color-slate-950': '15 9 13',
      '--color-row-active': 'rgba(244, 63, 94, 0.1)',
      '--color-row-idle-hover': 'rgba(244, 63, 94, 0.05)',
      '--color-scrollbar-thumb': 'rgba(244, 63, 94, 0.1)',
      '--color-scrollbar-thumb-hover': 'rgba(244, 63, 94, 0.2)',
    },
  },
  emerald: {
    id: 'emerald',
    name: 'Emerald Matrix',
    category: 'Vibrant',
    type: 'dark',
    description: 'Moody deep botanical greens with radiant emerald highlights.',
    preview: {
      ground: '#060d09',
      surface: '#0e1c16',
      accent: '#10b981',
      text: '#d1fae5',
    },
    colors: {
      '--color-ground': '6 13 9',
      '--color-surface-950': '10 20 15',
      '--color-surface-900': '14 28 22',
      '--color-surface-850': '12 23 18',
      '--color-surface-800': '13 25 19',
      '--color-surface-700': '25 51 39',
      '--color-surface-600': '20 41 32',
      '--color-surface-500': '39 79 61',
      '--color-accent': '16 185 129',
      '--color-accent-hover': '5 150 105',
      '--color-edge': 'rgba(16, 185, 129, 0.12)',
      '--color-slate-50': '209 250 229',
      '--color-slate-100': '167 243 208',
      '--color-slate-200': '110 231 183',
      '--color-slate-300': '52 211 153',
      '--color-slate-400': '16 185 129',
      '--color-slate-500': '5 150 105',
      '--color-slate-600': '4 120 87',
      '--color-slate-700': '6 95 70',
      '--color-slate-800': '6 78 59',
      '--color-slate-900': '14 28 22',
      '--color-slate-950': '6 13 9',
      '--color-row-active': 'rgba(16, 185, 129, 0.1)',
      '--color-row-idle-hover': 'rgba(16, 185, 129, 0.05)',
      '--color-scrollbar-thumb': 'rgba(16, 185, 129, 0.1)',
      '--color-scrollbar-thumb-hover': 'rgba(16, 185, 129, 0.2)',
    },
  },
};

const STORAGE_KEY = 'betweenus.theme-settings';

export interface ThemeSettings {
  selectedTheme: ThemeId;
  followSystem: boolean;
  customAccentId: string;
}

const DEFAULT_SETTINGS: ThemeSettings = {
  selectedTheme: 'dark',
  followSystem: false,
  customAccentId: 'default',
};

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveEffectiveTheme(settings: ThemeSettings): ThemeId {
  if (settings.followSystem) {
    const isDark = getSystemPrefersDark();
    if (!isDark) return 'light';
    // If system is dark, respect user's picked dark theme or default dark
    return settings.selectedTheme === 'light' ? 'dark' : settings.selectedTheme;
  }
  return settings.selectedTheme;
}

function applyThemeToDocument(resolvedThemeId: ThemeId, customAccentId: string): void {
  if (typeof document === 'undefined') return;

  const themeDef = THEMES[resolvedThemeId] ?? THEMES.dark;
  const targets = [document.documentElement, document.body].filter(Boolean) as HTMLElement[];

  for (const target of targets) {
    target.setAttribute('data-theme', themeDef.id);
    target.style.colorScheme = themeDef.type;

    // Apply CSS color variables
    for (const [key, value] of Object.entries(themeDef.colors)) {
      target.style.setProperty(key, value);
    }

    // If a custom accent was chosen, override the accent variables
    const accent = ACCENT_PRESETS.find((preset) => preset.id === customAccentId);
    if (accent && accent.value) {
      target.style.setProperty('--color-accent', accent.value);
      target.style.setProperty('--color-accent-hover', accent.hover);
    } else {
      // Revert to theme's defined accent
      target.style.setProperty('--color-accent', themeDef.colors['--color-accent'] ?? '124 92 255');
      target.style.setProperty('--color-accent-hover', themeDef.colors['--color-accent-hover'] ?? '106 68 245');
    }
  }
}

function loadSettings(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return {
      selectedTheme: parsed.selectedTheme && THEMES[parsed.selectedTheme] ? parsed.selectedTheme : 'dark',
      followSystem: Boolean(parsed.followSystem),
      customAccentId: parsed.customAccentId ?? 'default',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface ThemeState {
  settings: ThemeSettings;
  resolvedTheme: ThemeId;
  setTheme: (themeId: ThemeId) => void;
  setFollowSystem: (follow: boolean) => void;
  setCustomAccent: (accentId: string) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  settings: loadSettings(),
  resolvedTheme: resolveEffectiveTheme(loadSettings()),

  setTheme: (themeId: ThemeId) => {
    const nextSettings: ThemeSettings = {
      ...get().settings,
      selectedTheme: themeId,
      followSystem: false, // Explicit theme click disables followSystem
    };
    const resolved = resolveEffectiveTheme(nextSettings);
    set({ settings: nextSettings, resolvedTheme: resolved });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
    } catch {}
    applyThemeToDocument(resolved, nextSettings.customAccentId);
  },

  setFollowSystem: (follow: boolean) => {
    const nextSettings: ThemeSettings = {
      ...get().settings,
      followSystem: follow,
    };
    const resolved = resolveEffectiveTheme(nextSettings);
    set({ settings: nextSettings, resolvedTheme: resolved });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
    } catch {}
    applyThemeToDocument(resolved, nextSettings.customAccentId);
  },

  setCustomAccent: (accentId: string) => {
    const nextSettings: ThemeSettings = {
      ...get().settings,
      customAccentId: accentId,
    };
    set({ settings: nextSettings });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
    } catch {}
    applyThemeToDocument(get().resolvedTheme, nextSettings.customAccentId);
  },
}));

/**
 * Initialize theme immediately at bootstrap and set up OS color scheme change listener.
 */
export function initTheme(): () => void {
  const initial = loadSettings();
  const resolved = resolveEffectiveTheme(initial);
  applyThemeToDocument(resolved, initial.customAccentId);

  if (typeof window === 'undefined' || !window.matchMedia) return () => {};

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = (): void => {
    const current = useThemeStore.getState().settings;
    if (current.followSystem) {
      const nextResolved = resolveEffectiveTheme(current);
      useThemeStore.setState({ resolvedTheme: nextResolved });
      applyThemeToDocument(nextResolved, current.customAccentId);
    }
  };

  mediaQuery.addEventListener('change', listener);
  return () => mediaQuery.removeEventListener('change', listener);
}
