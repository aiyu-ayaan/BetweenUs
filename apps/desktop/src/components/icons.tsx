/** Inline SVG icons (Lucide geometry). No emoji, no icon-font dependency. */
import type { SVGProps } from 'react';
import {
  MARK_BOWL,
  MARK_BOWL_SMALL,
  MARK_DOTS,
  MARK_DOT_R,
  MARK_STEM,
  MARK_STEM_SMALL,
  MARK_TAIL,
  MARK_TAIL_SMALL,
} from './brand-mark';

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HashIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </Base>
);

export const PlusIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Base>
);

export const SendIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </Base>
);

export const LogOutIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </Base>
);

export const UsersIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Base>
);

export const PhoneIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
  </Base>
);

export const PhoneOffIcon = (props: IconProps): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-1.07.54-2.02 1.25-2.83 2.1-.2.2-.47.31-.77.31-.3 0-.57-.11-.77-.31l-1.61-1.6c-.2-.2-.31-.47-.31-.77 0-.3.11-.57.31-.77C3.96 9.58 7.78 8 12 8s8.04 1.58 11.14 4.68c.2.2.31.47.31.77 0 .3-.11.57-.31.77l-1.61 1.6c-.2.2-.47.31-.77.31s-.57-.11-.77-.31c-.81-.85-1.76-1.56-2.83-2.1-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
  </svg>
);

export const MicIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    <line x1="12" y1="18" x2="12" y2="22" />
  </Base>
);

export const MicOffIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M15 9.34V5a3 3 0 0 0-5.94-.6" />
    <path d="M9 9v4a3 3 0 0 0 5.12 2.12" />
    <path d="M19 10v1a7 7 0 0 1-1.1 3.76" />
    <path d="M5 10v1a7 7 0 0 0 10.7 5.95" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </Base>
);

export const VideoIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="m22 8-6 4 6 4V8Z" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </Base>
);

export const VideoOffIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8" />
    <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </Base>
);

export const ScreenShareIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </Base>
);

export const SpeakerIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M18.36 5.64a9 9 0 0 1 0 12.73" />
  </Base>
);

/** A speaker with the sound crossed out: this person is silenced for me. */
export const SpeakerOffIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </Base>
);

export const LockIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Base>
);

export const ChevronLeftIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polyline points="15 18 9 12 15 6" />
  </Base>
);

export const ChevronRightIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polyline points="9 18 15 12 9 6" />
  </Base>
);

export const CompassIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </Base>
);

export const ChevronDownIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polyline points="6 9 12 15 18 9" />
  </Base>
);

/** A heartbeat line: how the connection is doing. */
export const ActivityIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </Base>
);

export const SettingsIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Base>
);

export const SearchIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Base>
);

export const CheckIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polyline points="20 6 9 17 4 12" />
  </Base>
);

export const XIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Base>
);

export const ClockIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </Base>
);

export const TrashIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Base>
);

export const MessageIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
  </Base>
);

export const UserPlusIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" y1="8" x2="19" y2="14" />
    <line x1="22" y1="11" x2="16" y2="11" />
  </Base>
);

export const ShieldIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </Base>
);

/** Three dots: the overflow menu, wherever a header runs out of room. */
export const MoreIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Base>
);

/** A circle with a bar through it: the universal "no". Used for blocking. */
export const BlockIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </Base>
);

export const BellIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </Base>
);

export const BellOffIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    <path d="M18.63 13A17.9 17.9 0 0 1 18 8" />
    <path d="M6.26 6.26A5.9 5.9 0 0 0 6 8c0 7-3 9-3 9h14" />
    <path d="M18 8a6 6 0 0 0-9.33-5" />
    <path d="m2 2 20 20" />
  </Base>
);

export const PaletteIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="13.5" cy="6.5" r=".5" />
    <circle cx="17.5" cy="10.5" r=".5" />
    <circle cx="8.5" cy="7.5" r=".5" />
    <circle cx="6.5" cy="12.5" r=".5" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </Base>
);

export const UserIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Base>
);

export const PaperclipIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Base>
);

export const FileIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </Base>
);

export const DownloadIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Base>
);

/**
 * A one-time message: the numeral one inside a circle.
 *
 * The same mark every other messenger uses for this, which is worth copying
 * rather than inventing around - it is the only symbol people already read as
 * "you get one look at this", and a clever alternative would have to be
 * explained the first time somebody met it.
 *
 * The numeral is drawn as strokes rather than set as text, because everything
 * else here is stroke geometry on a 24-unit grid: a `<text>` node would pick
 * up the page font and shift with it.
 */
