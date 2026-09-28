import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type StatPillVariant = 'pill' | 'status' | 'muted';

export interface StatPillProps extends Omit<HTMLAttributes<HTMLElement>, 'role'> {
  /**
   * `pill` is the compact count/badge (`status-pill`), `status` the bordered status block,
   * `muted` quiet status copy. Omit it to style the element with `className` alone.
   */
  variant?: StatPillVariant;
  /** Announce changes politely (`role="status"`). */
  live?: boolean;
  as?: 'span' | 'p';
}

const statClassNames: Record<StatPillVariant, string> = {
  pill: 'status-pill',
  status: 'status',
  muted: 'muted',
};

/** Compact status text: counts, badges and loading states. */
export function StatPill({ variant, live = false, as, className, ...props }: StatPillProps) {
  const Element = as ?? (variant === 'status' || variant === 'muted' ? 'p' : 'span');
  return (
    <Element
      role={live ? 'status' : undefined}
      className={cx(variant === undefined ? undefined : statClassNames[variant], className)}
      {...props}
    />
  );
}
