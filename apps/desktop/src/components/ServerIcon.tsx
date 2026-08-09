import { absoluteUrl } from '../services/endpoint';

/**
 * A server's picture, or its initials when it has none - the same fallback
 * Discord uses, and the reason a server without an icon is still recognisable
 * in the rail.
 */
const SIZES = {
  md: 'h-12 w-12 text-sm',
  lg: 'h-20 w-20 text-2xl',
} as const;

export function ServerIcon({
  server,
  size = 'md',
}: {
  server: { name: string; iconUrl?: string | null } | undefined;
  size?: keyof typeof SIZES;
}): JSX.Element {
  if (server?.iconUrl) {
    return (
      <img
        src={absoluteUrl(server.iconUrl)}
        alt=""
        className={`${SIZES[size]} rounded-full object-cover`}
      />
    );
  }

  return (
    <span
      className={`flex ${SIZES[size]} items-center justify-center rounded-full bg-surface-700 font-semibold text-slate-100`}
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
