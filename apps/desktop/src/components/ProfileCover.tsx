/**
 * The wide band behind a name at the top of a profile.
 *
 * One component for all three places that draw one - the settings header, the
 * hover card and the full profile - because the fallback is the interesting
 * part and it has to be the same fallback everywhere. An account with no cover
 * gets the accent colour, which is exactly what every one of those places drew
 * before covers existed, so nothing looks broken on an account that has not
 * chosen a picture.
 *
 * A gradient rather than a flat fill on the fallback: a flat band under a round
 * avatar reads as a placeholder that failed to load, and the accent at two
 * stops reads as a decision. It is the same colour either way, so a deployment
 * that has themed its accent gets a themed cover for free.
 */
import { absoluteUrl } from '../services/endpoint';

export function ProfileCover({
  coverUrl,
  className = '',
  children,
}: {
  coverUrl: string | null | undefined;
  /** Sets the height; the aspect is fixed by whatever draws it. */
  className?: string;
  /** Drawn over the band - a close button, usually. */
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-accent to-accent-hover ${className}`}
    >
      {coverUrl && (
        <img
          src={absoluteUrl(coverUrl)}
          alt=""
          // Decorative: the name under it is the label, and a screen reader
          // announcing "cover photo" before every profile is noise.
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
      )}
      {/* A scrim only under a real picture. The name and the avatar sit on the
          bottom edge of this band, and a photograph with a bright lower half
          makes both of them unreadable - where the accent gradient never
          does, so darkening that would only mute the theme for nothing. */}
      {coverUrl && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 to-transparent"
        />
      )}
      {children}
    </div>
  );
}
