/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface ramp, darkest first: rail, user panel, sidebar, chat, inputs,
        // hover. The names are positional so a component never has to know
        // which shade of grey it is standing on.
        surface: {
          950: '#1e1f22',
          900: '#313338',
          850: '#232428',
          800: '#2b2d31',
          700: '#404249',
          600: '#383a40',
          500: '#4e5058',
        },
        accent: {
          DEFAULT: '#5865f2',
          hover: '#4752c4',
        },
        // Status dots, and the only place these hues are used.
        status: {
          online: '#23a55a',
          idle: '#f0b232',
          dnd: '#f23f43',
          offline: '#80848e',
        },
        danger: {
          DEFAULT: '#da373c',
          hover: '#a12828',
        },
      },
      fontFamily: {
        sans: [
          'gg sans',
          'Segoe UI Variable',
          'Segoe UI',
          'system-ui',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
