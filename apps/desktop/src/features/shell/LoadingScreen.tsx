import { useEffect, useState } from 'react';
import { BetweenUsLogoIcon } from '../../components/icons';

/**
 * What the window shows while the session is being restored.
 *
 * Discord's shape, and Discord's reasoning: a mark that is alive rather than a
 * spinner, because a spinner says "something is happening" and a brand mark
 * says which application you are waiting for - which matters most on the one
 * screen that appears before anything else identifies it.
 *
 * The **tip is deliberately late**. A restore is usually one round trip, and a
 * line of advice that flashes for 200ms is noise nobody can read; worse, it
 * makes a fast start look like a slow one. So the mark appears at once and the
 * tip only joins it once the wait has become a wait - see [[TIP_DELAY_MS]].
 *
 * Nothing here is a progress bar. There is no progress to report: a token
 * refresh either answers or it does not, and a bar that fills on a timer is a
 * lie about a request nobody is measuring.
 *
 * Motion is CSS only, so `prefers-reduced-motion` in `index.css` disarms all of
 * it globally without this component asking - the mark simply sits still.
 */

/** How long a wait has to last before it is worth saying something into. */
export const TIP_DELAY_MS = 1200;

/** How long each tip stays up before the next one takes over. */
export const TIP_ROTATE_MS = 4500;

/**
 * Things that are true about this product specifically.
 *
 * Not filler. Every line is something somebody might not know and can act on,
 * and nothing here overstates what the encryption does - a loading screen is a
 * bad place to make a promise the rest of the app has to keep.
 */
export const TIPS: readonly string[] = [
  'Messages are sealed on your device. The server stores ciphertext it cannot read.',
  'Voice and video go straight between you. No server sits in the middle of a call.',
  'Press Ctrl K to jump to any channel or conversation.',
  'A one-time photo is destroyed once everyone it was sent to has opened it.',
  'Type @ to mention somebody, a role, or everyone in the channel.',
  'Screen sharing keeps the picture sharp and spends frames instead - text stays readable.',
  'Your remote machines dial out. No inbound port is ever opened for them.',
];

export function LoadingScreen(): JSX.Element {
  // Which tip, or null while the wait is still short enough not to fill.
  const [tip, setTip] = useState<number | null>(null);

  useEffect(() => {
    const first = window.setTimeout(() => {
      // A random opening tip rather than always the first: this screen is seen
      // every single launch, and a list that always starts at the top is a list
      // whose first entry is the only one anybody ever reads.
      setTip(Math.floor(Math.random() * TIPS.length));
    }, TIP_DELAY_MS);
    return () => window.clearTimeout(first);
  }, []);

  useEffect(() => {
    if (tip === null) return;
    const next = window.setInterval(() => {
      setTip((at) => ((at ?? 0) + 1) % TIPS.length);
    }, TIP_ROTATE_MS);
    return () => window.clearInterval(next);
  }, [tip === null]);

  return (
    <div
      className="flex h-full h-[100dvh] flex-col items-center justify-center gap-5 bg-ground px-8"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="relative flex h-20 w-20 items-center justify-center">
        {/* The ring is the part that says "working". It is drawn as a single
            arc of a circle rather than a full border, so that it reads as
            travelling rather than merely glowing. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-[1.4rem] border-2 border-transparent border-t-accent/70 border-e-accent/25 animate-boot-ring"
        />
        <span
          aria-hidden="true"
          className="absolute inset-1.5 rounded-[1.1rem] bg-accent/10 animate-boot-glow"
        />
        <BetweenUsLogoIcon className="relative h-10 w-10 text-accent animate-boot-mark" />
      </div>

      <p className="text-sm font-semibold tracking-[0.35em] text-slate-300">BETWEENUS</p>

      {/* Reserved height, so the mark does not jump upwards when the tip
          arrives - a layout that shifts under somebody who is already waiting
          reads as a second thing going wrong. */}
      <div className="flex h-10 max-w-sm items-start justify-center">
        {tip !== null && (
          <p
            key={tip}
            className="animate-boot-tip text-center text-xs leading-relaxed text-slate-500"
          >
            {TIPS[tip]}
          </p>
        )}
      </div>

      <span className="sr-only">Signing you in</span>
    </div>
  );
}
