import { theme } from '../desktop/tailwind.theme.mjs';

/**
 * The desktop theme, unchanged - the two clients are meant to look identical.
 * Only the content globs differ, because the classes live in the desktop
 * source tree that this bundle mounts.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}', '../desktop/src/**/*.{ts,tsx}'],
  theme,
  plugins: [],
};
