import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './class-names';

export interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  /** One quiet line under the value. */
  hint?: ReactNode;
}

/** A label over a value in a quiet bordered tile (totals, counts). Use inside a `<dl>`-free grid. */
export function StatTile({ label, value, hint, className, ...props }: StatTileProps) {
  return (
    <div
      className={cx(
        'grid min-w-0 gap-[2px] rounded-compact border border-border bg-surface-subtle p-(--mb-space-3)',
        className,
      )}
      {...props}
    >
      <span className="text-meta font-semibold text-secondary">{label}</span>
      <strong className="font-money text-body font-bold wrap-anywhere text-primary tabular-nums">
        {value}
      </strong>
      {hint !== undefined && <small className="text-secondary">{hint}</small>}
    </div>
  );
}
