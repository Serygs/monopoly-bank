import type { ComponentPropsWithRef } from 'react';
import { buttonClass, cx, type ButtonTone } from './class-names';

export type GlassButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface GlassButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: GlassButtonVariant;
  iconOnly?: boolean;
}

const tone: Record<GlassButtonVariant, ButtonTone> = {
  primary: 'primary',
  secondary: 'secondary',
  ghost: 'quiet',
  danger: 'danger',
};

/** Pill button over the shared glass tokens; the variants map onto the `Button` tones. */
export function GlassButton({
  variant = 'secondary',
  iconOnly = false,
  type = 'button',
  className,
  ...props
}: GlassButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClass(tone[variant], iconOnly), 'rounded-pill', className)}
      {...props}
    />
  );
}
