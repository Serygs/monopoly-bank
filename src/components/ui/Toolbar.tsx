import type { HTMLAttributes } from 'react';
import { cx } from './class-names';

export type ToolbarVariant = 'game-page' | 'game-card' | 'auth-footer' | 'form';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  variant: ToolbarVariant;
}

const toolbarClassNames: Record<ToolbarVariant, string> = {
  'game-page': 'game-page-actions',
  'game-card': 'game-card-actions',
  'auth-footer': 'auth-card-footer',
  form: 'form-actions',
};

/** A row of actions in one DOM order at every layout size. */
export function Toolbar({ variant, className, ...props }: ToolbarProps) {
  return <div className={cx(toolbarClassNames[variant], className)} {...props} />;
}
