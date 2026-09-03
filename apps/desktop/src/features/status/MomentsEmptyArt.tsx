/**
 * What the tray draws when nobody has posted.
 *
 * A drawing rather than the sentence that used to be here: an empty screen
 * with one grey line on it reads as something that failed to load. Inline SVG
 * rather than a file, for the same reason every other icon in the app is - it
 * inherits the text colour, so it is right in both themes without a second
 * asset.
 *
 * The ring is segmented like the one an avatar wears when there is something
 * to watch, which is what says "this is where moments appear" without a
 * caption doing it.
 */
export function MomentsEmptyArt({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 160 120"
      role="img"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
    >
      {/* The two runs already watched, behind and dimmer. */}
      <circle cx="38" cy="60" r="20" className="stroke-current opacity-20" strokeWidth="3" />
      <circle cx="122" cy="60" r="20" className="stroke-current opacity-20" strokeWidth="3" />

      {/* The one in front, segmented: four posts with a gap between each. */}
      <circle
        cx="80"
        cy="58"
        r="30"
        className="stroke-current opacity-70"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="35 12"
      />

      {/* A photo inside it - a horizon and a sun, which is the smallest thing
          that reads as a picture at this size. */}
      <rect
        x="62"
        y="42"
        width="36"
        height="32"
        rx="6"
        className="stroke-current opacity-40"
        strokeWidth="3"
      />
      <circle cx="72" cy="52" r="3.5" className="fill-current opacity-40" />
      <path
        d="M64 70l10-11 7 7 6-5 9 9"
        className="stroke-current opacity-40"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* The add badge, where the composer sits on the row above. */}
      <circle cx="106" cy="84" r="11" className="fill-current opacity-20" />
      <path
        d="M106 79v10M101 84h10"
        className="stroke-current opacity-60"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
