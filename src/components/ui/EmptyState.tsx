import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/** Empty list state with the decorative bank seal (`empty-state`). */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <span className="empty-state-token" aria-hidden="true">
        MB
      </span>
      <h2>{title}</h2>
      {description !== undefined && <p>{description}</p>}
      {action}
    </section>
  );
}
