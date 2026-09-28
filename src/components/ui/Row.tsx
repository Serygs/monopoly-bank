import type { ReactNode } from 'react';

export interface RowProps {
  title: ReactNode;
  /** Formatted timestamp shown under the title. */
  timestamp: ReactNode;
}

/** Title-and-time line of a ledger row (`activity-transaction`). */
export function Row({ title, timestamp }: RowProps) {
  return (
    <div className="activity-transaction">
      <strong>{title}</strong>
      <time>{timestamp}</time>
    </div>
  );
}
