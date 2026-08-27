/**
 * The palette both clients are drawn from - the Electron app and the browser
 * bundle in `apps/web`, which are meant to look identical.
 *
 * It lives in its own `.mjs` rather than inside `tailwind.config.js` because
 * `apps/web` imports it across a package boundary. A bare `.js` there leaves
 * Node to guess the module type from the nearest package.json, and this one has
 * no `"type"` on purpose: the Electron main process is bundled as CommonJS, so
 * declaring the package a module makes `dist-electron/main.js` unloadable and
 * the desktop app will not start. `.mjs` says "ES module" outright and asks
 * nobody's opinion.
 *
 * ## The workbench look
 *
 * BetweenUs is drawn as floating panels on a dark ground, the way a modern editor
 * is: every region - rail, sidebar, main surface, right-hand panel - is its own
 * rounded card with a hairline edge, and the ground shows through the gutters
 * between them. That is the whole visual idea, and it is deliberately not the
 * flat wall of grey columns a chat app usually is.
 *
 * The old palette was Discord's, hex for hex, down to `#5865f2` and the `gg
 * sans` font stack. None of it is left. The ramp below is BetweenUs's own: a cool
 * near-black ink with an iris accent.
 */
export const theme = {
  extend: {
    colors: {
      /**
       * The ground the panels float on. Dynamically mapped through theme CSS variables.
       */
      ground: 'rgb(var(--color-ground) / <alpha-value>)',

      // Surface ramp. The names are positional so a component never has to
      // know which shade it is standing on:
      //   950 rail            850 panel footer      800 sidebar panel
      //   900 main panel      600 raised card       700 input / hover / active
      //   500 divider, scrollbar thumb, strongest fill
      surface: {
        950: 'rgb(var(--color-surface-950) / <alpha-value>)',
        900: 'rgb(var(--color-surface-900) / <alpha-value>)',
        850: 'rgb(var(--color-surface-850) / <alpha-value>)',
        800: 'rgb(var(--color-surface-800) / <alpha-value>)',
        700: 'rgb(var(--color-surface-700) / <alpha-value>)',
        600: 'rgb(var(--color-surface-600) / <alpha-value>)',
        500: 'rgb(var(--color-surface-500) / <alpha-value>)',
      },
      accent: {
        DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
        hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
      },
      slate: {
        50: 'rgb(var(--color-slate-50) / <alpha-value>)',
        100: 'rgb(var(--color-slate-100) / <alpha-value>)',
        200: 'rgb(var(--color-slate-200) / <alpha-value>)',
        300: 'rgb(var(--color-slate-300) / <alpha-value>)',
        400: 'rgb(var(--color-slate-400) / <alpha-value>)',
        500: 'rgb(var(--color-slate-500) / <alpha-value>)',
        600: 'rgb(var(--color-slate-600) / <alpha-value>)',
        700: 'rgb(var(--color-slate-700) / <alpha-value>)',
        800: 'rgb(var(--color-slate-800) / <alpha-value>)',
        900: 'rgb(var(--color-slate-900) / <alpha-value>)',
        950: 'rgb(var(--color-slate-950) / <alpha-value>)',
      },
      // Status dots, and the only place these hues are used.
      status: {
        online: '#3fd68c',
        idle: '#f5b83d',
        dnd: '#ff5d5d',
        offline: '#6b7280',
      },
      danger: {
        DEFAULT: '#ff4d4f',
        hover: '#d13537',
      },
    },
    borderColor: {
      /** The hairline every panel is drawn with. One value, used everywhere. */
      edge: 'var(--color-edge, rgba(255, 255, 255, 0.07))',
    },
    borderRadius: {
      panel: '0.75rem',
    },
    boxShadow: {
      /** A panel sits on the ground; it does not hover over it. */
      panel: '0 1px 2px rgba(0, 0, 0, 0.4)',
      /** Anything that opened on top of the workbench does hover. */
      pop: '0 12px 32px -8px rgba(0, 0, 0, 0.7)',
    },
    fontFamily: {
      sans: [
        'Inter',
        'Segoe UI Variable Text',
        'Segoe UI',
        'system-ui',
        'Helvetica Neue',
        'sans-serif',
      ],
      mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
    },
    keyframes: {
      // Everything that arrives on top of the workbench arrives the same way:
      // a short rise with the scale still slightly under one, so it reads as
      // coming forward rather than fading in from nowhere.
      pop: {
        from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
        to: { opacity: '1', transform: 'none' },
      },
      fade: {
        from: { opacity: '0' },
        to: { opacity: '1' },
      },
    },
    animation: {
      pop: 'pop 140ms cubic-bezier(0.32, 0.72, 0, 1)',
      fade: 'fade 120ms ease-out',
    },
  },
};
