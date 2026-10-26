import type { SVGProps } from 'react';
import { MARK_BOWL, MARK_DOTS, MARK_DOT_R, MARK_STEM, MARK_TAIL } from './brand-mark';

/**
 * The BetweenUs mark: a lowercase b whose bowl is a speech bubble. The same
 * drawing and motion as the main app's (`BetweenUsLogoIcon`); the paths in
 * `brand-mark.ts` are written by design/brand/build.py.
 *
 * `motion`: `in` pops the bubble, raises the stem and flicks the tail out
 * once; `talk` does that and then plays typing dots in the bowl for as long
 * as it is on screen.
 */
export function BrandMark({
  motion,
  className = '',
  ...props
}: SVGProps<SVGSVGElement> & { motion?: 'in' | 'talk' }): JSX.Element {
  const animation = motion === 'talk' ? 'mark-talk' : motion === 'in' ? 'mark-in' : '';
  return (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      overflow="visible"
      className={`${animation} ${className}`}
      {...props}
    >
      <path className="brand-stem" d={MARK_STEM} />
      <path className="brand-tail" d={MARK_TAIL} />
      <path className="brand-bowl" d={MARK_BOWL} />
      {MARK_DOTS.map(([cx, cy]) => (
        <circle key={cx} className="brand-dot" cx={cx} cy={cy} r={MARK_DOT_R} opacity={0} />
      ))}
    </svg>
  );
}
