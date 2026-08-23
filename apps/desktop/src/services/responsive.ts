import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;

export function isMobileScreen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => isMobileScreen());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = (e: MediaQueryListEvent | MediaQueryList): void => {
      setIsMobile(e.matches);
    };

    update(media);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    } else if (typeof (media as any).addListener === 'function') {
      (media as any).addListener(update);
      return () => (media as any).removeListener(update);
    }
  }, []);

  return isMobile;
}
