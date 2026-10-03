import type { ReactNode } from 'react';

export interface RowProps {
  title: ReactNode;
  /** Formatted timestamp shown under the title. */
  timestamp: ReactNode;
}

/** Title-and-time line of a ledger row; `activity-transaction` stays as a test hook. */
export function Row({ title, timestamp }: RowProps) {
  return (
    <div className="activity-transaction grid min-w-0 gap-[3px] [&>strong]:truncate">
      <strong>{title}</strong>
      <time>{timestamp}</time>
    </div>
  );
}