/** A lowercase i in a circle: "there is a reason, and here it is". */
export const InfoIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </Base>
);

/** An arrow into a tray: the mark every platform uses for "download". */
export const AppDownloadIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Base>
);

export const OneTimeIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10.5 9.5 12.5 8v8" />
    <line x1="10.5" y1="16" x2="14.5" y2="16" />
  </Base>
);

export const EyeIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const ImageIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.5" />
    <path d="m21 15-4.5-4.5L7 20" />
  </Base>
);

export const PlayIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polygon points="6 4 20 12 6 20 6 4" />
  </Base>
);

/** Lucide's corner-up-left: the arrow every chat app uses for a reply. */
export const ReplyIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polyline points="9 14 4 9 9 4" />
    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
  </Base>
);

export const PinIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M9 2h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
  </Base>
);

export const PencilIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </Base>
);

/** Feather's `crop`. Opens the crop-and-rotate screen. */
export const CropIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M6.13 1L6 16a2 2 0 0 0 2 2h15" />
    <path d="M1 6.13L16 6a2 2 0 0 1 2 2v15" />
  </Base>
);

export const SmileIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <line x1="9" y1="9" x2="9.01" y2="9" />
    <line x1="15" y1="9" x2="15.01" y2="9" />
  </Base>
);

export const CopyIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Base>
);

/**
 * The BetweenUs mark: a lowercase b whose bowl is a speech bubble. Path data
 * comes from `brand-mark.ts`, which design/brand/build.py writes.
 *
 * `detail` picks the drawing. Below about 24px the full one's counter closes
 * up, so icon-sized uses get the heavier small cut. The parts carry
 * `brand-stem` / `brand-tail` / `brand-bowl` / `brand-dot` so a parent class
 * (`animate-mark-in`, `animate-mark-talk` in index.css) can move them; the
 * typing dots are invisible unless one does.
 */
export const BetweenUsLogoIcon = ({
  detail = 'small',
  ...props
}: SVGProps<SVGSVGElement> & { detail?: 'small' | 'full' }): JSX.Element => (
  <svg
    viewBox="0 0 256 256"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
    overflow="visible"
    {...props}
  >
    <path className="brand-stem" d={detail === 'full' ? MARK_STEM : MARK_STEM_SMALL} />
    <path className="brand-tail" d={detail === 'full' ? MARK_TAIL : MARK_TAIL_SMALL} />
    <path className="brand-bowl" d={detail === 'full' ? MARK_BOWL : MARK_BOWL_SMALL} />
    {MARK_DOTS.map(([cx, cy]) => (
      <circle key={cx} className="brand-dot" cx={cx} cy={cy} r={MARK_DOT_R} opacity={0} />
    ))}
  </svg>
);

export const MonitorIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </Base>
);

export const GlobeIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </Base>
);

export const MaximizeIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
  </Base>
);

export const MinimizeIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
  </Base>
);

export const LayoutSidebarIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
  </Base>
);

export const LayoutBottomIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 15h18" />
  </Base>
);

export const PipIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <rect x="12" y="10" width="8" height="8" rx="1" fill="currentColor" fillOpacity="0.2" />
  </Base>
);

export const MenuIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </Base>
);



export const MusicIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Base>
);

export const PauseIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Base>
);

export const SkipBackIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polygon points="19 20 9 12 19 4 19 20" />
    <line x1="5" y1="19" x2="5" y2="5" />
  </Base>
);

export const SkipForwardIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polygon points="5 4 15 12 5 20 5 4" />
    <line x1="19" y1="5" x2="19" y2="19" />
  </Base>
);

export const GamepadIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <line x1="6" y1="12" x2="10" y2="12" />
    <line x1="8" y1="10" x2="8" y2="14" />
    <line x1="15" y1="13" x2="15.01" y2="13" />
    <line x1="18" y1="11" x2="18.01" y2="11" />
    <rect x="2" y="6" width="20" height="12" rx="6" />
  </Base>
);

export const RotateIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </Base>
);

export const TrophyIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M8 21h8" />
    <path d="M12 17v4" />
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
    <path d="M17 5h3a3 3 0 0 1-3 3" />
    <path d="M7 5H4a3 3 0 0 0 3 3" />
  </Base>
);

export const AppsIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Base>
);

export const SunIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </Base>
);

export const MoonIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Base>
);

export const SparklesIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
  </Base>
);

export const HeadphonesIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
  </Base>
);

export const FolderIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </Base>
);

export const CrownIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
  </Base>
);


export const PollIcon = (props: IconProps): JSX.Element => (
  <Base {...props}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </Base>
);
