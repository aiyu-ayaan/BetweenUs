/**
 * How many bars of a voice message actually get drawn, and whether they fit.
 *
 * This exists because they did not. Forty-eight bars were rendered into a
 * couple of hundred pixels with a gap between each one, the gaps ate most of
 * the width, and every bar came out about a pixel across - drawn, present in
 * the DOM, and invisible. "The waveform is missing" was a width budget nobody
 * had done the arithmetic for.
 *
 * So the arithmetic lives here, next to a check that runs it. It is the kind
 * of layout bug that cannot be caught by types and is only ever noticed by
 * somebody looking at a screen, which is the worst way to find out.
 *
 * No imports on purpose: this is arithmetic, and keeping it free of app wiring
 * means it also runs under Node for `pnpm --filter @betweenus/desktop check`.
 */

/**
 * The pixel budget the player is laid out in, as the stylesheet spends it.
 *
 * Kept as numbers rather than read back off the DOM: the point is to be able
 * to assert on the layout without a browser, and these are the values the
 * classes in `VoiceMessage.tsx` compile to. If one is changed there, the check
 * beside this fails - which is the entire reason to write them down twice.
 */
export const WAVE_LAYOUT = {
  /** `sm:min-w-[17rem]` on the player. The narrowest it is ever laid out at. */
  minPlayerPx: 17 * 16,
  /** What a phone bubble realistically leaves, at `max-w-[78%]` of a 360px screen. */
  mobilePlayerPx: Math.floor(360 * 0.78) - 24,
  /** `h-8 w-8` avatar, `h-9 w-9` play button, and two `gap-2.5` between them. */
  fixedPx: 32 + 36 + 10 + 10,
  /** `gap-px` between bars. */
  gapPx: 1,
  /** Below this a bar is a hairline that reads as nothing at all. */
  minBarPx: 2,
} as const;

/**
 * The width one bar ends up with, given how many are drawn in what space.
 *
 * Flexbox with `flex-1` on every bar shares the leftover space equally, which
 * is what this computes - and is why the bars use `flex-1` rather than
 * `w-full`. Forty-eight items each asking for the container's *whole* width
 * shrink to slivers instead; that was the original bug.
 */
export function barWidthPx(count: number, availablePx: number): number {
  if (count <= 0) return 0;
  const gaps = (count - 1) * WAVE_LAYOUT.gapPx;
  return (availablePx - gaps) / count;
}
