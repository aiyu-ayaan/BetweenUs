/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Same surface ramp as the desktop client, so the two look related.
        surface: {
          950: '#0B1120',
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
        },
        accent: {
          DEFAULT: '#3B82F6',
          hover: '#2563EB',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
