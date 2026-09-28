import type { ReactNode } from 'react';

const emptyStateClass =
  'mx-auto mt-(--mb-space-9) mb-0 max-w-[620px] rounded-card border border-border bg-surface-elevated p-[clamp(28px,7vw,54px)] text-center text-primary shadow-sm [&_.button]:mt-(--mb-space-2)';

/** The bank seal, matching the brand mark and game-card seal but larger. */
const emptyStateTokenClass =
  'mx-auto mt-0 mb-(--mb-space-4) grid size-[56px] flex-[0_0_auto] place-items-center rounded-md border border-[color-mix(in_srgb,var(--mb-color-highlight)_64%,transparent)] bg-surface-inverse-elevated text-meta font-bold tracking-meta text-on-inverse shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--mb-color-surface-inverse)_70%,transparent)]';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/** Empty list state with the decorative bank seal. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className={emptyStateClass}>
      <span className={emptyStateTokenClass} aria-hidden="true">
        MB
      </span>
      <h2>{title}</h2>
      {description !== undefined && <p>{description}</p>}
      {action}
    </section>
  );
}
