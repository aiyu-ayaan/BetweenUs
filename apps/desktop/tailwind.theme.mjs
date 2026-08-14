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
 * Nexora is drawn as floating panels on a dark ground, the way a modern editor
 * is: every region - rail, sidebar, main surface, right-hand panel - is its own
 * rounded card with a hairline edge, and the ground shows through the gutters
 * between them. That is the whole visual idea, and it is deliberately not the
 * flat wall of grey columns a chat app usually is.
 *
 * The old palette was Discord's, hex for hex, down to `#5865f2` and the `gg
 * sans` font stack. None of it is left. The ramp below is Nexora's own: a cool
 * near-black ink with an iris accent.
 */
export const theme = {
  extend: {
    colors: {
      /**
       * The ground the panels float on. Nothing else is this dark, which is
       * what makes a gutter read as a gutter rather than as a border.
       */
      ground: '#06070a',

      // Surface ramp. The names are positional so a component never has to
      // know which shade it is standing on:
      //   950 rail            850 panel footer      800 sidebar panel
      //   900 main panel      600 raised card       700 input / hover / active
      //   500 divider, scrollbar thumb, strongest fill
      surface: {
        950: '#0b0d12',
        900: '#15181f',
        850: '#0f1117',
        800: '#101319',
        700: '#222734',
        600: '#1a1e27',
        500: '#333a4a',
      },
      accent: {
        DEFAULT: '#7c5cff',
        hover: '#6a44f5',
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
      edge: 'rgba(255, 255, 255, 0.07)',
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
