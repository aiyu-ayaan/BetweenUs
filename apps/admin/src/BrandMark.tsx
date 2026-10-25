import type { SVGProps } from 'react';
import { MARK_LEFT, MARK_RIGHT } from './brand-mark';

/**
 * The BetweenUs mark: two faces leaning in, the gap between them what they
 * share. The same drawing and motion as the main app's (`BetweenUsLogoIcon`);
 * the paths in `brand-mark.ts` are written by design/brand/build.py.
 *
 * `motion`: `in` slides the faces in from either side once, `talk` does that
 * and then has them lean in by turns for as long as it is on screen.
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
      <path className="brand-l" d={MARK_LEFT} />
      <path className="brand-r" d={MARK_RIGHT} />
    </svg>
  );
}
