/**
 * How tightly the conversation is packed.
 *
 * The most-asked-for setting any chat client has, and the one this app has
 * never had: the spacing was six hardcoded Tailwind classes in `ChatView`, and
 * hardcoded spacing is a decision taken once for everybody at a screen size and
 * a sitting distance somebody happened to have.
 *
 * ## What this is not
 *
 * Not a font-size control. The OS already has one, it is the accessible way to
 * ask for larger text, and a second one inside the app that disagrees with it
 * is worse than none. This changes the *space around* messages, which is the
 * thing the OS cannot know about because it is about how many messages somebody
 * wants on screen at once.
 *
 * Not the grouping rule either. Consecutive messages from one author already
 * collapse into a run, on both clients, and that stays exactly as it is -
 * density decides how much air a run gets, not what counts as one.
 */

export type Density = 'cozy' | 'compact';

export const DENSITIES: Density[] = ['cozy', 'compact'];

/** What each is called, and the one line that says what it does. */
export const DENSITY_LABELS: Record<Density, { label: string; hint: string }> = {
  cozy: { label: 'Cozy', hint: 'Room to breathe. The default.' },
  compact: { label: 'Compact', hint: 'More of the conversation on screen at once.' },
};

/**
 * The spacing a message row gets.
 *
 * Returned as class strings because that is what the list consumes, and kept
 * here rather than inline so that both values for a measurement sit next to
 * each other. Two numbers a hundred lines apart is how one of them gets changed
 * and the other does not.
 */
export interface DensitySpacing {
  /** Above a message that continues a run from the same author. */
  grouped: string;
  /** Above a message that starts one. */
  separate: string;
  /** Between the avatar column and the bubble. */
  gutter: string;
  /** The list's own horizontal padding. */
  inset: string;
}

const SPACING: Record<Density, DensitySpacing> = {
  cozy: { grouped: 'mt-0.5', separate: 'mt-3', gutter: 'gap-2', inset: 'px-2' },
  // Every step tighter, and none of them to zero. A run with no gap at all
  // stops reading as several messages and starts reading as one long one with
  // odd line breaks in it, which is a different failure from being cramped.
  compact: { grouped: 'mt-px', separate: 'mt-1.5', gutter: 'gap-1.5', inset: 'px-1' },
};

export function spacingFor(density: Density): DensitySpacing {
  return SPACING[density] ?? SPACING.cozy;
}

/**
 * Whatever came out of storage, as a density.
 *
 * A value written by a newer build, or a corrupted one, is `cozy` rather than
 * an exception: an appearance preference is never worth failing to draw the app
 * over.
 */
export function asDensity(value: unknown): Density {
  return value === 'compact' ? 'compact' : 'cozy';
}
