import { theme } from './tailwind.theme.mjs';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme,
  plugins: [],
};
