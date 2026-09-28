import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type ToolbarVariant = 'game-page' | 'game-card' | 'auth-footer' | 'form';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  variant: ToolbarVariant;
}

const toolbarClassNames: Record<ToolbarVariant, string> = {
  // Two columns below `md` (an odd last action spans both), a wrapping row from `md`.
  'game-page':
    'grid grid-cols-2 gap-(--mb-space-2) [&_.button]:min-w-0 max-md:[&_.button]:w-full [&>:last-child:nth-child(odd)]:col-span-full md:flex md:flex-wrap md:justify-start md:[&>:last-child:nth-child(odd)]:col-auto lg:justify-end',
  // The primary action fills the column beside the overflow-menu trigger.
  'game-card':
    'relative grid grid-cols-[minmax(0,1fr)_var(--mb-control-height-md)] gap-(--mb-space-2) [&>button]:w-full',
  'auth-footer':
    'mt-(--mb-space-6) flex items-center justify-between gap-(--mb-space-3) border-t border-border pt-(--mb-space-5) text-small text-secondary max-md:flex-col max-md:items-stretch',
  form: 'flex justify-end max-md:[&_.button]:w-full',
};

/** A row of actions in one DOM order at every layout size. */
export function Toolbar({ variant, className, ...props }: ToolbarProps) {
  return <div className={cx(toolbarClassNames[variant], className)} {...props} />;
}
