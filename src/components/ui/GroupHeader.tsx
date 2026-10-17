import type { ReactNode } from 'react';
import { cx } from './class-names';
import { CountBadge } from './CountBadge';

export interface GroupHeaderProps {
  /** The group's swatch colour (domain data, e.g. a property colour group). */
  color: string;
  name: string;
  count?: number | string;
  /** Accessible text for the count when the bare number is not enough. */
  countLabel?: string;
  /** Optional quiet text such as "$60 – $100". */
  priceRange?: string;
  /** Extra trailing content, e.g. a "Monopoly" badge. */
  badge?: ReactNode;
  /** Pins the header to the top of its scroll container; it is then fully opaque. */
  sticky?: boolean;
  as?: 'h3' | 'h4';
  className?: string;
}

/**
 * A pill header for a group of rows: colour dot, name, count and an optional price range. When
 * sticky it spans the full width with an opaque fill (the glass popover fill under Liquid Glass),
 * so the cards scrolling under it never show through.
 */
export function GroupHeader({
  color,
  name,
  count,
  countLabel,
  priceRange,
  badge,
  sticky = false,
  as: Element = 'h4',
  className,
}: GroupHeaderProps) {
  return (
    <Element
      className={cx(
        'group-header m-0 flex min-h-8 w-full items-center gap-(--mb-space-2) rounded-pill border border-border bg-surface-elevated px-(--mb-space-3) py-(--mb-space-1) text-small font-semibold text-primary',
        sticky && 'sticky top-0 z-1 glass-popover',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-block size-3 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {priceRange !== undefined && (
        <span className="font-money text-meta font-normal text-secondary tabular-nums">
          {priceRange}
        </span>
      )}
      {count !== undefined && <CountBadge aria-label={countLabel}>{count}</CountBadge>}
      {badge}
    </Element>
  );
}
