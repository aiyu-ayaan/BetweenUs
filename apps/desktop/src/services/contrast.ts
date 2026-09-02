/**
 * How readable a colour is on another one, in the one unit that is not an
 * opinion.
 *
 * Sixteen themes landed in the multi-theme suite, every one of them with a
 * hand-written ramp, and none of the ramps had ever been measured. "It looks
 * fine on my monitor" is the thing contrast ratios exist to replace: a hint
 * line at 3.1:1 looks fine to somebody with good sight on a good screen in a
 * dark room, and is unreadable on a phone in daylight or to anybody whose
 * contrast sensitivity is not perfect.
 *
 * So the ratios are computed from the palettes themselves and asserted in
 * `contrast.check.ts`. That turns a thing nobody had looked at into a thing the
 * build refuses to let regress, which is worth more than one careful look.
 *
 * The maths is WCAG 2.1's, which is the standard every audit will be run
 * against whether or not this file agrees with it.
 */

/** `"124 92 255"` - the form the theme variables are written in. */
export function parseRgb(value: string): [number, number, number] | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const channels = parts.map((part) => Number(part));
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
    return null;
  }
  return [channels[0]!, channels[1]!, channels[2]!];
}

/**
 * One channel, linearised.
 *
 * sRGB is stored gamma-encoded, so the stored numbers are not proportional to
 * the light coming off the screen. Averaging them directly - which is what
 * "just compare the hex values" amounts to - gets the answer wrong in the
 * middle of the range, which is exactly where hint text lives.
 */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, 0 for black and 1 for white. */
export function luminance([r, g, b]: [number, number, number]): number {
  // The coefficients are the eye's own sensitivity: green carries most of the
  // perceived brightness and blue almost none.
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * The contrast ratio between two colours, from 1 (identical) to 21 (black on
 * white). Order does not matter.
 */
export function contrastRatio(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const one = luminance(a);
  const two = luminance(b);
  const lighter = Math.max(one, two);
  const darker = Math.min(one, two);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG 2.1 AA, which is the bar this project holds itself to.
 *
 * `NORMAL_TEXT` is body copy and anything small. `LARGE_TEXT` is the relaxation
 * for 18pt, or 14pt bold - and is also the bar for the *boundary* of a control,
 * which is why an icon or a border is checked against it rather than against
 * the stricter number.
 */
export const AA_NORMAL_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;

/** Rounded the way a report reads it: `4.53`, not `4.5299999`. */
export function ratioOf(foreground: string, background: string): number | null {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  if (!fg || !bg) return null;
  return Math.round(contrastRatio(fg, bg) * 100) / 100;
}

/**
 * The pairs a client actually draws, and what each has to clear.
 *
 * Deliberately short. A matrix of every colour against every other colour is a
 * hundred assertions about combinations nothing renders, and the first time one
 * fails somebody relaxes the whole check. These are the ones on screen in every
 * conversation:
 *
 * - Body text on the main panel and on the sidebar, which is most of the words
 *   in the app.
 * - Hint and timestamp text on both, which is the ramp most likely to be too
 *   quiet - `slate-400` is chosen to recede, and receding has a floor.
 * - The accent against the panel behind it, at the large-text bar, because it
 *   is drawn as fills, rings and icons rather than as body copy.
 */
export interface ContrastPair {
  /** What is drawn. */
  what: string;
  foreground: string;
  background: string;
  minimum: number;
}

export const CHECKED_PAIRS: ContrastPair[] = [
  {
    what: 'body text on the main panel',
    foreground: '--color-slate-100',
    background: '--color-surface-900',
    minimum: AA_NORMAL_TEXT,
  },
  {
    what: 'body text on the sidebar',
    foreground: '--color-slate-100',
    background: '--color-surface-800',
    minimum: AA_NORMAL_TEXT,
  },
  {
    what: 'body text on the ground',
    foreground: '--color-slate-100',
    background: '--color-ground',
    minimum: AA_NORMAL_TEXT,
  },
  {
    what: 'hint text on the main panel',
    foreground: '--color-slate-400',
    background: '--color-surface-900',
    minimum: AA_NORMAL_TEXT,
  },
  {
    what: 'hint text on the sidebar',
    foreground: '--color-slate-400',
    background: '--color-surface-800',
    minimum: AA_NORMAL_TEXT,
  },
  {
    what: 'the accent on the main panel',
    foreground: '--color-accent',
    background: '--color-surface-900',
    minimum: AA_LARGE_TEXT,
  },
];

export interface ContrastFinding {
  theme: string;
  what: string;
  ratio: number;
  minimum: number;
}

/** Every pair in [CHECKED_PAIRS] that does not clear its bar, for one theme. */
export function auditTheme(
  themeName: string,
  colors: Record<string, string>,
  pairs: ContrastPair[] = CHECKED_PAIRS,
): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  for (const pair of pairs) {
    const foreground = colors[pair.foreground];
    const background = colors[pair.background];
    if (!foreground || !background) continue;
    const ratio = ratioOf(foreground, background);
    // A colour that is not a plain `R G B` triple - `--color-edge` is an rgba
    // string - is not something this can measure, and skipping it is honest
    // where guessing at it would not be.
    if (ratio === null) continue;
    if (ratio < pair.minimum) {
      findings.push({ theme: themeName, what: pair.what, ratio, minimum: pair.minimum });
    }
  }
  return findings;
}
