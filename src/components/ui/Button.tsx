import type { ComponentPropsWithRef } from 'react';
import { buttonClass, buttonCoreClass, cx, type ButtonTone } from './class-names';

export type ButtonVariant = ButtonTone;

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /**
   * Omit for feature buttons that bring their own size and colours (filter chips, wallet
   * actions); they get only the shared core (`.button`).
   */
  variant?: ButtonVariant;
  /** Square icon treatment (`icon-button`). */
  iconOnly?: boolean;
}

/** Shared button primitive; defaults to `type="button"` so forms submit only on purpose. */
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
        variant === undefined ? buttonCoreClass : buttonClass(variant, iconOnly),
        className,
      )}
      {...props}
    />
  );
}
