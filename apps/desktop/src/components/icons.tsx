/** Inline SVG icons (Lucide geometry). No emoji, no icon-font dependency. */
import type { SVGProps } from 'react';

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

export const NexoraLogoIcon = (props: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg
    viewBox="0 0 1024 1024"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path
      d="M275.673088 576.216064v-60.6464c0-21.42208-17.46944-38.139904-38.842368-36.37248 0 0-170.27072-2.41664-170.27072 113.262592v188.42624c0 108.34432 170.758144 106.129408 170.758144 106.129408 21.183488 1.222656 38.354944-15.01184 38.354944-36.574208v-80.048128c-28.741632-22.59968-47.20128-57.689088-47.20128-97.088512s18.459648-74.487808 47.20128-97.088512m473.335808 0v-60.6464c0-21.42208 17.46944-38.139904 38.842368-36.37248 0 0 170.27072-2.41664 170.27072 113.262592v188.42624c0 108.34432-170.758144 106.129408-170.758144 106.129408-21.183488 1.222656-38.354944-15.01184-38.354944-36.574208v-80.048128c28.741632-22.59968 47.20128-57.689088 47.20128-97.088512s-18.459648-74.487808-47.20128-97.088512"
      fill="currentColor"
    />
    <path
      d="M866.811904 301.606912c-6.428672-41.131008-19.958784-71.120896-42.578944-94.375936-24.572928-25.26208-60.89216-42.904576-111.034368-53.93408C664.004608 142.476288 598.115328 137.216 511.763456 137.216c-86.350848 0-152.240128 5.260288-201.435136 16.080896-50.142208 11.029504-86.46144 28.672-111.034368 53.93408-22.62016 23.25504-36.150272 53.244928-42.578944 94.375936-5.564416 35.59936-5.564416 76.85632-5.564416 124.627968h38.775808c0-46.155776 0-86.016 5.09952-118.639616 5.197824-33.25952 15.086592-55.87456 32.063488-73.32864 19.116032-19.652608 49.069056-33.75104 91.568128-43.10016 46.425088-10.211328 109.591552-15.174656 193.10592-15.174656 83.515392 0 146.680832 4.963328 193.10592 15.17568 42.499072 9.34912 72.451072 23.446528 91.56608 43.10016 16.97792 17.453056 26.867712 40.06912 32.065536 73.32864 5.098496 32.622592 5.098496 72.482816 5.098496 118.638592h38.776832c0-47.771648 0-89.028608-5.564416-124.627968M239.922176 479.06816c-1.020928 0-2.050048 0.041984-3.09248 0.128 0 0-0.274432-0.004096-0.79872-0.004096-12.56448 0-169.472 2.219008-169.472 113.267712v188.42624c0 104.085504 157.600768 106.13248 169.990144 106.13248 0.50688 0 0.770048-0.004096 0.770048-0.004096 0.750592 0.044032 1.498112 0.065536 2.238464 0.065536 20.141056 0 36.115456-15.84128 36.115456-36.63872v-80.048128c-28.741632-22.59968-47.200256-57.689088-47.200256-97.088512s18.458624-74.487808 47.200256-97.088512v-60.6464c0-20.379648-15.81056-36.501504-35.750912-36.501504m544.838656 0c-19.940352 0.001024-35.751936 16.121856-35.751936 36.501504v60.6464c28.741632 22.600704 47.20128 57.689088 47.20128 97.088512s-18.459648 74.487808-47.20128 97.088512v80.047104c0 20.79744 15.9744 36.639744 36.11648 36.639744 0.740352 0 1.486848-0.02048 2.238464-0.065536 0 0 0.263168 0.004096 0.770048 0.004096 12.389376 0 169.988096-2.046976 169.988096-106.133504V592.459776c0-111.048704-156.90752-113.267712-169.472-113.267712-0.523264 0-0.79872 0.004096-0.79872 0.004096a37.490688 37.490688 0 0 0-3.090432-0.128m-548.74112 38.899712l0.31744 0.001024 0.561152 0.01024v40.95488c-12.28288 12.374016-22.606848 26.729472-30.33088 42.27584-11.194368 22.535168-16.8704 46.79168-16.8704 72.09472s5.676032 49.558528 16.871424 72.09472c7.723008 15.546368 18.046976 29.901824 30.329856 42.27584v60.566528h-0.027648l-0.321536 0.001024c-4.18816 0-41.9328-0.33792-77.48096-12.07808-17.77664-5.870592-31.367168-13.38368-40.399872-22.331392-9.096192-9.0112-13.33248-19.480576-13.33248-32.948224V592.459776c0-15.639552 4.50048-27.702272 14.16192-37.958656 9.003008-9.558016 22.468608-17.55136 40.020992-23.763968 35.07712-12.41088 72.375296-12.76928 76.502016-12.76928m552.630272 0c4.13696 0 41.437184 0.3584 76.51328 12.76928 17.55136 6.211584 31.01696 14.205952 40.019968 23.763968 9.662464 10.256384 14.16192 22.319104 14.16192 37.95968v188.424192c0 13.467648-4.235264 23.937024-13.33248 32.948224-9.03168 8.947712-22.624256 16.4608-40.398848 22.331392-35.549184 11.739136-73.294848 12.07808-77.48096 12.07808h-0.349184v-60.567552c12.28288-12.374016 22.606848-26.729472 30.329856-42.27584 11.195392-22.536192 16.871424-46.79168 16.871424-72.09472s-5.676032-49.559552-16.871424-72.09472c-7.723008-15.546368-18.046976-29.9008-30.33088-42.27584V517.98016l0.577536-0.01024h0.289792"
      fill="currentColor"
      opacity="0.9"
    />
  </svg>
);
