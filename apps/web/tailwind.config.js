import desktop from '../desktop/tailwind.config.js';

/**
 * The desktop theme, unchanged - the two clients are meant to look identical.
 * Only the content globs differ, because the classes live in the desktop
 * source tree that this bundle mounts.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  ...desktop,
  content: ['./index.html', './src/**/*.{ts,tsx}', '../desktop/src/**/*.{ts,tsx}'],
};
