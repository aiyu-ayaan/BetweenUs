/**
 * The two things a list draws when it has no rows: grey bars while it waits,
 * and a sentence when there is genuinely nothing.
 *
 * Both were written per-list before this, which is how the client ended up with
 * one list that skeletons (the conversation), three that go blank, and two that
 * claim to be empty while they are still fetching. `services/list-state.ts`
 * decides which of the three a list is in; this draws two of them.
 *
 * ## Why the pulse is `motion-safe:`
 *
 * `index.css` already flattens every animation under
 * `prefers-reduced-motion: reduce`, so the pulse would stop anyway. The variant
 * is here so the *intent* is in the markup rather than only in a global
 * override somebody may one day scope more narrowly - a skeleton that keeps
 * throbbing is exactly the kind of thing that setting exists to turn off.
 */
import type { ReactNode } from 'react';

/**
 * One grey bar. `className` carries its size, because a skeleton is only
 * useful if it is the shape of the thing it stands in for.
 */
export function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <div aria-hidden="true" className={`motion-safe:animate-pulse rounded bg-surface-800 ${className}`} />;
}

/**
 * `rows` placeholder people: a round avatar and a name beside it.
 *
 * The shape most of this client's lists are - members, friends, machines - so
 * one component covers them and a list that gains a skeleton later does not
 * invent a fourth grey rectangle.
 *
 * `aria-busy` and nothing else: a screen reader is told the region is working
 * and is spared a reading of six meaningless boxes. The rows themselves are
 * `aria-hidden` through `Skeleton`.
 */
export function SkeletonRows({
  rows = 5,
  className = '',
  label = 'Loading',
}: {
  rows?: number;
  className?: string;
  /** What is loading, for anybody who cannot see the bars. */
  label?: string;
}): JSX.Element {
  return (
    <div aria-busy="true" aria-label={label} role="status" className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          {/* Varied widths on purpose. A column of identical bars reads as a
              table that failed to load; uneven ones read as names. */}
          <Skeleton className={`h-3 ${['w-32', 'w-24', 'w-40', 'w-28'][row % 4]}`} />
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing here, and what to do about it.
 *
 * The hint is not optional and is not decoration: an empty state that says only
 * "No machines" has told somebody the same thing the blank screen did. The one
 * that says how to get a machine into the list is the whole point.
 */
export function EmptyState({
  icon,
  title,
  hint,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-10 text-center ${className}`}>
      {icon && <div aria-hidden="true" className="mb-3 text-slate-600">{icon}</div>}
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {hint && <p className="mt-1.5 max-w-xs text-sm text-slate-400">{hint}</p>}
    </div>
  );
}
