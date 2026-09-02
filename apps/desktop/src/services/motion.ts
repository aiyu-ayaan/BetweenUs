/**
 * The half of `prefers-reduced-motion` that CSS cannot reach.
 *
 * `index.css` flattens every animation and transition under the media query,
 * which covers everything the stylesheet starts. It does not cover a scroll
 * this app starts itself: `scrollTo({ behavior: 'smooth' })` and
 * `scrollIntoView({ behavior: 'smooth' })` take the behaviour as an argument
 * and consult nothing. So the conversation kept gliding for somebody who had
 * asked the whole machine to stop moving - and gliding a full message list is
 * the largest single movement in the client, which makes it the one worth
 * having asked about.
 *
 * `'auto'` in `scrollBehavior` means *jump*, which is the browser's word for it
 * rather than a choice made here. The message still arrives at the same place;
 * it arrives without travelling there.
 */

/**
 * Read live rather than cached. The setting is changed in the OS while the app
 * is running, and a value read once at import is one that is wrong for the rest
 * of the session - the failure this would otherwise have is invisible, because
 * it only shows up for the people who changed the setting.
 *
 * `false` where `matchMedia` does not exist: an environment that cannot be
 * asked has not asked for less motion.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** What to pass as `behavior` to a scroll this app starts. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
