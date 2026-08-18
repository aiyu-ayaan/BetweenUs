import type { PresenceStatus } from '@betweenus/shared-types';
import { absoluteUrl } from '../services/endpoint';

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-20 w-20 text-2xl',
} as const;

const DOT_SIZES = {
  sm: 'h-3 w-3 border-[3px]',
  md: 'h-3.5 w-3.5 border-[3px]',
  lg: 'h-6 w-6 border-4',
} as const;

const DOT_COLOURS: Record<PresenceStatus, string> = {
  online: 'bg-status-online',
  idle: 'bg-status-idle',
  dnd: 'bg-status-dnd',
  // Someone's own client is the only place this is ever seen; to everyone else
  // an invisible user is simply offline.
  invisible: 'bg-status-offline',
  offline: 'bg-status-offline',
};

const DOT_LABELS: Record<PresenceStatus, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do not disturb',
  invisible: 'Invisible',
  offline: 'Offline',
};

/**
 * A round avatar with an optional status dot punched out of its corner, which
 * is how every list in this app identifies a person.
 */
export function Avatar({
  name,
  avatarUrl,
  status,
  size = 'md',
  ringColour = 'border-surface-800',
}: {
  name: string;
  avatarUrl?: string | null;
  /** Omitted where status is meaningless - a message author, for instance. */
  status?: PresenceStatus;
  size?: keyof typeof SIZES;
  /**
   * Border colour class for the dot's cut-out. It has to match whatever the
   * avatar is sitting on, which only the caller knows.
   */
  ringColour?: string;
}): JSX.Element {
  return (
    <div className={`relative shrink-0 ${SIZES[size]}`}>
      {avatarUrl ? (
        <img
          // Stored pictures come back rooted at /api/v1/uploads; resolve them
          // against the deployment, not against file:// in a packaged window.
          src={absoluteUrl(avatarUrl)}
          alt=""
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center rounded-full bg-accent font-semibold uppercase text-white"
        >
          {name.trim().charAt(0) || '?'}
        </div>
      )}

      {status && (
        <span
          title={DOT_LABELS[status]}
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-solid ${DOT_SIZES[size]} ${DOT_COLOURS[status]} ${ringColour}`}
        >
          <span className="sr-only">{DOT_LABELS[status]}</span>
        </span>
      )}
    </div>
  );
}
