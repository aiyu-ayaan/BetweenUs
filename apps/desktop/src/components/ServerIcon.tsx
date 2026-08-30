import { absoluteUrl } from '../services/endpoint';

/**
 * A server's picture, or its initials when it has none - the same fallback
 * Discord uses, and the reason a server without an icon is still recognisable
 * in the rail.
 */
const SIZES = {
  /** Beside a section heading, where it sits at the cap height of the words. */
  xs: 'h-4 w-4 text-[8px]',
  sm: 'h-7 w-7 text-xs',
  rail: 'h-full w-full text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-20 w-20 text-2xl',
} as const;

export function ServerIcon({
  server,
  size = 'md',
  className,
}: {
  server: { name: string; iconUrl?: string | null } | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}): JSX.Element {
  if (server?.iconUrl) {
    return (
      <img
        src={absoluteUrl(server.iconUrl)}
        alt=""
        className={`${SIZES[size]} ${size === 'rail' ? 'rounded-none' : 'rounded-full'} object-cover ${className ?? ''}`}
      />
    );
  }

  return (
    <span
      className={`flex ${SIZES[size]} items-center justify-center font-semibold ${
        size === 'rail'
          ? 'bg-transparent text-inherit'
          : 'rounded-full bg-surface-700 text-slate-100'
      } ${className ?? ''}`}
    >
      {initials(server?.name ?? '?')}
    </span>
  );
}

/** Up to two letters, one per word, the way a server pill reads at a glance. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}
