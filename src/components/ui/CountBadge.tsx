import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** The number (or short text) shown. */
  children: string | number;
}

/** A small neutral pill with a count: never a status colour, so it never competes with state. */
export function CountBadge({ className, children, ...props }: CountBadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-pill border border-border bg-surface-subtle px-(--mb-space-2) text-meta font-semibold text-secondary tabular-nums',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
