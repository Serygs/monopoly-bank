import type { ComponentPropsWithRef } from 'react';
import { cx } from './class-names';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** Omit for feature buttons that compose `.button` with their own treatment. */
  variant?: ButtonVariant;
  /** Square icon treatment (`icon-button`). */
  iconOnly?: boolean;
}

/** Shared `.button` primitive; defaults to `type="button"` so forms submit only on purpose. */
export function Button({
  variant,
  iconOnly = false,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'button',
        variant !== undefined && `button-${variant}`,
        iconOnly && 'icon-button',
        className,
      )}
      {...props}
    />
  );
}
